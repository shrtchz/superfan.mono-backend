// streaming.service.ts
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OAuth2Client } from 'google-auth-library';
import { google, youtube_v3 } from 'googleapis';
import keys from '../../credentials.json';
import { ElasticsearchService } from '../elasticsearch/elasticsearch.service';
import { Role } from '../common/enums/role.enum';
import { RedisService } from '../mail/redis.service';
import { NotificationService } from '../notification/notification.service';
import { prisma } from '../prisma/prisma';
import { QuizService } from '../quiz/quiz.service';

export interface StreamSession {
  broadcastId: string;
  streamId: string;
  rtmpUrl: string;
  streamKey: string;
  streamUrl: string;
}

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);
  private readonly defaultAvatarUrl =
    this.configService.get<string>('DEFAULT_AVATAR_URL') ||
    'https://ui-avatars.com/api/?name=User&background=e5e7eb&color=111827';

  private toHttpsAvatarUrl(value?: string | null, displayName?: string): string {
    const raw = String(value ?? '').trim();
    const fallbackName = encodeURIComponent((displayName || 'User').slice(0, 40));
    const fallback = `https://ui-avatars.com/api/?name=${fallbackName}&background=e5e7eb&color=111827`;
    if (!raw) return fallback;
    if (raw.startsWith('https://')) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('http://')) return raw.replace(/^http:\/\//i, 'https://');

    const cdnBase = (
      this.configService.get<string>('CDN_BASE_URL') ||
      this.configService.get<string>('NEXT_PUBLIC_CDN_URL') ||
      this.configService.get<string>('FILE_CDN_BASE_URL') ||
      ''
    ).replace(/\/+$/, '');
    if (cdnBase && !raw.includes('://')) {
      return `${cdnBase}/${raw.replace(/^\/+/, '')}`;
    }
    // Bare host/path like "cdn.example.com/a.png"
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?]|$)/i.test(raw)) {
      return `https://${raw.replace(/^\/+/, '')}`;
    }
    return fallback;
  }

  private buildDisplayName(user?: {
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  }, fallbackUserId?: number): string {
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    if (fullName) return fullName;
    if (user?.username) return user.username;
    return fallbackUserId ? `User${fallbackUserId}` : 'User';
  }

  private async getUserPublicProfile(userId: number): Promise<{
    id: number;
    displayName: string;
    avatarUrl: string;
    username: string;
    firstName?: string;
    lastName?: string;
    profilePicture?: string | null;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        profilePicture: true,
      },
    });

    const displayName = this.buildDisplayName(user || undefined, userId);
    return {
      id: userId,
      displayName,
      avatarUrl: this.toHttpsAvatarUrl(user?.profilePicture, displayName),
      username: user?.username || displayName,
      firstName: user?.firstName || undefined,
      lastName: user?.lastName || undefined,
      profilePicture: user?.profilePicture,
    };
  }

  private toCommentBroadcastPayload(
    comment: Record<string, any>,
    author: {
      displayName: string;
      avatarUrl: string;
      username: string;
      firstName?: string;
      lastName?: string;
    },
    extras?: Record<string, unknown>,
  ) {
    const createdAt =
      comment.createdAt instanceof Date
        ? comment.createdAt.toISOString()
        : comment.createdAt;
    const updatedAt =
      comment.updatedAt instanceof Date
        ? comment.updatedAt.toISOString()
        : comment.updatedAt;

    return {
      id: comment.id,
      streamId: comment.streamId,
      userId: comment.userId,
      message: comment.message,
      likesCount: comment.likesCount ?? 0,
      reportsCount: comment.reportsCount ?? 0,
      isDeleted: Boolean(comment.isDeleted),
      createdAt,
      updatedAt,
      parentCommentId: comment.parentCommentId ?? comment.commentId ?? null,
      displayName: author.displayName,
      username: author.username,
      firstName: author.firstName,
      lastName: author.lastName,
      name: author.displayName,
      fullName: author.displayName,
      avatarUrl: author.avatarUrl,
      image: author.avatarUrl,
      profileImage: author.avatarUrl,
      avatar: author.avatarUrl,
      profilePicture: author.avatarUrl,
      user: {
        id: comment.userId,
        firstName: author.firstName,
        lastName: author.lastName,
        username: author.username,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl,
        profileImage: author.avatarUrl,
        profilePicture: author.avatarUrl,
      },
      ...extras,
    };
  }

  private readonly SCOPES = [];

  private oauth2Client: OAuth2Client;
  private youtube: youtube_v3.Youtube;
  private youtubeTokensLoaded = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly redis: RedisService,
    private readonly quizService: QuizService,
    private readonly elasticSearch: ElasticsearchService,
  ) {
    this.initialize();
    this.logger.log('YouTube service initialized successfully');
  }

  private normalizeQuizOption(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private extractLiveQuizOptions(liveQuiz: any): string[] {
    const quiz = liveQuiz?.data?.data ?? liveQuiz?.data ?? liveQuiz ?? {};
    const options = quiz?.options;

    return Array.isArray(options) ? options.map((option) => String(option)) : [];
  }

  private getOngoingLiveQuizIds(ongoingQuiz: any): string[] {
    const quizIds = Array.isArray(ongoingQuiz.quizIds) ? ongoingQuiz.quizIds : [];
    const questions = Array.isArray(ongoingQuiz.questions) ? ongoingQuiz.questions : [];
    const questionQuizIds = questions
      .map((question) => question?.quizId)
      .filter(Boolean);

    return [...new Set([...quizIds, ...questionQuizIds])];
  }

  private async submitLiveQuizAnswerFromMessage(
    streamId: number,
    message: string,
    userId: number,
  ): Promise<void> {
    const selectedAnswer = String(message ?? '').trim();

    if (!selectedAnswer) {
      return;
    }

    const ongoingQuiz = await prisma.ongoingLiveQuiz.findFirst({
      where: {
        streamId,
        userId: String(userId),
        completed: false,
      },
    });

    if (!ongoingQuiz) {
      return;
    }

    const normalizedAnswer = this.normalizeQuizOption(selectedAnswer);
    const quizIds = this.getOngoingLiveQuizIds(ongoingQuiz);

    for (const quizId of quizIds) {
      const liveQuiz = await this.quizService.getLiveQuiz(quizId);
      const options = this.extractLiveQuizOptions(liveQuiz);
      const matchedOption = options.find(
        (option) => this.normalizeQuizOption(option) === normalizedAnswer,
      );

      if (!matchedOption) {
        continue;
      }

      await this.quizService.updateLiveQuizAnswer({
        userId: String(userId),
        quizId,
        selectedAnswer: matchedOption,
      });

      await this.quizService.submitLiveQuiz(String(userId));
      return;
    }
  }

  private async hasSubmittedLiveQuizForStream(
    streamId: number,
    userId: number,
  ): Promise<boolean> {
    const completedQuiz = await prisma.ongoingLiveQuiz.findFirst({
      where: {
        streamId,
        userId: String(userId),
        completed: true,
      },
      select: { id: true },
    });

    return Boolean(completedQuiz);
  }

  private initialize() {
    const configuredRedirectUri =
      this.configService.get<string>('YOUTUBE_REDIRECT_URI');
    const clientId =
      this.configService.get<string>('YOUTUBE_CLIENT_ID') || keys.web?.client_id;
    const clientSecret =
      this.configService.get<string>('YOUTUBE_CLIENT_SECRET') || keys.web?.client_secret;

    const redirectUri =
      configuredRedirectUri ||
      keys.web?.redirect_uris?.[0] ||
      (keys.web as any)?.redirectUri;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error(
        'Missing YouTube OAuth credentials. Provide YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI in env, or supply credentials.json',
      );
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri,
    );

    /**
     * Load tokens from env
     */
    const accessToken =
      this.configService.get<string>('YOUTUBE_ACCESS_TOKEN');

    const refreshToken =
      this.configService.get<string>('YOUTUBE_REFRESH_TOKEN');

    if (accessToken || refreshToken) {
      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      this.logger.log('OAuth credentials loaded');
    } else {
      this.logger.warn(
        'YouTube OAuth tokens are not configured. Authenticate first.',
      );
    }

    /**
     * Apply auth globally and initialize YouTube API
     */
    google.options({ auth: this.oauth2Client });

    this.youtube = google.youtube({
      version: 'v3',
      auth: this.oauth2Client,
    });

    this.logger.log('YouTube service initialized');
  }

  private async loadStoredOAuthCredentials(): Promise<void> {
    if (this.youtubeTokensLoaded) {
      return;
    }

    // const accessToken = this.configService.get<string>('YOUTUBE_ACCESS_TOKEN');
    // const refreshToken = this.configService.get<string>('YOUTUBE_REFRESH_TOKEN');

    // Always provide an object to setCredentials so oauth2Client.credentials
    // is never undefined (prevents reading properties of undefined).
    let credentials: {
      access_token?: string;
      refresh_token?: string;
      expiry_date?: number;
      scope?: string;
      token_type?: string;
    } = {};

    const storedToken = await prisma.youTubeToken.findUnique({
      where: { service: 'youtube' },
    });

    if (storedToken) {
      credentials = {
        access_token: storedToken.accessToken ?? undefined,
        refresh_token: storedToken.refreshToken ?? undefined,
        expiry_date: storedToken.expiryDate?.getTime(),
        scope: storedToken.scope ?? undefined,
        token_type: storedToken.tokenType ?? undefined,
      };
    } else {
      // Fallback to environment-configured tokens if DB entry is missing
      const accessToken = this.configService.get<string>('YOUTUBE_ACCESS_TOKEN');
      const refreshToken = this.configService.get<string>('YOUTUBE_REFRESH_TOKEN');

      if (accessToken || refreshToken) {
        credentials = {
          access_token: accessToken ?? undefined,
          refresh_token: refreshToken ?? undefined,
        };
      }
    }

    this.oauth2Client.setCredentials(credentials);

    this.youtubeTokensLoaded = true;
  }

  async persistYoutubeTokens(tokens: {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    scope?: string;
    service?: string;
    token_type?: string;
  }): Promise<void> {
    await prisma.youTubeToken.upsert({
      where: { service: tokens.service },
      create: {
        service: tokens.service,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scope: tokens.scope,
        tokenType: tokens.token_type,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scope: tokens.scope,
        tokenType: tokens.token_type,
      },
    });
  }

  /**
   * STEP 1
   * Generate Google OAuth consent URL
   */
  generateAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: this.SCOPES,
    });
  }

  /**
   * STEP 2
   * Exchange code for tokens
   */
  async handleOAuthCallback(code: string) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token) {
        throw new Error('No access token returned');
      }

      /**
       * Save credentials
       */
      this.oauth2Client.setCredentials(tokens);
      await this.persistYoutubeTokens(tokens);

      this.logger.log('OAuth callback successful');

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        scope: tokens.scope,
        tokenType: tokens.token_type,
      };
    } catch (error) {
      this.logger.error(error);

      throw new InternalServerErrorException(
        `Failed to exchange code for token: ${error.message}`,
      );
    }
  }

  /**
   * Set tokens manually
   * Useful when loading from DB
   */
  setCredentials(tokens: {
    access_token?: string;
    refresh_token?: string;
  }) {
    this.oauth2Client.setCredentials(tokens);
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken: string) {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { token } = await this.oauth2Client.getAccessToken();

      if (token) {
        await this.persistYoutubeTokens({
          access_token: token,
          refresh_token: refreshToken,
          expiry_date: this.oauth2Client.credentials.expiry_date,
          scope: this.oauth2Client.credentials.scope,
          token_type: this.oauth2Client.credentials.token_type,
        });
      }

      return {
        accessToken: token,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to refresh access token: ${error.message}`,
      );
    }
  }

  /**
   * Ensure valid access token, refresh if needed
   */
  async ensureValidToken(): Promise<void> {
    try {
      await this.loadStoredOAuthCredentials();
      const credentials = this.oauth2Client.credentials;

      if (!credentials.access_token && !credentials.refresh_token) {
        throw new ForbiddenException(
          'YouTube OAuth tokens are not configured. Authenticate first.',
        );
      }

      if (
        credentials.expiry_date &&
        credentials.expiry_date <= Date.now()
      ) {
        if (!credentials.refresh_token) {
          throw new ForbiddenException(
            'YouTube access token expired and no refresh token is available.',
          );
        }

        this.logger.log('Token expired, refreshing...');
        const { token } = await this.oauth2Client.getAccessToken();
        this.logger.log('Token refreshed successfully');

        if (!token) {
          throw new ForbiddenException(
            'Failed to refresh YouTube access token.',
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to refresh token: ${error.message}`);
      if (error instanceof ForbiddenException) {
        throw error;
      }

      throw new ForbiddenException(
        `Failed to validate YouTube OAuth token: ${error.message}`,
      );
    }
  }


  /**
   * Create YouTube Live Broadcast (Nest YouTube client — Go is independent)
   */
  async createBroadcast(
    title: string,
    privacyStatus: 'public' | 'private' | 'unlisted' = 'public',
  ): Promise<any> {
    try {
      await this.ensureValidToken();
      this.logger.log(`Creating broadcast via Nest YouTube client: ${title}`);

      const scheduledStartTime = new Date(Date.now() + 60_000).toISOString();
      const snippet = {
        title,
        description: '',
        scheduledStartTime,
      };
      const status = {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      };

      let broadcast: any;
      try {
        const response = await this.youtube.liveBroadcasts.insert({
          part: ['snippet', 'status', 'contentDetails'],
          requestBody: {
            snippet,
            status,
            contentDetails: {
              enableEmbed: true,
              enableDvr: true,
              recordFromStart: true,
              enableClosedCaptions: false,
              enableAutoStart: false,
              enableAutoStop: false,
              monitorStream: {
                enableMonitorStream: true,
                broadcastStreamDelayMs: 0,
              },
            },
          },
        });
        broadcast = response.data;
      } catch (insertError: any) {
        if (!this.isInvalidEmbedSettingError(insertError)) {
          throw insertError;
        }

        this.logger.warn(
          'YouTube rejected enableEmbed on broadcast create; retrying without contentDetails',
        );

        const fallbackResponse = await this.youtube.liveBroadcasts.insert({
          part: ['snippet', 'status'],
          requestBody: {
            snippet,
            status,
          },
        });
        broadcast = fallbackResponse.data;
      }

      if (broadcast?.id) {
        await this.ensureVideoEmbeddable(broadcast.id);
      }

      this.logger.log(`Broadcast created: ${broadcast.id}`);
      return broadcast;
    } catch (error: any) {
      this.logger.error(error);
      if (error?.code === 401 || error?.code === 403 || error?.response?.status === 401 || error?.response?.status === 403) {
        throw new ForbiddenException(
          `YouTube authorization failed: ${error?.message || 'Authentication required'}`,
        );
      }
      throw new InternalServerErrorException(
        `Failed to create broadcast: ${error.message}`,
      );
    }
  }

  /**
   * Create stream + bind to broadcast (Nest YouTube client)
   */
  async setupStream(
    broadcastId: string,
    title: string,
  ): Promise<StreamSession> {
    try {
      await this.ensureValidToken();
      this.logger.log(`Setting up stream for ${broadcastId} via Nest YouTube client`);

      const streamRes = await this.youtube.liveStreams.insert({
        part: ['snippet', 'cdn'],
        requestBody: {
          snippet: { title },
          cdn: {
            frameRate: '30fps',
            ingestionType: 'rtmp',
            resolution: '720p',
          },
        },
      });

      const streamId = streamRes.data.id!;
      await this.youtube.liveBroadcasts.bind({
        id: broadcastId,
        part: ['id', 'contentDetails'],
        streamId,
      });

      const ingestionInfo = streamRes.data.cdn?.ingestionInfo;
      const rtmpUrl = ingestionInfo?.ingestionAddress || '';
      const streamKey = ingestionInfo?.streamName || '';

      await this.ensureVideoEmbeddable(broadcastId);

      const session: StreamSession = {
        broadcastId,
        streamId,
        rtmpUrl,
        streamKey,
        streamUrl: `${rtmpUrl}/${streamKey}`,
      };

      this.logger.log(`RTMP URL: ${session.streamUrl}`);
      return session;
    } catch (error: any) {
      this.logger.error(error);
      if (error?.code === 401 || error?.code === 403 || error?.response?.status === 401 || error?.response?.status === 403) {
        throw new ForbiddenException(
          `YouTube authorization failed: ${error?.message || 'Authentication required'}`,
        );
      }
      throw new InternalServerErrorException(
        `Failed to setup stream: ${error.message}`,
      );
    }
  }

  /**
   * Create full stream session
   */
  
