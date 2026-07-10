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

  private readonly SCOPES = [

  ];

  private oauth2Client: OAuth2Client;
  private youtube: youtube_v3.Youtube;
  private youtubeTokensLoaded = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly redis: RedisService,
    private readonly quizService: QuizService,
    private readonly elasticSearch: ElasticsearchService
  ) {
     this.initialize();
    this.logger.log('YouTube service initialized successfully');
  }

  private normalizeQuizOption(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private toHttpsAvatarUrl(value?: string | null): string {
    const raw = String(value ?? '').trim();
    if (!raw) return this.defaultAvatarUrl;
    if (raw.startsWith('https://')) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('http://')) return raw.replace(/^http:\/\//i, 'https://');
    // Non-URL or relative path: do not expose unsafe URL to clients
    return this.defaultAvatarUrl;
  }

  private buildDisplayName(user?: {
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  }, fallbackUserId?: number): string {
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    if (fullName) return fullName;
    if (user?.username) return user.username;
    return `User${fallbackUserId || ''}`.trim() || 'User';
  }

  private async getUserPublicProfile(userId: number): Promise<{
    id: number;
    displayName: string;
    avatarUrl: string;
    username: string;
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

    return {
      id: userId,
      displayName: this.buildDisplayName(user || undefined, userId),
      avatarUrl: this.toHttpsAvatarUrl(user?.profilePicture),
      username: user?.username || this.buildDisplayName(user || undefined, userId),
    };
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

    /**
     * Support both web + installed credentials
     */
    const credentials = keys.web;
    if (!credentials) {
      throw new Error(
        'Invalid credentials.json. Missing web or installed object',
      );
    }

    const redirectUri =
      configuredRedirectUri ||
      credentials.redirect_uris?.[0] ||
      (credentials as any).redirectUri;

    if (!redirectUri) {
      throw new Error(
        'Invalid credentials.json. Missing redirect URI for OAuth2 client',
      );
    }

    this.oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
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

      const response = await this.youtube.liveBroadcasts.insert({
        part: ['snippet', 'status', 'contentDetails'],
        requestBody: {
          snippet: {
            title,
            description: '',
            scheduledStartTime: new Date(Date.now() + 60_000).toISOString(),
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: false,
          },
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

      const broadcast = response.data;
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

  async commentOnStream(streamId: number, comment: string, userId: number): Promise<any> {
    try {
      let stream_comment = await prisma.streamComment.create({
        data: {
          streamId,
          message: comment,
          userId,
          isDeleted: false,
        },
      });

      let index_comment = await this.elasticSearch.indexComment({
        id: stream_comment.id,
        streamId,
        content: comment,
        parentId: 'comment'
      });

      if (!(await this.hasSubmittedLiveQuizForStream(streamId, userId))) {
        await this.submitLiveQuizAnswerFromMessage(streamId, comment, userId);
      }

      const author = await this.getUserPublicProfile(userId);
      return {
        ...stream_comment,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl,
        username: author.username,
        name: author.displayName,
        fullName: author.displayName,
        image: author.avatarUrl,
        profileImage: author.avatarUrl,
        avatar: author.avatarUrl,
      };
    } catch(error) {
      throw new InternalServerErrorException(
        `Failed to comment on stream: ${error.message}`,
      );
    }
  }

  async deleteComment(commentId: number) {
    console.log(commentId, 'log commentId')
    try {
      // Check and update streamComment if it exists
      let findComment = await prisma.streamComment.findFirst({
        where: { id: commentId }
      })
      console.log(findComment, 'findComments for deleteComment')

      if (findComment) {
        await prisma.streamComment.update({
          where: { id: findComment.id },
          data: {
            isDeleted: true
          }
        })
      }

      // Check and update commentReply if it exist

      // Throw error if neither exists
      if (!findComment) {
        throw new NotFoundException(
          `Comment with ID ${commentId} not found.`,
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
      let reply_comment = await prisma.commentReply.create({
        data: {
          commentId,
          message: comment,
          userId,
          isDeleted: false,
        },
      });

      const parentComment = await prisma.streamComment.findUnique({
        where: { id: commentId },
        select: { streamId: true, userId: true },
      });

      if (!parentComment) {
        throw new NotFoundException(
          `Comment with ID ${commentId} not found.`,
        );
      }

            let index_comment = await this.elasticSearch.indexComment({
        id: reply_comment.id,
        streamId: parentComment.streamId,
        content: comment,
        parentId: 'reply'
      });

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
      return {
        ...reply_comment,
        parentCommentId: reply_comment.commentId,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl,
        username: author.username,
        name: author.displayName,
        fullName: author.displayName,
        image: author.avatarUrl,
        profileImage: author.avatarUrl,
        avatar: author.avatarUrl,
      };

    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to comment on stream: ${error.message}`,
      );
    }
  }

  async likeComment(commentId: number, userId: number) {
  try {
    let save_comment_like = await prisma.commentLike.create({
      data: {
        commentId,
        userId
      }
    })
    // update streamComment likes count
    let like_comment = await prisma.streamComment.update({
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
      await prisma.streamComment.update({
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

      return report_comment;

  } catch(error) {
          throw new InternalServerErrorException(
        `Failed to report comment: ${error.message}`,
      );
  }
}

async getStreamCommentsandReplies(streamId: number) {
  const isStreamLocked = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { lockChat: true },
  });

  if (isStreamLocked?.lockChat) {
    throw new ForbiddenException('Chat is locked for this stream');
  }

  const cacheKey = `stream:${streamId}:comments`;

  const cached = await this.redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const [pinnedComment, comments] = await Promise.all([
    prisma.streamComment.findFirst({
      where: {
        streamId,
        isPinned: true,
      },
      include: {
        replies: true,
        stream: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    }),
    prisma.streamComment.findMany({
      where: {
        streamId,
        isPinned: false,
      },
      include: {
        replies: true,
        stream: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  const result = pinnedComment
    ? [pinnedComment, ...comments]
    : comments;

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
        avatarUrl: this.toHttpsAvatarUrl(user.profilePicture),
        username: user.username || this.buildDisplayName(user, user.id),
      },
    ]),
  );

  const enriched = result.map((comment) => {
    const commentUser =
      userMap.get(comment.userId) || {
        displayName: `User${comment.userId}`,
        avatarUrl: this.defaultAvatarUrl,
        username: `User${comment.userId}`,
      };

    const replies = Array.isArray(comment.replies)
      ? comment.replies.map((reply) => {
          const replyUser =
            userMap.get(reply.userId) || {
              displayName: `User${reply.userId}`,
              avatarUrl: this.defaultAvatarUrl,
              username: `User${reply.userId}`,
            };

          return {
            ...reply,
            parentCommentId: reply.commentId,
            displayName: replyUser.displayName,
            avatarUrl: replyUser.avatarUrl,
            username: replyUser.username,
            name: replyUser.displayName,
            fullName: replyUser.displayName,
            image: replyUser.avatarUrl,
            profileImage: replyUser.avatarUrl,
            avatar: replyUser.avatarUrl,
          };
        })
      : [];

    return {
      ...comment,
      replies,
      displayName: commentUser.displayName,
      avatarUrl: commentUser.avatarUrl,
      username: commentUser.username,
      name: commentUser.displayName,
      fullName: commentUser.displayName,
      image: commentUser.avatarUrl,
      profileImage: commentUser.avatarUrl,
      avatar: commentUser.avatarUrl,
    };
  });

  await this.redis.set(
    cacheKey,
    JSON.stringify(enriched),
    60, // 1 minute
  );

  return enriched;
}

async lockandUnlockChat(streamId: number, lock: boolean) {
  try {
    let lock_chat = await prisma.stream.update({
      where: { id: streamId },
      data: {
        lockChat: lock
      },
    });
    return {lock_chat: lock_chat.lockChat};
  } catch (error) {
    throw new InternalServerErrorException(
      `Failed to lock chat: ${error.message}`,
    );
  }
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
          avatarUrl: this.toHttpsAvatarUrl(user.profilePicture),
        },
      ]),
    );

    const items = comments.map((comment) => {
      const profile = usersById.get(comment.userId) || {
        displayName: `User${comment.userId}`,
        avatarUrl: this.defaultAvatarUrl,
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
}