// network_platform,
// stream_title,
// streamURL,
// status enum live, pre-recorded,
// scheduledDate, 05/16/2026, 10:15:00
// category: gaming
// thumbnail URL,
// description

  // async startStream(
  //   userId: number,
  //   title: string,
  //   description?: string,
  //   network_platform?: string,
  //   stream_url?: string,
  //   status?: 'live' | 'pre-recorded',
  //   scheduledDate?: Date,
  //   category?: string,
  //   thumbnailUrl?: string,
  //   liveTiming?: string,
  //   preRecordedTiming?: string,
  //   recordedVideoUrl?: string,
  //   duration?: string,
  //   options?: {
  //     privacyStatus?: 'public' | 'private' | 'unlisted';
  //   },
  // ): Promise<StreamSession> {
  //   // check that userId starting a quiz if a superadmin or subadmin user.
  //   let check_user = await prisma.user.findUnique({
  //     where: {
  //       id: userId,
  //     },
  //     select: {
  //       id: true,
  //       roleName: true,
  //     },
  //   });
  //     if (!check_user) {
  //       throw new InternalServerErrorException(
  //         `User not found`,
  //       );
  //     }

  //     if(check_user.roleName !== 'superadmin' && check_user.roleName !== 'subadmin') {
  //       throw new InternalServerErrorException(
  //         `Unauthorized`,
  //       );
  //     }

  //   const broadcast = await this.createBroadcast(
  //     title,
  //     options?.privacyStatus,
  //   );
  //   const setup_stream = await this.setupStream(broadcast.id!, title);


  //   let createStream = await prisma.stream.create({
  //     data: {
  //       title,
  //       description,
  //       userId,
  //       privacyStatus: options?.privacyStatus,
  //       networkPlatform: network_platform,
  //       status: status,
  //       scheduledDate,
  //       liveTiming,
  //       preRecordedTiming,
  //       recordedVideoUrl,
  //       duration,
  //       category,
  //       thumbnailUrl,
  //       broadcastId: broadcast.id!,
  //       streamId: setup_stream.streamId,
  //       rtmpUrl: setup_stream.rtmpUrl,
  //       streamKey: setup_stream.streamKey,
  //       streamUrl: setup_stream.streamUrl || stream_url,
  //     },
  //   });

  //   return createStream;
  // }

  async startStream(
  userId: number,
  title: string,
  description?: string,
  network_platform?: string,
  stream_url?: string,
  status?: 'live' | 'pre-recorded',
  scheduledDate?: Date,
  category?: string,
  thumbnailUrl?: string,
  liveTiming?: 'going_now' | 'schedule_for_later',
  preRecordedTiming?: 'available_now' | 'schedule_for_later',
  recordedVideoUrl?: string,
  duration?: string,
  options?: {
    privacyStatus?: 'public' | 'private' | 'unlisted';
  },
): Promise<StreamSession> {
  const checkUser = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      roleName: true,
    },
  });

  if (!checkUser) {
    throw new InternalServerErrorException('User not found');
  }

  if (
    checkUser.roleName !== 'superadmin' &&
    checkUser.roleName !== 'subadmin'
  ) {
    throw new UnauthorizedException('Unauthorized');
  }

  let broadcastId: string | undefined;
  let streamId: string | undefined;
  let rtmpUrl: string | undefined;
  let streamKey: string | undefined;
  let streamUrl: string | undefined;

  if (status === 'live') {
    const broadcast = await this.createBroadcast(
      title,
      options?.privacyStatus,
    );

    const setupStream = await this.setupStream(
      broadcast.id!,
      title,
    );

    broadcastId = broadcast.id!;
    streamId = setupStream.streamId;
    rtmpUrl = setupStream.rtmpUrl;
    streamKey = setupStream.streamKey;
    streamUrl = setupStream.streamUrl;
  }

  const createStream = await prisma.stream.create({
    data: {
      title,
      description,
      userId,
      privacyStatus: options?.privacyStatus,
      networkPlatform: network_platform,
      status,
      scheduledDate,
      liveTiming,
      preRecordedTiming,
      recordedVideoUrl,
      duration,
      category,
      thumbnailUrl,

      // only populated for live streams
      broadcastId: broadcastId ?? null,
      streamId,
      rtmpUrl,
      streamKey,

      // use generated stream URL for live,
      // otherwise use the provided URL
      streamUrl: streamUrl || stream_url,
    },
  });

  return createStream;
}

async editStream(
  userId: number,
  streamId: number,
  title?: string,
  description?: string,
  network_platform?: string,
  stream_url?: string,
  status?: 'live' | 'pre-recorded',
  scheduledDate?: Date,
  category?: string,
  thumbnailUrl?: string,
  liveTiming?: 'going_now' | 'schedule_for_later',
  preRecordedTiming?: 'available_now' | 'schedule_for_later',
  recordedVideoUrl?: string,
  duration?: string,
  privacyStatus?: 'public' | 'private' | 'unlisted'
): Promise<StreamSession> {
  const checkUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, roleName: true },
  });

  if (!checkUser) {
    throw new InternalServerErrorException('User not found');
  }

  if (
    checkUser.roleName !== 'superadmin' &&
    checkUser.roleName !== 'subadmin'
  ) {
    throw new UnauthorizedException('Unauthorized');
  }

  const existingStream = await prisma.stream.findUnique({
    where: { id: streamId },
  });

  if (!existingStream) {
    throw new InternalServerErrorException('Stream not found');
  }

  const updatedStream = await prisma.stream.update({
    where: { id: streamId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(network_platform !== undefined && { networkPlatform: network_platform }),
      ...(status !== undefined && { status }),
      ...(scheduledDate !== undefined && { scheduledDate }),
      ...(category !== undefined && { category }),
      ...(thumbnailUrl !== undefined && { thumbnailUrl }),
      ...(liveTiming !== undefined && { liveTiming }),
      ...(preRecordedTiming !== undefined && { preRecordedTiming }),
      ...(recordedVideoUrl !== undefined && { recordedVideoUrl }),
      ...(duration !== undefined && { duration }),
      ...(privacyStatus !== undefined && { privacyStatus: privacyStatus }),

      // only update streamUrl if the stream is not live
      // (live streams use the generated URL from createBroadcast/setupStream)
      ...(stream_url !== undefined &&
        existingStream.status !== 'live' && { streamUrl: stream_url }),
    },
  });

  return updatedStream;
}

  async getStream() {
    let get_streams = await prisma.stream.findMany();

    const latestStream = get_streams[get_streams.length - 1];
    if (latestStream && latestStream.networkPlatform === 'youtube') {
      try {
        await this.ensureValidToken();
        const activeBroadcasts = await this.youtube.liveBroadcasts.list({
          part: ['id', 'snippet', 'status'],
          broadcastStatus: 'active',
        });
        
        let activeBroadcastId: string | undefined;
        const activeBroadcast = activeBroadcasts.data.items?.[0];
        if (activeBroadcast && activeBroadcast.id) {
          this.logger.log(`Found active YouTube live broadcast: ${activeBroadcast.id}`);
          activeBroadcastId = activeBroadcast.id;
        } else {
          // Fallback to searching active video via channel search
          const channelId = this.configService.get<string>('YOUTUBE_CHANNEL_ID');
          if (channelId) {
            const searchLive = await this.youtube.search.list({
              part: ['snippet'],
              channelId: channelId,
              type: ['video'],
              eventType: 'live',
            });
            const searchItem = searchLive.data.items?.[0];
            if (searchItem && searchItem.id?.videoId) {
              this.logger.log(`Found active live video via search: ${searchItem.id.videoId}`);
              activeBroadcastId = searchItem.id.videoId;
            }
          }
        }

        if (activeBroadcastId && latestStream.broadcastId !== activeBroadcastId) {
          await prisma.stream.update({
            where: { id: latestStream.id },
            data: { 
              broadcastId: activeBroadcastId,
              status: 'live',
            },
          });
          latestStream.broadcastId = activeBroadcastId;
          latestStream.status = 'live';
        }

        // Ensure embedding via Nest YouTube client (Go is independent)
        const embedVideoId = latestStream.broadcastId || activeBroadcastId;
        if (embedVideoId) {
          await this.ensureVideoEmbeddable(embedVideoId);
        }
      } catch (error) {
        this.logger.error(`Failed to fetch active broadcast: ${error.message}`);
      }
    }

    return get_streams;
  }

  /**
   * Force-enable embedding on a YouTube video/broadcast.
   * Best-effort; never throws to the caller.
   */
  private isInvalidEmbedSettingError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('embed setting was invalid') ||
      message.includes('invalidembedsetting')
    ) {
      return true;
    }

    const errors = error?.errors || error?.response?.data?.errors || [];
    return errors.some(
      (entry: any) =>
        entry?.reason === 'invalidEmbedSetting' ||
        String(entry?.message || '')
          .toLowerCase()
          .includes('embed setting was invalid'),
    );
  }

  private async ensureVideoEmbeddable(videoId: string): Promise<void> {
    try {
      const listed = await this.youtube.videos.list({
        part: ['status'],
        id: [videoId],
      });
      const existing = listed.data.items?.[0];
      if (!existing?.status) {
        return;
      }

      if (existing.status.embeddable === true) {
        return;
      }

      await this.youtube.videos.update({
        part: ['status'],
        requestBody: {
          id: videoId,
          status: {
            embeddable: true,
            privacyStatus: existing.status.privacyStatus || 'public',
            selfDeclaredMadeForKids:
              existing.status.selfDeclaredMadeForKids ?? false,
          },
        },
      });
      this.logger.log(`Enabled embedding for YouTube video ${videoId}`);
    } catch (error: any) {
      this.logger.warn(
        `Could not enable embedding for ${videoId}: ${error?.message || error}`,
      );
    }

    try {
      const broadcast = await this.youtube.liveBroadcasts.list({
        part: ['id', 'contentDetails', 'status', 'snippet'],
        id: [videoId],
      });
      const item = broadcast.data.items?.[0];
      if (!item?.id || item.contentDetails?.enableEmbed === true) {
        return;
      }

      await this.youtube.liveBroadcasts.update({
        part: ['id', 'contentDetails', 'status', 'snippet'],
        requestBody: {
          id: item.id,
          snippet: {
            title: item.snippet?.title || 'Livestream',
            scheduledStartTime:
              item.snippet?.scheduledStartTime || new Date().toISOString(),
          },
          status: {
            privacyStatus: item.status?.privacyStatus || 'public',
          },
          contentDetails: {
            ...item.contentDetails,
            enableEmbed: true,
            monitorStream: item.contentDetails?.monitorStream || {
              enableMonitorStream: true,
              broadcastStreamDelayMs: 0,
            },
          },
        },
      });
      this.logger.log(`Enabled enableEmbed on live broadcast ${videoId}`);
    } catch (error: any) {
      if (this.isInvalidEmbedSettingError(error)) {
        this.logger.warn(
          `YouTube account cannot enable embed via API for ${videoId}; stream created without embed flag`,
        );
        return;
      }
      this.logger.warn(
        `Could not update liveBroadcast enableEmbed for ${videoId}: ${error?.message || error}`,
      );
    }
  }

  /**
   * Transition to LIVE (Nest YouTube client)
   */
  async goLive(broadcastId: string): Promise<void> {
    try {
      await this.ensureValidToken();
      await this.youtube.liveBroadcasts.transition({
        id: broadcastId,
        broadcastStatus: 'live',
        part: ['id', 'status'],
      });
      this.logger.log(`Broadcast ${broadcastId} is LIVE`);
    } catch (error: any) {
      throw new InternalServerErrorException(
        `Failed to go live: ${error.message}`,
      );
    }
  }

  async getCommentStreamId(commentId: number): Promise<number | null> {
    const comment = await prisma.streamComment.findUnique({
      where: { id: commentId },
      select: { streamId: true },
    });
    return comment?.streamId ?? null;
  }

  private async isStreamModerator(userId: number): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { roleName: true },
    });
    const role = String(user?.roleName ?? '').toLowerCase();
    return (
      role === Role.superadmin ||
      role === Role.subadmin ||
      role === Role.moderator
    );
  }

  private getStreamUserBanDelegate() {
    const banDelegate = (prisma as { streamUserBan?: {
      findUnique: Function;
      upsert: Function;
      deleteMany: Function;
    } }).streamUserBan;

    if (!banDelegate?.findUnique || !banDelegate?.upsert || !banDelegate?.deleteMany) {
      return null;
    }

    return banDelegate;
  }

  private async assertStreamParticipation(
    streamId: number,
    userId: number,
    options?: { bypassChatLock?: boolean },
  ) {
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { lockChat: true },
    });

    if (!stream) {
      throw new NotFoundException(`Stream with ID ${streamId} not found.`);
    }

    if (stream.lockChat && !options?.bypassChatLock) {
      throw new ForbiddenException('Chat is locked for this stream');
    }

    const banDelegate = this.getStreamUserBanDelegate();
    if (!banDelegate) {
      this.logger.warn(
        'prisma.streamUserBan is unavailable; skipping stream ban check (run prisma generate)',
      );
      return;
    }

    try {
      const streamBan = await banDelegate.findUnique({
        where: {
          streamId_userId: {
            streamId,
            userId,
          },
        },
      });

      if (streamBan) {
        throw new ForbiddenException('You are banned from this stream');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.warn(
        `Stream ban check failed for stream=${streamId} user=${userId}: ${
          (error as Error)?.message || error
        }`,
      );
    }
  }

  async banUserFromStream(
    streamId: number,
    userId: number,
    bannedBy: number,
    banReason?: string,
  ) {
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true },
    });

    if (!stream) {
      throw new NotFoundException(`Stream with ID ${streamId} not found.`);
    }

    const banDelegate = this.getStreamUserBanDelegate();
    if (!banDelegate) {
      throw new InternalServerErrorException(
        'Stream ban model is unavailable. Run prisma generate / migrate and restart.',
      );
    }

    await banDelegate.upsert({
      where: {
        streamId_userId: {
          streamId,
          userId,
        },
      },
      create: {
        streamId,
        userId,
        bannedBy,
        banReason: banReason || 'Banned from stream',
      },
      update: {
        bannedBy,
        banReason: banReason || 'Banned from stream',
      },
    });

    return {
      streamId,
      userId,
      isBanned: true,
      banReason: banReason || 'Banned from stream',
    };
  }

  async unbanUserFromStream(streamId: number, userId: number) {
    const banDelegate = this.getStreamUserBanDelegate();
    if (!banDelegate) {
      throw new InternalServerErrorException(
        'Stream ban model is unavailable. Run prisma generate / migrate and restart.',
      );
    }

    await banDelegate.deleteMany({
      where: { streamId, userId },
    });

    return {
      streamId,
      userId,
      isBanned: false,
    };
  }

  async clearStreamBans(streamId: number) {
    const banDelegate = this.getStreamUserBanDelegate();
    if (!banDelegate) {
      this.logger.warn(
        'prisma.streamUserBan is unavailable; skipping clearStreamBans',
      );
      return;
    }

    await banDelegate.deleteMany({
      where: { streamId },
    });
  }

  async clearStreamBansForBroadcast(broadcastId: string) {
    const stream = await prisma.stream.findFirst({
      where: { broadcastId },
      select: { id: true },
    });

    if (stream?.id) {
      await this.clearStreamBans(stream.id);
    }
  }

  async commentOnStream(streamId: number, comment: string, userId: number): Promise<any> {
    try {
      await this.assertStreamParticipation(streamId, userId, {
        bypassChatLock: await this.isStreamModerator(userId),
      });

      let stream_comment = await prisma.streamComment.create({
        data: {
          streamId,
          message: comment,
          userId,
          isDeleted: false,
        },
      });

      await this.redis.del(`stream:${streamId}:comments`);
      await this.redis.del('stream:global:comments');

      try {
        await this.elasticSearch.indexComment({
          id: stream_comment.id,
          streamId,
          content: comment,
          parentId: 'comment',
        });
      } catch (indexError: any) {
        this.logger.warn(
          `Failed to index stream comment ${stream_comment.id}: ${indexError?.message || indexError}`,
        );
      }

      try {
        if (!(await this.hasSubmittedLiveQuizForStream(streamId, userId))) {
          await this.submitLiveQuizAnswerFromMessage(streamId, comment, userId);
        }
      } catch (quizError: any) {
        this.logger.warn(
          `Failed live quiz side-effect for stream comment ${stream_comment.id}: ${quizError?.message || quizError}`,
        );
      }

      const author = await this.getUserPublicProfile(userId);
      return this.toCommentBroadcastPayload(stream_comment, author);
    } catch(error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to comment on stream: ${error.message}`,
      );
    }
  }

  async deleteComment(commentId: number) {
    try {
      const findComment = await prisma.streamComment.findFirst({
        where: { id: commentId },
      });

      if (!findComment) {
        throw new NotFoundException(
          `Comment with ID ${commentId} not found.`,
        );
      }

      await prisma.streamComment.update({
        where: { id: findComment.id },
        data: {
          isDeleted: true,
        },
      });

      await this.redis.del(`stream:${findComment.streamId}:comments`);
      await this.redis.del('stream:global:comments');

      return {
        commentId: findComment.id,
        streamId: findComment.streamId,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to delete comment: ${error.message}`,
      );
    }
  }

  async deleteOwnStreamComment(commentId: number, userId: number) {
    const comment = await prisma.streamComment.findUnique({
      where: { id: commentId },
      select: { id: true, streamId: true, userId: true, isDeleted: true },
    });

    if (!comment || comment.isDeleted) {
      throw new NotFoundException(`Comment with ID ${commentId} not found.`);
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    const replies = await prisma.commentReply.findMany({
      where: { commentId },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.commentReply.deleteMany({ where: { commentId } }),
      prisma.streamComment.delete({ where: { id: commentId } }),
    ]);

    await this.redis.del(`stream:${comment.streamId}:comments`);
    await this.redis.del('stream:global:comments');

    await Promise.all([
      this.elasticSearch.deleteComment(commentId),
      ...replies.map((reply) => this.elasticSearch.deleteComment(reply.id)),
    ]);

    return {
      commentId: comment.id,
      streamId: comment.streamId,
    };
  }

  async deleteReply(replyId: number) {
    try {
          let findCommentReply = await prisma.commentReply.findFirst({
        where: { id: replyId }
      })

      if (findCommentReply) {
        await prisma.commentReply.update({
          where: { id: findCommentReply.id },
          data: {
            isDeleted: true
          }
        })
      }

            if (!findCommentReply) {
        throw new NotFoundException(
          `Reply with ID ${replyId} not found.`,
        );
      }
          } catch(error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to delete comment: ${error.message}`,
      );
    }
  }

  async replyToComment(commentId: number, comment: string, userId: number) {
    try {
      const parentComment = await prisma.streamComment.findUnique({
        where: { id: commentId },
        select: { streamId: true, userId: true },
      });

      if (!parentComment) {
        throw new NotFoundException(
          `Comment with ID ${commentId} not found.`,
        );
      }

      await this.assertStreamParticipation(parentComment.streamId, userId, {
        bypassChatLock: await this.isStreamModerator(userId),
      });

      let reply_comment = await prisma.commentReply.create({
        data: {
          commentId,
          message: comment,
          userId,
          isDeleted: false,
        },
      });

      await this.redis.del(`stream:${parentComment.streamId}:comments`);
      await this.redis.del('stream:global:comments');

      try {
        await this.elasticSearch.indexComment({
          id: reply_comment.id,
          streamId: parentComment.streamId,
          content: comment,
          parentId: 'reply',
        });
      } catch (indexError: any) {
        this.logger.warn(
          `Failed to index reply ${reply_comment.id}: ${indexError?.message || indexError}`,
        );
      }

      try {
        if (
          !(await this.hasSubmittedLiveQuizForStream(
            parentComment.streamId,
            userId,
          ))
        ) {
          await this.submitLiveQuizAnswerFromMessage(
            parentComment.streamId,
            comment,
            userId,
          );
        }
      } catch (quizError: any) {
        this.logger.warn(
          `Failed live quiz side-effect for reply ${reply_comment.id}: ${quizError?.message || quizError}`,
        );
      }

      try {
        if (
          parentComment?.userId &&
          parentComment.userId !== userId
        ) {
          await this.notificationService.createNotification(
            parentComment.userId,
            'You got a reply to your comment!',
            comment,
          );
        }
      } catch (notifError) {
        this.logger.error(
          `Failed to send reply notification: ${notifError.message}`,
        );
      }

      const author = await this.getUserPublicProfile(userId);
      return this.toCommentBroadcastPayload(
        {
          ...reply_comment,
          streamId: parentComment.streamId,
          parentCommentId: reply_comment.commentId,
        },
        author,
      );

    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to comment on stream: ${error.message}`,
      );
    }
  }

  async likeComment(commentId: number, userId: number) {
  try {
    const existing = await prisma.streamComment.findUnique({
      where: { id: commentId },
      select: { id: true, streamId: true, likesCount: true, isDeleted: true },
    });

    if (!existing || existing.isDeleted) {
      throw new NotFoundException(`Comment with ID ${commentId} not found.`);
    }

    const alreadyLiked = await prisma.commentLike.findUnique({
      where: {
        commentId_userId: {
          commentId,
          userId,
        },
      },
      select: { id: true },
    });

    if (alreadyLiked) {
      return {
        message: 'Comment already liked',
        data: existing,
      };
    }

    await prisma.commentLike.create({
      data: {
        commentId,
        userId,
      },
    });

    const like_comment = await prisma.streamComment.update({
      where: {
        id: commentId,
      },
      data: {
        likesCount: {
          increment: 1,
        },
      },
    });



    // send notification to the comment owner
    try {

      // let fetch_user_id = like_comment.userId

      let getUsername = await prisma.user.findUnique({
        where: {id: like_comment.userId },
        select: {username: true}
      })
      if (like_comment && like_comment.userId && like_comment.userId !== userId) {
        await this.notificationService.createNotification(
          like_comment.userId,
          'Comment liked',
          `${getUsername.username} liked your comment.`,
        );
      }
    } catch (notifError) {
      this.logger.error(`Failed to send like notification: ${notifError.message}`);
    }

    return {
      message: 'Comment liked successfully',
      data: like_comment,
    };
  } catch(error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException(
      `Failed to like comment: ${error.message}`,
    );
  }
}

async unlikeComment(commentId: number, userId: number) {
  try {
    // Delete the comment like
    await prisma.commentLike.delete({
      where: {
        commentId_userId: {
          commentId,
          userId
        }
      }
    });

    // Decrement the likes count in streamComment
    let unlike_comment = await prisma.streamComment.update({
      where: {
        id: commentId,
      },
      data: {
        likesCount: {
          decrement: 1,
        },
      },
    });

    return {message: 'Comment unliked successfully', data: unlike_comment};
  } catch(error) {
    throw new InternalServerErrorException(
      `Failed to unlike comment: ${error.message}`,
    );
  }
}

async reportComment(commentId: number, creatorId: number, userId: number, reason: string) {
  try {
          let report_comment = await prisma.commentReport.create({
        data: {
          commentId,
          reason,
          userId
        }
      })

      // increment reportsCount in streamComment
      const updatedComment = await prisma.streamComment.update({
        where: {
          id: commentId,
        },
        data: {
          reportsCount: {
            increment: 1,
          },
        },
      });

      await prisma.userHistory.create({
        data: {
          userId, 
          creatorId,
          title: reason,
          description: reason,
          type: 'REPORT',
          submittedBy: 'USER'
        }
      })

      return {
        ...report_comment,
        reportsCount: updatedComment.reportsCount,
      };

  } catch(error) {
          throw new InternalServerErrorException(
        `Failed to report comment: ${error.message}`,
      );
  }
}

async getStreamCommentsandReplies(streamId?: number) {
  // Live chat is shared across streams — serve one global recent feed.
  const cacheKey = 'stream:global:comments';

  const cached = await this.redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const comments = await prisma.streamComment.findMany({
    where: {
      isDeleted: false,
    },
    include: {
      replies: {
        where: { isDeleted: false },
      },
      stream: {
        select: {
          id: true,
          title: true,
        },
      },
    },
    orderBy: [
      { isPinned: 'desc' },
      { createdAt: 'desc' },
    ],
    take: 500,
  });

  // Prefer a pinned comment for the active stream at the front when present.
  let result = comments;
  if (streamId) {
    const pinnedForStream = comments.find(
      (comment) => comment.streamId === streamId && comment.isPinned,
    );
    if (pinnedForStream) {
      result = [
        pinnedForStream,
        ...comments.filter((comment) => comment.id !== pinnedForStream.id),
      ];
    }
  }

  const allUserIds = Array.from(
    new Set(
      result
        .flatMap((item) => [
          item.userId,
          ...(Array.isArray(item.replies) ? item.replies.map((reply) => reply.userId) : []),
        ])
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
    ),
  );

  const users = allUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: allUserIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          profilePicture: true,
        },
      })
    : [];

  const userMap = new Map(
    users.map((user) => [
      user.id,
      {
        displayName: this.buildDisplayName(user, user.id),
        avatarUrl: this.toHttpsAvatarUrl(
          user.profilePicture,
          this.buildDisplayName(user, user.id),
        ),
        profilePicture: user.profilePicture || undefined,
        username: user.username || this.buildDisplayName(user, user.id),
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
      },
    ]),
  );

  const enriched = result.map((comment) => {
    const commentUser =
      userMap.get(comment.userId) || {
        displayName: `User${comment.userId}`,
        avatarUrl: this.toHttpsAvatarUrl(null, `User${comment.userId}`),
        username: `User${comment.userId}`,
        firstName: undefined as string | undefined,
        lastName: undefined as string | undefined,
      };

    const replies = Array.isArray(comment.replies)
      ? comment.replies.map((reply) => {
          const replyUser =
            userMap.get(reply.userId) || {
              displayName: `User${reply.userId}`,
              avatarUrl: this.toHttpsAvatarUrl(null, `User${reply.userId}`),
              username: `User${reply.userId}`,
              firstName: undefined as string | undefined,
              lastName: undefined as string | undefined,
            };

          return {
            ...reply,
            parentCommentId: reply.commentId,
            displayName: replyUser.displayName,
            avatarUrl: replyUser.avatarUrl,
            profilePicture: replyUser.profilePicture,
            username: replyUser.username,
            firstName: replyUser.firstName,
            lastName: replyUser.lastName,
            name: replyUser.displayName,
            fullName: replyUser.displayName,
            image: replyUser.avatarUrl,
            profileImage: replyUser.avatarUrl,
            avatar: replyUser.avatarUrl,
            user: {
              id: reply.userId,
              firstName: replyUser.firstName,
              lastName: replyUser.lastName,
              username: replyUser.username,
              displayName: replyUser.displayName,
              avatarUrl: replyUser.avatarUrl,
              profilePicture: replyUser.profilePicture,
            },
          };
        })
      : [];

    return {
      ...comment,
      replies,
      displayName: commentUser.displayName,
      avatarUrl: commentUser.avatarUrl,
      profilePicture: commentUser.profilePicture,
      username: commentUser.username,
      firstName: commentUser.firstName,
      lastName: commentUser.lastName,
      name: commentUser.displayName,
      fullName: commentUser.displayName,
      image: commentUser.avatarUrl,
      profileImage: commentUser.avatarUrl,
      avatar: commentUser.avatarUrl,
      user: {
        id: comment.userId,
        firstName: commentUser.firstName,
        lastName: commentUser.lastName,
        username: commentUser.username,
        displayName: commentUser.displayName,
        avatarUrl: commentUser.avatarUrl,
        profilePicture: commentUser.profilePicture,
      },
    };
  });

  await this.redis.set(
    cacheKey,
    JSON.stringify(enriched),
    60, // 1 minute
  );

  return enriched;
}

async getStreamChatStatus(streamId: number) {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { id: true, lockChat: true },
  });

  if (!stream) {
    throw new NotFoundException(`Stream with ID ${streamId} not found.`);
  }

  return {
    streamId: stream.id,
    locked: Boolean(stream.lockChat),
  };
}

async setStreamChatLock(streamId: number, locked: boolean, adminId: number) {
  try {
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true },
    });

    if (!stream) {
      throw new NotFoundException(`Stream with ID ${streamId} not found.`);
    }

    const updated = await prisma.stream.update({
      where: { id: streamId },
      data: { lockChat: locked },
      select: { id: true, lockChat: true },
    });

    await prisma.streamChatLockLog.create({
      data: {
        streamId,
        adminId,
        action: locked ? 'lock' : 'unlock',
      },
    });

    await this.redis.del(`stream:${streamId}:comments`);
    await this.redis.del('stream:global:comments');

    const timestamp = new Date().toISOString();

    this.logger.log(
      `Stream chat ${locked ? 'locked' : 'unlocked'} by admin ${adminId} for stream ${streamId} at ${timestamp}`,
    );

    return {
      streamId: updated.id,
      locked: Boolean(updated.lockChat),
      action: locked ? 'lock' : 'unlock',
      adminId,
      timestamp,
    };
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException(
      `Failed to ${locked ? 'lock' : 'unlock'} chat: ${error.message}`,
    );
  }
}

async lockandUnlockChat(streamId: number, lock: boolean, adminId?: number) {
  if (!adminId) {
    return this.setStreamChatLock(streamId, lock, 0);
  }
  return this.setStreamChatLock(streamId, lock, adminId);
}

async pinComment(commentId: number) {
  try {
    const target = await prisma.streamComment.findUnique({
      where: { id: commentId },
      select: { id: true, streamId: true, isDeleted: true },
    });

    if (!target || target.isDeleted) {
      throw new NotFoundException(`Comment with ID ${commentId} not found.`);
    }

    await prisma.$transaction([
      prisma.streamComment.updateMany({
        where: {
          streamId: target.streamId,
          isPinned: true,
        },
        data: {
          isPinned: false,
        },
      }),
      prisma.streamComment.update({
        where: { id: commentId },
        data: {
          isPinned: true,
        },
      }),
    ]);

    return prisma.streamComment.findUnique({
      where: { id: commentId },
    });
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException(
      `Failed to pin comment: ${error.message}`,
    );
  }
}

async unpinComment(commentId: number) {
  try {
    const target = await prisma.streamComment.findUnique({
      where: { id: commentId },
      select: { id: true, isDeleted: true },
    });
    if (!target || target.isDeleted) {
      throw new NotFoundException(`Comment with ID ${commentId} not found.`);
    }

    return prisma.streamComment.update({
      where: { id: commentId },
      data: {
        isPinned: false,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException(
      `Failed to unpin comment: ${error.message}`,
    );
  }
}

  async searchStreamChatComments(
    streamId: number,
    query: string,
    page = 1,
    limit = 20,
  ) {
    const keyword = String(query ?? '').trim();
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit)
      ? Math.min(Math.max(Math.floor(limit), 1), 100)
      : 20;

    if (!keyword) {
      return {
        items: [],
        page: safePage,
        limit: safeLimit,
        total: 0,
        hasNext: false,
      };
    }

    const where = {
      streamId,
      isDeleted: false,
      message: {
        contains: keyword,
        mode: 'insensitive' as const,
      },
    };

    const [total, comments] = await Promise.all([
      prisma.streamComment.count({ where }),
      prisma.streamComment.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          message: true,
          userId: true,
          createdAt: true,
          likesCount: true,
        },
      }),
    ]);

    const userIds = Array.from(
      new Set(
        comments
          .map((comment) => comment.userId)
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
      ),
    );

    const users = userIds.length
      ? await prisma.user.findMany({
          where: {
            id: {
              in: userIds,
            },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profilePicture: true,
          },
        })
      : [];

    const usersById = new Map(
      users.map((user) => [
        user.id,
        {
          displayName: this.buildDisplayName(user, user.id),
          avatarUrl: this.toHttpsAvatarUrl(
            user.profilePicture,
            this.buildDisplayName(user, user.id),
          ),
        },
      ]),
    );

    const items = comments.map((comment) => {
      const profile = usersById.get(comment.userId) || {
        displayName: `User${comment.userId}`,
        avatarUrl: this.toHttpsAvatarUrl(null, `User${comment.userId}`),
      };

      return {
        id: comment.id,
        message: comment.message,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        createdAt: comment.createdAt.toISOString(),
        timestamp: comment.createdAt.toISOString(),
        likesCount: Number(comment.likesCount ?? 0),
      };
    });

    return {
      items,
      page: safePage,
      limit: safeLimit,
      total,
      hasNext: safePage * safeLimit < total,
    };
  }

async isWinner(commentId: number, winAmount: number) {
  try {
    let pin_comment = await prisma.streamComment.update({
      where: { id: commentId },
      data: {
        isWinner: true,
        winAmount: winAmount
      },
    });
    return pin_comment;
  } catch (error) {
    throw new InternalServerErrorException(
      `Failed to pin comment: ${error.message}`,
    );
  }
}


  /**
   * End stream (Nest YouTube client)
   */
  async endStream(broadcastId: string): Promise<void> {
    try {
      await this.ensureValidToken();
      await this.youtube.liveBroadcasts.transition({
        id: broadcastId,
        broadcastStatus: 'complete',
        part: ['id', 'status'],
      });
      await this.clearStreamBansForBroadcast(broadcastId);
      this.logger.log(`Broadcast ${broadcastId} completed`);
    } catch (error: any) {
      throw new InternalServerErrorException(
        `Failed to end stream: ${error.message}`,
      );
    }
  }

  async getVideoViews(videoId: string): Promise<any> {
    try {
      await this.ensureValidToken();
      const response = await this.youtube.videos.list({
        id: [videoId],
        part: ['statistics', 'snippet', 'liveStreamingDetails', 'status'],
      });

      const videoItem = response.data.items?.[0];

      if (!videoItem) {
        throw new HttpException('Video not found', HttpStatus.NOT_FOUND);
      }

      return videoItem;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to fetch YouTube data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getYoutubeViewerCountForStream(streamId: number): Promise<number | null> {
    try {
      const stream = await prisma.stream.findUnique({
        where: { id: streamId },
        select: {
          id: true,
          broadcastId: true,
          networkPlatform: true,
        },
      });

      if (!stream?.broadcastId) {
        return null;
      }

      const network = String(stream.networkPlatform ?? '').toLowerCase();
      if (network && network !== 'youtube') {
        return null;
      }

      const videoData = await this.getVideoViews(stream.broadcastId);
      const concurrentViewers = Number.parseInt(
        videoData?.liveStreamingDetails?.concurrentViewers || '',
        10,
      );
      if (Number.isFinite(concurrentViewers)) {
        return concurrentViewers;
      }

      const viewCount = Number.parseInt(
        videoData?.statistics?.viewCount || '',
        10,
      );
      if (Number.isFinite(viewCount)) {
        return viewCount;
      }

      return 0;
    } catch (error: any) {
      this.logger.warn(
        `Failed to fetch YouTube viewer count for stream ${streamId}: ${error?.message || error}`,
      );
      return null;
    }
  }

  async getUserChatFeed(streamId: number) {
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true, lockChat: true },
    });

    if (!stream) {
      throw new NotFoundException(`Stream with ID ${streamId} not found.`);
    }

    const comments = await this.getStreamCommentsandReplies(streamId);

    return {
      streamId,
      locked: stream.lockChat,
      comments,
      realtime: {
        transport: 'websocket',
        scope: 'global',
        events: [
          'streamMessage',
          'replyMessage',
          'likeComment',
          'unlikeComment',
          'deleteComment',
          'chatLockChanged',
          'streamViewerCount',
        ],
        viewerCount: {
          room: `stream-${streamId}`,
          joinEvent: 'joinStream',
          leaveEvent: 'leaveStream',
        },
      },
    };
  }

  async buildStreamSharePayload(streamId: number) {
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        title: true,
        broadcastId: true,
        streamUrl: true,
        networkPlatform: true,
      },
    });

    if (!stream) {
      throw new NotFoundException(`Stream with ID ${streamId} not found.`);
    }

    const clientOrigin = this.resolveClientAppOrigin();
    const youtubeWatchUrl =
      stream.broadcastId && stream.networkPlatform === 'youtube'
        ? `https://www.youtube.com/watch?v=${stream.broadcastId}`
        : null;
    const shareUrl =
      youtubeWatchUrl || stream.streamUrl || `${clientOrigin}/dashboard`;

    return {
      streamId: stream.id,
      title: stream.title,
      shareUrl,
      watchUrl: youtubeWatchUrl || stream.streamUrl || null,
      appUrl: `${clientOrigin}/dashboard`,
    };
  }

  private resolveClientAppOrigin(): string {
    const configured =
      this.configService.get<string>('CLIENT_FRONTEND_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      'https://superfan-client.vercel.app';

    const trimmed = configured.trim().replace(/\/$/, '');
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    return `https://${trimmed}`;
  }
}
