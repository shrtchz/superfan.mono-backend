import { ClerkService } from '../common/clerk/clerk.service';
import { verifyToken } from '@clerk/backend';
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TestLevel, User } from '@prisma/client';
import * as argon from 'argon2';
import { PostHog } from 'posthog-node';
import { EarningStatus } from '../common/enums/task.enum';
import { generateReferralCode } from '../common/shared/lib';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';
import { ElasticsearchService } from '../elasticsearch/elasticsearch.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notification/notification.service';
import { BitnobService } from '../payment/bitnob.service';
import { BushaService } from '../payment/busha.service';
import { FlutterwaveSuperfanService } from '../payment/flutterwave.service';
import { MonnifyService } from '../payment/monnify.service';
import {
  PaymentDto,
  SubscriptionCardPaymentDto
} from '../payment/payment.dto';
import { prisma } from '../prisma/prisma';
import { TaskService } from '../tasks/tasks.service';
import { WalletService } from '../wallet/wallet.service';
import {
  AuthDto,
  KycDto,
  LoginDto,
  SocialLoginDto,
  UpdateOnboardingDto,
  UpdateUserDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { PresenceGateway } from './gateway/presence.gateway';

type SyncUserMetadata = {
  referralCode?: string;
  ip_address?: string;
  location?: string;
};

@Injectable()
export class UserService {
  constructor(
    private mail: MailService,
    @Inject(forwardRef(() => TaskService))
    private taskService: TaskService,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private monnifyService: MonnifyService,
    private readonly eventEmitter: EventEmitter2,
    private bushaService: BushaService,
    private bitnobService: BitnobService,
    private flutterwaveService: FlutterwaveSuperfanService,
    private readonly posthog: PostHog,
    private presenceGateway: PresenceGateway,
    private readonly es: ElasticsearchService,
    private readonly clerkService: ClerkService,
  ) {}

  async signupUser(dto: AuthDto): Promise<any> {
    // ✅ Check if email already exists
    const existingEmail = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingEmail) {
      throw new ForbiddenException('Email already in use');
    }

    // ✅ Check if phone already exists
    const existingPhone = await prisma.user.findFirst({
      where: { phone: dto.phone },
    });

    if (existingPhone) {
      throw new ForbiddenException('Phone number already in use');
    }

    let referrer = null;

    if (dto.referralCode) {
      referrer = await prisma.user.findUnique({
        where: { referral_code: dto.referralCode },
      });

      if (!referrer) {
        throw new ForbiddenException('Invalid referral code');
      }
    }

    // ✅ ✅ NEW: Check if username already exists
    const existingUsername = await prisma.user.findUnique({
      where: { username: dto.username },
    });

    if (existingUsername) {
      throw new ForbiddenException('Username already taken');
    }

    // ✅ Check if roleName already exists
    let role = await prisma.role.findFirst({
      where: { name: dto.roleName },
    });

    // If role does not exist, create it
    if (!role) {
      role = await prisma.role.create({
        data: {
          name: dto.roleName,
        },
      });
    }

    // Create user in Clerk first
    try {
      await this.clerkService.getClient().users.createUser({
        emailAddress: [dto.email],
        password: dto.password,
        username: dto.username,
        firstName: dto.firstName,
        lastName: dto.lastName || '',
        ...(dto.phone && { phoneNumber: [dto.phone] }),
      });
    } catch (err: any) {
      console.error('Failed to create user in Clerk:', err);
      throw new ForbiddenException(
        err.errors?.[0]?.message || err.message || 'Failed to create user in Clerk'
      );
    }

    const password = await argon.hash(dto.password);

    const referralCode = generateReferralCode(dto.firstName);

    const verificationCode = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();

    const verificationExpiry = new Date(Date.now() + 15 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        username: dto.username,
        password,
        phone: dto.phone,
        roleName: dto.roleName,
        login_method: 'clerk',
        subscriptionPlan: dto.subscriptionPlan || 'FREE',

        referral_code: referralCode,
        referredByCode: dto.referralCode,

        verificationCode,
        verificationCodeExpiry: verificationExpiry,
        active: false,
      },
    });

    // Create wallet for new user
    await prisma.wallet.create({
      data: {
        userId: user.id,
      },
    });

    /**
     * HANDLE REFERRAL
     */
    if (dto.referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referral_code: dto.referralCode },
      });

      if (referrer) {
        await prisma.referral.create({
          data: {
            referrerId: referrer.id,
            refereeId: user.id,
          },
        });

        await this.walletService.creditWallet(
          referrer.id,
          30,
          'Referral signup reward',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
        );

        const referrer_pts = 30000;
          await prisma.point.create({
            data: {
              userId: referrer.id,
              points: referrer_pts,
              reference: `POINTS_${generateFiveUniqueRandomNumbers()}`,
              type: 'referral_reward',
            },
          });

        await this.walletService.userCreateReward(
          referrer.id,
          25,
          'NGN',
          'Referral signup reward',
          EarningStatus.PAID_OUT,
        );

        await this.notificationService.createNotification(
          referrer.id,
          'Referral Reward',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
          'referral_reward'
        );

        await this.walletService.creditWallet(
          user.id,
          10,
          'Referral welcome bonus',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
        );

                // let referreral_pts = 10000;
            // await prisma.point.create({
            //   data: {
            //     userId: user.id,
            //     points: referreral_pts,
            //     reference: `POINTS_${generateFiveUniqueRandomNumbers()}`,
            //     type: 'referral_reward',
            //   }
            //   })

              
        const referreral_pts = 10000;
          await prisma.point.create({
            data: {
              userId: user.id,
              points: referreral_pts,
              reference: `POINTS_${generateFiveUniqueRandomNumbers()}`,
              type: 'referral_reward',
            },
          });

        // INVITER USER ALREADY HAS A ACCOUNT AND WALLET
        await this.walletService.userCreateReward(
          user.id,
          10,
          'NGN',
          'Referral welcome bonus',
          EarningStatus.PAID_OUT,
        );

        await this.notificationService.createNotification(
          user.id,
          'Welcome Bonus',
          'You received ₦10 for signing up with a referral code.',
          'welcome_bonus'
        );
      }
    }


    this.posthog.capture({
      event: 'user_registered',
      // distinctId, sessionId, and request properties
      // are automatically included from the interceptor context
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        userCode: user.id.toString().padStart(4, '0'),
      },
    });

    await this.mail.verifyEmail(dto.email, verificationCode, dto.firstName);

    return {
      message:
        'Signup successful. Please check your email to verify your account.',
      email: user.email,
      id: user.id,
      suscriptionPlan: user.subscriptionPlan,
    };
  }

  async verifyEmailCode(dto: VerifyEmailDto): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    if (user.verificationCode !== dto.verificationCode) {
      throw new ForbiddenException('Invalid verification code');
    }

    if (user.verificationCodeExpiry < new Date()) {
      throw new ForbiddenException('Verification code has expired');
    }

    await prisma.user.update({
      where: { email: dto.email },
      data: {
        active: true,
        verificationCode: null,
        verificationCodeExpiry: null,
      },
    });

        // ✅ Call userRegistered after signup
    await this.taskService.userRegistered({
      id: user.id,
      name: user.username,
      email: user.email,
      role: user.roleName,
    });

    const magicLink = await this.generateMagicLink(user);

    await this.mail.welcomeUserEmail(
      dto.email,
      user.firstName,
      magicLink.magicLinkURI,
    );

    return { message: 'Email verified successfully', id: user.id };
  }

  private formatSyncUser(user: User) {
    const onboarded = Boolean(
      user.languagePreference &&
        user.subjectPreference &&
        user.testLevel &&
        user.questionPreference &&
        user.timePreference,
    );

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      role: user.roleName,
      roleName: user.roleName,
      active: user.active,
      subscriptionPlan: user.subscriptionPlan,
      lastLoginTimeStamp: user.login_timestamp,
      state: user.state,
      country: user.country,
      ip_address: user.ip_address,
      location: user.location,
      profilePicture: user.profilePicture,
      clerkUserId: user.clerkUserId,
      onboarded,
      isOnboarded: onboarded,
    };
  }

  async findUserByClerkId(clerkUserId: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { clerkUserId },
    });
  }

  async syncFromClerkToken(
    authorizationHeader: string | undefined,
    metadata: SyncUserMetadata = {},
  ) {
    const token = (authorizationHeader || '')
      .replace(/^Bearer\s+/i, '')
      .trim();

    if (!token) {
      throw new ForbiddenException('No Clerk session token provided');
    }

    if (token.startsWith('sit_')) {
      throw new ForbiddenException(
        'Clerk sign-in tickets cannot be used for sync. Complete Clerk sign-in first.',
      );
    }

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      clockSkewInMs: 300000,
    });

    const clerkUser = await this.clerkService.getClient().users.getUser(payload.sub);
    return this.syncFromClerk(clerkUser, metadata);
  }

  async syncFromClerk(clerkUser: any, metadata: SyncUserMetadata = {}) {
    const clerkUserId = clerkUser.id as string;
    const email = clerkUser.emailAddresses?.[0]?.emailAddress as
      | string
      | undefined;

    if (!email) {
      throw new BadRequestException('Clerk user has no email address');
    }

    const phone =
      (clerkUser.unsafeMetadata?.phone as string) ||
      clerkUser.phoneNumbers?.[0]?.phoneNumber ||
      '';
    const referralCode =
      metadata.referralCode ||
      (clerkUser.unsafeMetadata?.referralCode as string | undefined);
    const loginMethod =
      clerkUser.externalAccounts?.[0]?.provider || 'clerk';

    let user = await this.findUserByClerkId(clerkUserId);

    if (!user) {
      user = await this.findUserByEmail(email);
      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { clerkUserId },
        });
      }
    }

    if (!user) {
      user = await this.registerClerkUser({
        clerkUserId,
        email,
        firstName: clerkUser.firstName || 'User',
        lastName: clerkUser.lastName || '',
        username:
          clerkUser.username ||
          clerkUser.firstName?.toLowerCase() ||
          `user_${clerkUserId.slice(-6)}`,
        phone,
        login_method: loginMethod,
        referralCode,
      });
    }

    const clerkImageUrl =
      typeof clerkUser.imageUrl === 'string' ? clerkUser.imageUrl.trim() : '';

    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        login_timestamp: new Date(),
        isOnline: true,
        ...(metadata.ip_address ? { ip_address: metadata.ip_address } : {}),
        ...(metadata.location ? { location: metadata.location } : {}),
        ...(clerkImageUrl && !user.profilePicture?.trim()
          ? { profilePicture: clerkImageUrl }
          : {}),
      },
    });

    try {
      this.presenceGateway.setUserOnline(user.id);
    } catch (presenceError) {
      console.warn('Presence update failed during sync (non-fatal):', presenceError);
    }

    try {
      await this.eventEmitter.emit('user.logged_in', { userId: user.id });
    } catch (eventError) {
      console.warn('user.logged_in event failed during sync (non-fatal):', eventError);
    }

    return this.formatSyncUser(user);
  }

  async updateOnboarding(
    userId: number,
    dto: UpdateOnboardingDto,
  ): Promise<any> {
    const questionMap = {
      '5': 'Q5',
      '25': 'Q25',
      '50': 'Q50',
      '100': 'Q100',
      '200': 'Q200',
      '400': 'Q400',
      '1000': 'Q1000',
    } as const;

    const timeMap = {
      '5': 'T5',
      '15': 'T15',
      '30': 'T30',
      '45': 'T45',
      '60': 'T60',
      unlimited: 'UNLIMITED',
    } as const;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        languagePreference: dto.languagePreference,
        subjectPreference: dto.subjectPreference,
        testLevel: dto.testLevel,
        questionPreference: questionMap[dto.questionPreference],
        timePreference: timeMap[dto.timePreference],
      },
      select: {
        id: true,
        email: true,
        languagePreference: true,
        subjectPreference: true,
        testLevel: true,
        questionPreference: true,
        timePreference: true,
      },
    });

    return {
      message: 'Onboarding preferences updated successfully',
      data: updatedUser,
    };
  }

  async findUsersWithPreferences(filters: {
  languagePreference: string;
  subjectPreference: string;
  testLevel: TestLevel;
}): Promise<User[]> {
  return prisma.user.findMany({
    where: {
      languagePreference: filters.languagePreference,
      subjectPreference: filters.subjectPreference,
      testLevel: filters.testLevel,
    },
  });
}

  async fetchOnboardingdetails(userId: number): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        languagePreference: true,
        subjectPreference: true,
        testLevel: true,
        questionPreference: true,
        timePreference: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      message: 'Onboarding details fetched successfully',
      data: user,
    };
  }

  async resendVerificationEmail(
    currentEmail: string,
    newEmail?: string,
  ): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { email: currentEmail },
    });

    if (user.active) {
      throw new ForbiddenException('User already verified');
    }

    // If user wants to change email
    let emailToUse = currentEmail;

    if (newEmail && newEmail !== currentEmail) {
      // Optional: check if new email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: newEmail },
      });

      if (existingUser) {
        throw new ForbiddenException('Email already in use');
      }

      // Update email
      await prisma.user.update({
        where: { id: user.id },
        data: { email: newEmail },
      });

      emailToUse = newEmail;
    }

    // Generate new verification code
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();

    const verificationExpiry = new Date(Date.now() + 15 * 60 * 1000);

    // Update verification details
    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationCode,
        verificationCodeExpiry: verificationExpiry,
      },
    });

    // Send email to updated email
    await this.mail.verifyEmail(emailToUse, verificationCode, user.firstName);

    return {
      message: 'Verification email sent successfully',
      email: emailToUse,
      id: user.id,
    };
  }

  private async authenticateExistingUser(
    user: User,
    password: string,
  ): Promise<{ verified: boolean; clerkUserId: string | null; user: User }> {
    const clerkUser = await this.clerkService.findByEmail(user.email);

    if (clerkUser?.id) {
      const verified = await this.clerkService.verifyPassword(
        clerkUser.id,
        password,
      );
      return { verified, clerkUserId: clerkUser.id, user };
    }

    const passwordMatches = await argon.verify(user.password, password);
    if (!passwordMatches) {
      return { verified: false, clerkUserId: null, user };
    }

    const migrated = await this.clerkService.migrateLocalUser(user, password);
    return { verified: true, clerkUserId: migrated.id, user };
  }

  private async authenticateClerkOnlyUser(dto: LoginDto): Promise<{
    verified: boolean;
    clerkUserId: string | null;
    user: User | null;
  }> {
    const clerkUser = await this.clerkService.findByIdentifier(dto.identifier);
    if (!clerkUser?.id) {
      return { verified: false, clerkUserId: null, user: null };
    }

    const verified = await this.clerkService.verifyPassword(
      clerkUser.id,
      dto.password,
    );
    if (!verified) {
      return { verified: false, clerkUserId: clerkUser.id, user: null };
    }

    const email = clerkUser.emailAddresses?.[0]?.emailAddress;
    if (!email) {
      return { verified: true, clerkUserId: clerkUser.id, user: null };
    }

    let user = await this.findUserByClerkId(clerkUser.id);
    if (!user) {
      const phone =
        (clerkUser.unsafeMetadata?.phone as string) ||
        clerkUser.phoneNumbers?.[0]?.phoneNumber ||
        '';
      const referralCode = clerkUser.unsafeMetadata?.referralCode as
        | string
        | undefined;
      const loginMethod =
        clerkUser.externalAccounts?.[0]?.provider || 'clerk';

      user = await this.registerClerkUser({
        clerkUserId: clerkUser.id,
        email,
        firstName: clerkUser.firstName || 'User',
        lastName: clerkUser.lastName || '',
        username:
          clerkUser.username ||
          clerkUser.firstName?.toLowerCase() ||
          `user_${clerkUser.id.slice(-6)}`,
        phone,
        login_method: loginMethod,
        referralCode,
      });
    }

    return { verified: true, clerkUserId: clerkUser.id, user };
  }

  async signinUser(dto: LoginDto): Promise<any> {
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.identifier },
          { phone: dto.identifier },
          { username: dto.identifier },
        ],
      },
    });

    if (user?.isBanned) {
      throw new ForbiddenException(
        'Your account has been banned. Contact support.',
      );
    }

    const authResult = user
      ? await this.authenticateExistingUser(user, dto.password)
      : await this.authenticateClerkOnlyUser(dto);

    user = authResult.user ?? user;

    if (!user) {
      throw new ForbiddenException('Identifier is invalid.');
    }

    if (!authResult.verified) {
      throw new ForbiddenException('Incorrect password');
    }

    const clerkUserId =
      authResult.clerkUserId ??
      user.clerkUserId ??
      (await this.clerkService.findByEmail(user.email))?.id ??
      null;

    if (!clerkUserId) {
      throw new ForbiddenException(
        'This account is not linked to Clerk. Try signing in with Google or contact support.',
      );
    }

    if (user.clerkUserId !== clerkUserId) {
      try {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { clerkUserId },
        });
      } catch (linkError) {
        console.warn('Failed to link clerkUserId during signin:', linkError);
      }
    }

    const clerkSignInToken =
      await this.clerkService.createSignInTicket(clerkUserId);

    const role = await prisma.role.findFirst({
      where: { name: user.roleName },
    });

    if (!role) {
      throw new ForbiddenException('Role not found');
    }

    let permissions: string[] = [];

    if (user.roleName === 'subadmin') {
      const subAdmin = await prisma.subAdmin.findUnique({
        where: { userId: user.id },
        include: {
          subAdminPermissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      permissions =
        subAdmin?.subAdminPermissions.map((p) => p.permission.name) || [];
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        login_timestamp: new Date(),
        isOnline: true,
        ip_address: dto.ip_address,
        location: dto.location,
      },
    });

    this.eventEmitter.emit('user.logged_in', { userId: user.id });
    this.presenceGateway.setUserOnline(user.id);

    return {
      message: 'Signin successful',
      clerkSignInToken,
      role: user.roleName,
      userId: user.id,
      permissions: user.roleName === 'subadmin' ? permissions : undefined,
      lastLoginTimeStamp: user.login_timestamp,
      subscriptionPlan: user.subscriptionPlan,
    };
  }

  async loginOrSignup(dto: SocialLoginDto) {
    try {
      // 1️⃣ Check if user exists
      let user = await prisma.user.findUnique({
        where: { email: dto.email },
      });

      // 2️⃣ If user exists, throw error
      // 3️⃣ If user does not exist, create
      if (!user) {
        const referralCode = generateReferralCode(dto.firstName);

        user = await prisma.user.create({
          data: {
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            username: dto.username,
            password: '',
            login_method: dto.login_method,
            phone: dto.phone,
            roleName: 'client',
            subscriptionPlan: 'FREE',
            referral_code: referralCode,
            referredByCode: dto.referralCode || null,
            active: true,
          },
        });

        // Create wallet
        await prisma.wallet.create({ data: { userId: user.id } });

        // Optional: handle referral bonus
        if (dto.referralCode) {
          const referrer = await prisma.user.findUnique({
            where: { referral_code: dto.referralCode },
          });
          if (referrer) {
            await prisma.referral.create({
              data: { referrerId: referrer.id, refereeId: user.id },
            });

        await this.walletService.creditWallet(
          referrer.id,
          25,
          'Referral signup reward',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
        );

                await this.walletService.creditWallet(
          user.id,
          10,
          'Referral welcome bonus',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
        );
      
          }
        }
      }

      // 4️⃣ Update last login timestamp
      await prisma.user.update({
        where: { id: user.id },
        data: {
          login_timestamp: new Date(),
          isOnline: true,
          ip_address: dto.ip_address,
          location: dto.location,
        },
      });

      // 5️⃣ Return user info (Clerk session handles auth)
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        role: user.roleName,
        subscriptionPlan: user.subscriptionPlan,
        lastLoginTimeStamp: user.login_timestamp,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error; // preserve known errors
      }

      // fallback
      throw new InternalServerErrorException(error || 'Something went wrong');
    }
  }

  async getUserLoginMethod(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        login_method: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      userId: user.id,
      email: user.email,
      loginMethod: user.login_method,
    };
  }

  async findUserAccount(userId: number): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        accounts: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

    async findUserCards(userId: number): Promise<any> {
    const user = await prisma.userCard.findFirst({
      where: { userId: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async createCard(userId: number, payload: any): Promise<any> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    /**
     * payload example:
     * {
     *   type: "VISA",
     *   token: "flw-t1nf-xxxx",
     *   expiry: "09/32",
     *   issuer: "ACCESS BANK PLC",
     *   country: "NIGERIA NG",
     *   last_4digits: "4246",
     *   first_6digits: "418742"
     * }
     */

    const cardNumber = String(payload.cardNumber || '');

    if (cardNumber.length < 10) {
      throw new BadRequestException('Invalid card number');
    }

    const first_6digits = cardNumber.slice(0, 6);
    const last_4digits = cardNumber.slice(-4);
    const maskedPan = `${first_6digits}******${last_4digits}`;

    // const maskedPan = `${payload.first_6digits}******${payload.last_4digits}`;

    // check if card already exists
    const existingCard = await prisma.userCard.findFirst({
      where: {
        userId,
        cardNumber: payload.cardNumber,
      },
    });

    if (existingCard) {
      return {
        success: true,
        message: 'Card already exists',
        data: existingCard,
      };
    }

    // make first card default automatically
    const totalCards = await prisma.userCard.count({
      where: { userId },
    });

    const card = await prisma.userCard.create({
      data: {
        userId,
        cardToken: payload.token,
        cardNumber: payload.cardNumber,
        maskedPan,
        cardType: payload.type,
        expiry: payload.expiry,
        issuer: payload.issuer,
        country: payload.country,
        isDefault: totalCards === 0,
      },
    });

    return {
      success: true,
      message: 'Card saved successfully',
      data: card,
    };
} catch (error: any) {
  console.error('createCard error:', error); // 👈 log real issue

  throw new BadRequestException(
    error?.message ||
    error?.meta?.message ||
    error?.response?.data?.message ||
    'Unable to save card',
  );
}
}


async getCard(userId: number): Promise<any> {
    const user = await prisma.userCard.findMany({
      where: { userId },
    });
    return user;
  }

  async getCardById(id: number): Promise<any> {
    const user_card = await prisma.userCard.findUnique({
      where: { id }
    })

    return user_card;
  }

  async setDefaultCard(userId: number, cardId: number) {
    const card = await prisma.userCard.findFirst({
      where: {
        id: cardId,
        userId,
      },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    return prisma.$transaction(async (tx) => {
      // 1. Remove existing default cards
      await tx.userCard.updateMany({
        where: {
          userId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });

      // 2. Set new default card
      const updatedCard = await tx.userCard.update({
        where: {
          id: cardId,
        },
        data: {
          isDefault: true,
        },
      });

      return {
        success: true,
        message: 'Default card updated successfully',
        data: updatedCard,
      };
    });
  }

    async deleteCard(userId: number, cardId: number) {
    const card = await prisma.userCard.findFirst({
      where: {
        id: cardId,
        userId,
      },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    return prisma.$transaction(async (tx) => {
      // delete card
      await tx.userCard.delete({
        where: {
          id: cardId,
        },
      });

      // optional: if deleted card was default, assign another card as default
      if (card.isDefault) {
        const anotherCard = await tx.userCard.findFirst({
          where: { userId },
          orderBy: { id: 'desc' },
        });

        if (anotherCard) {
          await tx.userCard.update({
            where: { id: anotherCard.id },
            data: { isDefault: true },
          });
        }
      }

      return {
        success: true,
        message: 'Card deleted successfully',
      };
    });
  }

  async getPaymentMethods(userId: number): Promise<any> {
  const [findAccounts, userCard] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        accounts: true,
      },
    }),

    prisma.userCard.findFirst({
      where: { userId },
    }),
  ]);

  if (!findAccounts && !userCard) {
    throw new NotFoundException('User not found');
  }

  return {
    accounts: findAccounts?.accounts || [],
    card: userCard || null,
  };
}

  async findUserById(userId: number): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
        referral_code: true,
        phone: true,
        roleName: true,
        login_timestamp: true,
        profilePicture: true,
        active: true,
        isOnline: true,
        languagePreference: true,
        subjectPreference: true,
        questionPreference: true,
        timePreference: true,
        subscriptionPlan: true,
        testLevel: true,
        ip_address: true,
        location: true,
        state: true,
        country: true,
        address: true,
        nin: true,
        bvn: true,
        dob: true,
        postal_code: true,
        accounts: true,
        isBanned: true,
        banReason: true,
        unBanReason: true,
        verify_photo: true,
        busha_customer_id: true
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }


  /** New: full-text / prefix search via Elasticsearch */
  async searchUsersByUsername(query: string, limit = 10) {
    const results = await this.es.searchUsers(query, limit);

    // Optional: fall back to Prisma ILIKE if ES returns nothing
    if (!results.length) {
      return prisma.user.findMany({
        where: { username: { contains: query, mode: 'insensitive' } },
        select: { id: true, username: true },
        take: limit,
      });
    }

    return results;
  }

  /** Call this after every user create/update to keep ES in sync */
  async indexUser(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, createdAt: true },
    });
    if (user) await this.es.indexUser({id: user.id, username: user.username, email: user.email, createdAt: user.createdAt });
  }

  async findUserByUsername(username: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getUserStreak(userId: number): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { dailyStreak: true, lastStreakDate: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user
  }

  async getUserBadge(userId: number) {
  // Get total points earned by user
  const totalPoints = await prisma.point.aggregate({
    where: {
      userId,
    },
    _sum: {
      points: true,
    },
  });

  const points = totalPoints._sum.points || 0;

  // Badge tiers
  const badges = [
    { name: 'Legend', required: 500000 },
    { name: 'Platinum', required: 250000 },
    { name: 'Gold', required: 100000 },
    { name: 'Silver', required: 50000 },
    { name: 'Bronze', required: 10000 },
  ];

  // Default badge
  let currentBadge = 'No Badge';

  // Find highest badge user qualifies for
  for (const badge of badges) {
    if (points >= badge.required) {
      currentBadge = badge.name;
      break;
    }
  }

  return {
    totalPoints: points,
    badge: currentBadge,
    nextBadge:
      currentBadge === 'Legend'
        ? null
        : badges
            .slice()
            .reverse()
            .find((b) => b.required > points) || null,
  };
}

  async updateKycDetails(userId: number, dto: KycDto) {
    try {
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          accountReference: true,
          flw_customer_id: true,
          busha_customer_id: true,
        },
      });


      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          dob: new Date(dto.dob),
          firstName: dto.firstName,
          lastName: dto.lastName,
          country: dto.country,
          address: dto.address,
          bvn: dto.bvn,
          nin: dto.nin,
          state: dto.state,
          verify_photo: dto.verify_photo,
          postal_code: dto.postal_code,
        },
      });


      const fullName = `${dto.firstName} ${dto.lastName}`;
      const generatedAccountReference = `wal-${userId}`;

      let reservedAccount;

      console.log('[KYC] Monnify step', {
        hasReference: !!existingUser.accountReference,
      });

      if (existingUser.accountReference) {
        reservedAccount = await this.monnifyService.getReservedAccount(
          existingUser.accountReference,
        );
      } else {
        try {
          reservedAccount = await this.monnifyService.createReservedAccount({
            accountReference: generatedAccountReference,
            accountName: fullName,
            currencyCode: 'NGN',
            customerEmail: existingUser.email,
            customerName: fullName,
            bvn: dto.bvn,
            getAllAvailableBanks: true,
          });
        } catch (error: any) {
          console.error('[KYC][Monnify ERROR]', {
            message: error.message,
            response: error.response?.data,
          });

          const responseMessage = error.response?.data?.responseMessage;

          if (
            typeof responseMessage === 'string' &&
            responseMessage.includes('same reference')
          ) {
            reservedAccount = await this.monnifyService.getReservedAccount(
              generatedAccountReference,
            );
          } else {
            throw error;
          }
        }
      }


      const responseBody = reservedAccount?.responseBody;

      if (!responseBody?.accounts) {
        console.error('[KYC] No accounts returned from Monnify', responseBody);
        throw new Error('Invalid Monnify response: no accounts');
      }

      const accountsWithType = responseBody.accounts.map((account, index) => ({
        ...account,
        accountType: index === 0 ? 'Gold' : 'Personal',
      }));

      let flutterwaveCustomerId = existingUser.flw_customer_id;

      if (!flutterwaveCustomerId) {
        try {
          const createFlwCustomer =
            await this.flutterwaveService.createCustomer({
              email: existingUser.email,
              firstName: dto.firstName,
              lastName: dto.lastName,
              phoneNumber: existingUser.phone,
              city: dto.city,
              country: dto.country,
              line1: dto.address,
              postal_code: dto.postal_code,
              state: dto.state,
              country_code: dto.country_code,
              number: dto.number,
            });

          flutterwaveCustomerId =
            createFlwCustomer.data?.id?.toString() ?? null;
        } catch (error: any) {
          console.error('[KYC][Flutterwave ERROR]', {
            message: error.message,
            response: error.response?.data,
          });
          throw error;
        }
      }

      

      // Create Flutterwave virtual account if customer exists
      let flutterwaveAccount = null;
      if (flutterwaveCustomerId) {
        try {
          const virtualAccountDto = {
            account_name: `${dto.firstName} ${dto.lastName}`,
            email: existingUser.email,
            country: dto.country,
            mobilenumber: dto.number,
            bank_code: '035'
          };

          const virtualAccountResponse = await this.flutterwaveService.createPayoutSubaccount(virtualAccountDto);
          flutterwaveAccount = virtualAccountResponse.data;

        } catch (error: any) {
          console.error('[KYC][Flutterwave Virtual Account ERROR]', {
            message: error.message,
            response: error.response?.data,
          });
          // Don't throw error, continue with Monnify accounts
        }
      }

            // Add Flutterwave account if created
      if (flutterwaveAccount?.nuban) {
        accountsWithType.push({
          accountNumber: flutterwaveAccount.nuban,
          bankName: flutterwaveAccount.bank_name,
          bankCode: flutterwaveAccount.bank_code,
          accountType: 'Flutterwave',
          accountReference: flutterwaveAccount.account_reference,
          barterId: flutterwaveAccount.barter_id
        });
      }



      // let bushaCustomerId = (existingUser as any).busha_customer_id;

      // console.log('[KYC] Busha check', { bushaCustomerId });

      // if (bushaCustomerId) {
      //   try {
      //     const existingBushaCustomer =
      //       await this.bushaService.getCustomerById(bushaCustomerId);

      //     if (!existingBushaCustomer?.data?.data?.id) {
      //       throw new Error('Invalid Busha customer');
      //     }

      //     console.log('[KYC] Busha customer exists');
      //   } catch (error: any) {
      //     console.error('[KYC][Busha getCustomer ERROR]', {
      //       message: error.message,
      //       response: error.response?.data,
      //     });

      //     bushaCustomerId = null;
      //   }
      // }

      // if (!bushaCustomerId) {
      //   try {
      //     console.log('[KYC] Fetching Busha customers');

      //     const customersResponse = await this.bushaService.getCustomers();
      //     const customers = customersResponse.data || [];

      //     const existingCustomer = customers.find(
      //       (c) => c.email === existingUser.email,
      //     );

      //     if (existingCustomer) {
      //       bushaCustomerId = existingCustomer.id;
      //       console.log('[KYC] Found existing Busha customer');
      //     }
      //   } catch (error: any) {
      //     console.error('[KYC][Busha getCustomers ERROR]', {
      //       message: error.message,
      //       response: error.response?.data,
      //     });
      //   }

      //   if (!bushaCustomerId) {
      //     if (!existingUser.phone) {
      //       console.error('[KYC] Missing phone number');
      //       throw new Error('Phone is required for Busha');
      //     }

      //     const sanitizedPhone = existingUser.phone.replace(/^\+/, '');
      //     const formattedDob = await this.formatBirthDate(dto.dob);

      //     console.log('[KYC] Creating Busha customer');

      //     try {
      //       const [idFrontBase64, idBackBase64, selfieBase64] =
      //         await Promise.all([
      //           toDataURL(dto.idFrontBase64),
      //           toDataURL(dto.idBackBase64),
      //           toDataURL(dto.selfieBase64),
      //         ]);
      //       const bushaPayload: CreateBushaCustomerDto = {
      //         email: existingUser.email,
      //         has_accepted_terms: true,
      //         type: 'individual',
      //         country_id: dto.country,
      //         phone: sanitizedPhone,
      //         birth_date: formattedDob,
      //         first_name: dto.firstName,
      //         last_name: dto.lastName,
      //         address: {
      //           country_id: dto.country,
      //           address_line_1: dto.address,
      //           city: dto.city,
      //           state: dto.state,
      //           postal_code: dto.postal_code,
      //         },
      //         identifying_information: [
      //           {
      //             type: dto.id_type,
      //             number: dto.idNumber,
      //             country: dto.country,
      //             image_front: idFrontBase64,
      //             image_back: idBackBase64,
      //           },
      //           {
      //             type: 'selfie',
      //             number: dto.idNumber,
      //             country: dto.country,
      //             image_front: selfieBase64,
      //           },
      //         ],
      //       };

      //       const bushaCustomer =
      //         await this.bushaService.createCustomer(bushaPayload);

      //       bushaCustomerId = bushaCustomer?.data?.id;

      //       console.log(bushaPayload, 'bushaPayload');

      //       console.log('[KYC] Busha customer created', bushaCustomerId);
      //     } catch (error: any) {
      //       console.error('[KYC][Busha createCustomer ERROR]', {
      //         message: error.message,
      //         response: error.response?.data,
      //       });
      //       throw error;
      //     }
      //   }
      // }

      // console.log('[KYC] Final DB update');

      let bushaCustomerId = 'CUS_I6WZxboDgD5C8'


      // [bitnob services]

      let createBitnobCustomerResponse = await this.bitnobService.createCustomer({
        email: existingUser.email,
        first_name: dto.firstName,
        last_name: dto.lastName,
        phone: existingUser.phone,
        country_code: dto.country,
      })

      // [generate bitnob address]

const chain = process.env.NODE_ENV === 'production' ? 'polygon' : 'ethereum';

let create_bitnob_address = await this.bitnobService.generateAddress({
  chain,
  customer_email: existingUser.email,
  label: 'bitnobSuperfanWallet',
  reference: `wal-ref-${Date.now()}`
})

let validate_bitnob_adddress = await this.bitnobService.validateAddress({
  address: create_bitnob_address.data.address,
  chain
})

                const bitnobAddress = {
            bitnob_address: {
              id: create_bitnob_address.data.id,
              chain: create_bitnob_address.data.chain,
              address: create_bitnob_address.data.address,
              label: create_bitnob_address.data.label,
              reference: create_bitnob_address.data.reference,
              status: create_bitnob_address.data.status,
            },
          };

          const updatedAccountsWithType = {
            ...accountsWithType,
            ...bitnobAddress,
          };

          console.log(updatedAccountsWithType, 'updatedAccounts')
      await prisma.user.update({
        where: { id: userId },
        data: {
          accountReference: responseBody.accountReference,
          accounts: updatedAccountsWithType,
          flw_customer_id: flutterwaveCustomerId,
          busha_customer_id: bushaCustomerId,
          bitnob_customer_id: createBitnobCustomerResponse?.data?.id,
        },
      });
      console.log('flutterwave account reference', flutterwaveAccount.account_reference)

            // issue static account for user
      let issueStaticAccount = await this.flutterwaveService.fetchStaticVirtualAccount(flutterwaveAccount.account_reference)
      console.log('issueStaticAccount', issueStaticAccount)

      console.log('[KYC] Verifying Busha customer');

      // try {
      //   console.log(bushaCustomerId, 'bushaCustomerId in verify');
      //   await this.bushaService.verifyCustomer(bushaCustomerId);
      //   console.log('[KYC] Busha verification success');
      // } catch (error: any) {
      //   console.error('[KYC][Busha verify ERROR]', {
      //     message: error.message,
      //     response: error.response?.data,
      //   });
      //   throw error;
      // }

      // console.log('[KYC] SUCCESS');

      return {
        message: existingUser.accountReference
          ? 'KYC updated & existing reserved account retrieved successfully'
          : 'KYC updated & reserved account created successfully',
        data: {
          ...user,
          accountReference: responseBody.accountReference,
          accounts: accountsWithType,
          flw_customer_id: flutterwaveCustomerId,
        },
      };
    // } catch (error: any) {
    //   console.error('[KYC] FINAL ERROR', {
    //     message: error.message,
    //     stack: error.stack,
    //     response: error.response?.data,
    //   });

    //   throw error;
    // }

    } catch (error: any) {
  // ADD THIS:
  console.error('fetchStaticVirtualAccount error:', {
    message: error.message,
    response: error.response?.data,
    status: error.response?.status,
  });

  throw new HttpException(
    error.response?.data || error.message || 'Failed to fetch static virtual account',
    error.response?.status || 500,
  );
    }
  }

  async checkKycStatus(
    userId: number,
  ): Promise<{ isComplete: boolean; reason?: object }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        dob: true,
        firstName: true,
        lastName: true,
        country: true,
        address: true,
        bvn: true,
        state: true,
        verify_photo: true,
        postal_code: true,
        busha_customer_id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 1. Check local KYC fields
    const requiredFields = [
      user.dob,
      user.firstName,
      user.lastName,
      user.country,
      user.address,
      user.bvn,
      user.state,
      user.verify_photo,
      user.postal_code,
    ];

    // 2. Call Busha
    const customer = await this.bushaService.getCustomerById(
      user.busha_customer_id,
    );

    const status = customer?.data?.status;
    const kycStatus = customer?.data?.kyc_status;

    // 3. Final decision
    const isApproved = status === 'active' && kycStatus === 'verified';

    return {
      isComplete: isApproved,
      reason: isApproved ? undefined : { bushaStatus: status, kycStatus },
    };
  }

  // async onKycApproved(userId: number) {
  //   const rewards = await prisma.reward.findMany({
  //     where: { userId, status: 'PENDING' },
  //   });

  //   for (const reward of rewards) {
  //     await this.walletService.creditWallet(userId, reward.amount, reward.type);

  //     await prisma.reward.update({
  //       where: { id: reward.id },
  //       data: { status: 'PAID_OUT' },
  //     });
  //   }
  // }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
      where: { email: email },
    });

    if (!user) {
      // To prevent email enumeration, return a generic message
      return {
        message:
          'If that email is registered, you will receive a password reset link.',
      };
    }
    // Generate a password reset token (for simplicity, using a random 6-digit code here)
    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.user.update({
      where: { email },
      data: {
        resetToken: resetToken,
        resetTokenExpiry: resetTokenExpiry,
      },
    });
    let splitToken = resetToken.split('');
    // Send password reset email
    await this.mail.sendForgotPassword(email, splitToken, user.username);

    return {
      message:
        'If that email is registered, you will receive a password reset link.',
    };
  }

  // reset-password
  async resetPassword(
    email: string,
    resetToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.resetToken || !user.resetTokenExpiry) {
      throw new ForbiddenException('Invalid or expired reset token');
    }

    if (user.resetToken !== resetToken) {
      throw new ForbiddenException('Invalid or expired reset token');
    }
    if (new Date() > user.resetTokenExpiry) {
      throw new ForbiddenException('Invalid or expired reset token');
    }

    const hashedPassword = await argon.hash(newPassword);

    await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return { message: 'Password has been reset successfully' };
  }

  async updateUserSubAccountCode(userId: number, dto: UpdateUserDto) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!dto.accountNumber || !dto.bankCode) {
      throw new BadRequestException('accountNumber and bankCode are required');
    }

    try {
      // ✅ Create subaccount
      const subAccountCode = await this.monnifyService.createSubAccount({
        customerCurrency: dto.customerCurrency,
        customerAccountNumber: dto.accountNumber,
        customerAccountBankCode: dto.bankCode,
        customerEmailAddress: user.email,
        defaultSplitPercentage: dto.defaultSplitPercentage,
        // customerAccountName: `${user.firstName} ${user.lastName}`,
      });

      if (!subAccountCode) {
        throw new BadRequestException('Failed to create sub account');
      }

      // ✅ Update user with subaccount details
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          subAccountCode,
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,
        },
        select: {
          id: true,
          email: true,
          subAccountCode: true,
          accountNumber: true,
          bankCode: true,
        },
      });

      return {
        message: 'Sub account created and linked successfully',
        data: updatedUser,
      };
    } catch (error) {
      console.error('Subaccount creation failed:', error);

      throw new BadRequestException(error || 'Failed to create sub account');
    }
  }

  async updateUserDetails(userId: number, dto: UpdateUserDto) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let hashedPassword: string | undefined;

    if (dto.new_password) {
      if (!dto.current_password) {
        throw new ForbiddenException('Current password is required');
      }

      const passwordMatches = await argon.verify(
        user.password,
        dto.current_password,
      );

      if (!passwordMatches) {
        throw new ForbiddenException('Current password is incorrect');
      }

      hashedPassword = await argon.hash(dto.new_password);
    }

    const patch: Record<string, unknown> = {};

    const assign = <K extends keyof UpdateUserDto>(key: K) => {
      if (dto[key] !== undefined) {
        patch[key as string] = dto[key];
      }
    };

    assign('firstName');
    assign('lastName');
    assign('email');
    assign('phone');
    assign('state');
    assign('address');
    assign('username');
    assign('testLevel');
    assign('ip_address');
    assign('location');
    assign('dob');
    assign('languagePreference');
    assign('subjectPreference');
    assign('bvn');
    assign('nin');
    assign('roleName');
    assign('country');
    assign('subscriptionPlan');
    assign('profilePicture');

    if (dto.address !== undefined) {
      patch.lastSeen = dto.address;
    }

    if (hashedPassword) {
      patch.password = hashedPassword;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: patch,
    });

    return {
      message: 'User details updated successfully',
      data: updatedUser,
    };
  }

  async createSubscription(userId: number, dto: PaymentDto): Promise<any> {
    // 1️⃣ Ensure user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2️⃣ Check if user already has a subscription
    const existingSubscription = await prisma.subscription.findFirst({
      where: { userId: user.id },
    });

    if (existingSubscription) {
      throw new BadRequestException(
        'User already has an existing subscription',
      );
    }

    // 3️⃣ 🚫 Block superadmin & subadmin
    if (['superadmin', 'subadmin'].includes(user.roleName)) {
      throw new ForbiddenException(
        'Admins are not allowed to create subscriptions',
      );
    }

    // 4️⃣ Call Monnify mandate
    const mandate = await this.monnifyService.createMandate(dto);

    if (!mandate || !mandate.responseBody) {
      throw new InternalServerErrorException('Failed to create mandate');
    }

    const mandateData = mandate.responseBody;

    // 5️⃣ Save subscription in DB
    const subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        mandateReference: mandateData.mandateReference,
        mandateCode: mandateData.mandateCode,
        subscriptionPlan: dto.subscriptionPlan,
        status: mandateData.mandateStatus,
        amount: dto.mandateAmount,
        debitAmount: dto.debitAmount,
        paymentReference: '',
        paymentStatus: '',
        startDate: new Date(dto.mandateStartDate),
        endDate: new Date(dto.mandateEndDate),
      },
    });

    return {
      message: 'Subscription created successfully',
      data: subscription,
      mandate: mandateData,
    };
  }

  async createSubscriptionWithCard(
    userId: number,
    dto: SubscriptionCardPaymentDto,
  ): Promise<any> {
    const trx = await this.monnifyService.queryTransaction(
      dto.transactionReference,
    );
    console.log(trx, 'log trx record');

    if (trx.responseBody.paymentStatus !== 'PAID') {
      throw new BadRequestException('Payment not successful');
    }

    const card = trx.responseBody.cardDetails;

    const now = new Date();

    // ✅ create subscription
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        subscriptionPlan: dto.subscriptionPlan,
        status: 'ACTIVE',
        amount: Number(trx.responseBody.amountPaid),
        debitAmount: dto.debitAmount,
        paymentMethod: 'CARD',
        cardToken: card?.cardToken,
        paymentReference: trx.responseBody.paymentReference,
        paymentStatus: trx.responseBody.paymentStatus,
        startDate: now,
        endDate: new Date(new Date().setMonth(now.getMonth() + 1)),
      },
    });

    // ✅ create subscription debit record
    await prisma.subscriptionDebit.create({
      data: {
        subscriptionId: subscription.id,
        amount: Number(trx.responseBody.amountPaid),
        debitDate: subscription.startDate,
        paymentReference: trx.responseBody.paymentReference,
        transactionRef: trx.responseBody.transactionReference,
        status: 'PAID',
        narration: `Subscription payment for ${dto.subscriptionPlan}`,
      },
    });

    // update model User table

    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionPlan: dto.subscriptionPlan },
    });

    return subscription;
  }

async checkSubscriptionStatus(userId: number, mandateCode?: string): Promise<{
  status: string | null;
  subscriptionPlan: string | null;
}> {
  const subscription = await prisma.subscription.findFirst({
    where: { 
      userId,
      ...(mandateCode && { mandateCode })
    },
    select: {
      status: true,
      subscriptionPlan: true,
    },
  });
  return {
    status: subscription?.status ?? null,
    subscriptionPlan: subscription?.subscriptionPlan ?? null,
  };
}

async checkSubscriptionStatusbyUserId(userId: number): Promise<{
  subscriptionPlan: string | null;
}> {
  const subscription = await prisma.user.findFirst({
    where: { 
      id: userId,
    },
    select: {
      subscriptionPlan: true,
    },
  });
  return {
    subscriptionPlan: subscription?.subscriptionPlan ?? null,
  };
}

  async fetchClients(params: { page: number; perPage: number }): Promise<any> {
    try {
      const { page = 1, perPage = 10 } = params;

      const skip = (page - 1) * perPage;

      const [clients, total] = await prisma.$transaction([
        prisma.user.findMany({
          where: { roleName: 'client' },
          skip,
          take: perPage,
        }),
        prisma.user.count({
          where: { roleName: 'client' },
        }),
      ]);

      return {
        data: clients,
        meta: {
          page,
          perPage,
          total,
          lastPage: Math.ceil(total / perPage),
        },
      };
    } catch (error) {
      throw error;
    }
  }

  async fetchSubadmin(params: { page: number; perPage: number }): Promise<any> {
    try {
      const { page = 1, perPage = 10 } = params;

      const skip = (page - 1) * perPage;

      const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
          where: {
            roleName: { in: ['superadmin', 'subadmin'] },
          },
          skip,
          take: perPage,
        }),
        prisma.user.count({
          where: {
            roleName: { in: ['superadmin', 'subadmin'] },
          },
        }),
      ]);

      // 👉 Get subadmin users
      const subadminUsers = users.filter((u) => u.roleName === 'subadmin');

      const subadminIds = subadminUsers.map((u) => u.id);

      // 👉 Fetch SubAdmin records
      const subAdmins = await prisma.subAdmin.findMany({
        where: {
          userId: { in: subadminIds },
        },
      });

      // 👉 Map: userId → subAdminId
      const subAdminMap = subAdmins.reduce(
        (acc, s) => {
          acc[s.userId] = s.id;
          return acc;
        },
        {} as Record<number, number>,
      );

      // 👉 Extract real subAdmin IDs
      const actualSubAdminIds = Object.values(subAdminMap);

      // 👉 Fetch permissions
      const permissions = await prisma.subAdminPermission.findMany({
        where: {
          subAdminId: { in: actualSubAdminIds },
        },
        include: {
          permission: true,
        },
      });

      // 👉 Group by subAdminId
      const permissionMap = permissions.reduce(
        (acc, item) => {
          if (!acc[item.subAdminId]) {
            acc[item.subAdminId] = [];
          }
          acc[item.subAdminId].push(item.permission);
          return acc;
        },
        {} as Record<number, any[]>,
      );

      // 👉 Attach permissions correctly
      const formatted = users.map((user) => {
        if (user.roleName !== 'subadmin') {
          return { ...user, permissions: [] };
        }

        const subAdminId = subAdminMap[user.id];

        return {
          ...user,
          permissions: subAdminId ? permissionMap[subAdminId] || [] : [],
        };
      });

      return {
        data: formatted,
        meta: {
          page,
          perPage,
          total,
          lastPage: Math.ceil(total / perPage),
        },
      };
    } catch (error) {
      throw error;
    }
  }

  async banClient(
    id: number,
    banReason: string,
    banCategory: string,
    creatorId: number,
  ) {
    try {
      // 1. Check if target user exists
      const existingUser = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      // 3. Update user (ban)
      const user = await prisma.user.update({
        where: { id },
        data: {
          isBanned: true,
          banReason,
          banCategory,
          isOnline: false,
          active: false,
        },
        select: {
          firstName: true,
          lastName: true,
          username: true,
        },
      });

      // 4. Create history (you can also include creator name if needed)
      await this.taskService.createClientHistory({
        userId: id,
        creatorId,
        type: 'REPORT',
        title: 'User Banned',
        description: `${banReason}`,
        submittedBy: 'ADMIN',
      });

      return {
        message: 'Client banned successfully',
        data: user,
        //   adminDetails: {
        //   creatorFirstName: creator.firstName,
        //   creatorLastName: creator.lastName,
        //   creatorUserName: creator.username
        // }
      };
    } catch (error) {
      throw error;
    }
  }

  // async unbanClient(id: number, unbanReason: string, banCategory: string, creatorId: number) {
  //   try {
  //     const user = await prisma.user.update({
  //       where: { id },
  //       data: {
  //         isBanned: false,
  //         banReason: null,
  //         unBanReason: unbanReason,
  //         banCategory,
  //         active: true,
  //       },
  //     });

  //     await this.taskService.createClientHistory({
  //       userId: id,
  //       creatorId,
  //       type: 'REPORT',
  //       title: "User Unbanned",
  //       description: unbanReason,
  //       submittedBy: 'ADMIN',
  //     });

  //     return {
  //       message: 'Client unbanned successfully',
  //       data: user,
  //     };
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  async unbanClient(
    id: number,
    unbanReason: string,
    banCategory: string,
    creatorId: number,
  ) {
    try {
      // 1. Check if target user exists
      const existingUser = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          isBanned: true,
        },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      // Optional: prevent unbanning a user that isn’t banned
      if (!existingUser.isBanned) {
        throw new BadRequestException('User is not banned');
      }

      // 3. Update user (unban)
      const user = await prisma.user.update({
        where: { id },
        data: {
          isBanned: false,
          banReason: null,
          unBanReason: unbanReason,
          banCategory,
          active: true,
        },
        select: {
          firstName: true,
          lastName: true,
          username: true,
        },
      });

      // 4. Create history
      await this.taskService.createClientHistory({
        userId: id,
        creatorId,
        type: 'REPORT',
        title: 'User Unbanned',
        description: `${unbanReason}`,
        submittedBy: 'ADMIN',
      });

      return {
        message: 'Client unbanned successfully',
        data: user,
      };
    } catch (error) {
      throw error;
    }
  }

  async getBanStatus(id: number) {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          isBanned: true,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return {
        message: 'User ban status fetched successfully',
        data: {
          id: user.id,
          email: user.email,
          isBanned: user.isBanned,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  async getReferralLink(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        referral_code: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const baseUrl = process.env.FRONTEND_URL || 'https://superfan.com';

    const referralLink = `${baseUrl}/signup?ref=${user.referral_code}`;

    return {
      referralCode: user.referral_code,
      referralLink,
    };
  }

  async findAllUsers() {
    try {
      const users = await prisma.user.findMany({});
      return { message: 'All users', data: users };
    } catch (error) {
      throw error;
    }
  }

  async deleteUser(id: number) {
    try {
      await prisma.user.delete({
        where: { id: id },
      });
      return { message: 'User deleted successfully' };
    } catch (error) {
      throw error;
    }
  }

  async markOffline(userId: number) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        isOnline: false,
        lastSeen: new Date(),
      },
    });
  }

  async logout(userId: number): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        isOnline: false,
        lastSeen: new Date(),
      },
    });

    // 🔥 notify gateway
    this.presenceGateway.setUserOffline(userId);

    return { message: 'Logout successful' };
  }

  async generateMagicLink(user: User) {
    const clerkUser = await this.clerkService.findByEmail(user.email);

    if (!clerkUser?.id) {
      throw new BadRequestException(
        'User is not linked to Clerk. Cannot generate magic link.',
      );
    }

    const clerkSignInToken = await this.clerkService.createSignInTicket(
      clerkUser.id,
    );

    const frontendUrl =
      process.env.FRONTEND_URL || 'https://app.superfan.ng';

    return {
      magicLinkURI: `${frontendUrl}/auth/magic?token=${clerkSignInToken}&userId=${user.id}&email=${encodeURIComponent(
        user.email,
      )}`,
      clerkSignInToken,
    };
  }

  async formatBirthDate(dateString: string) {
    const date = new Date(dateString);

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${year}-${month}-${day}`;
  }

async updateDailyStreak(userId: number): Promise<{ streak: number; milestoneReached: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyStreak: true, lastStreakDate: true },
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let newStreak = 1;

  if (user?.lastStreakDate) {
    const last = new Date(user.lastStreakDate);
    const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());

    const diffInDays = (today.getTime() - lastDay.getTime()) / (1000 * 60 * 60 * 24);

    if (diffInDays === 0) {
      // Same day — no change, no milestone check needed
      return { streak: user.dailyStreak, milestoneReached: false };
    } else if (diffInDays === 1) {
      newStreak = user.dailyStreak + 1;
    } else {
      newStreak = 1;
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { dailyStreak: newStreak, lastStreakDate: now },
  });

  return {
    streak: newStreak,
    milestoneReached: newStreak === 7, // 👈 true only the moment it hits 7
  };
}

async findUserByEmail(email: string): Promise<any> {
  return prisma.user.findUnique({
    where: { email },
  });
}

  async registerClerkUser(data: {
    clerkUserId: string;
    email: string;
    firstName: string;
    lastName: string;
    username: string;
    phone: string;
    login_method: string;
    referralCode?: string;
  }): Promise<any> {
    const referralCode = generateReferralCode(data.firstName);
    const user = await prisma.user.create({
      data: {
        clerkUserId: data.clerkUserId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
        password: '',
        login_method: data.login_method,
        phone: data.phone,
        roleName: 'client',
        subscriptionPlan: 'FREE',
        referral_code: referralCode,
        referredByCode: data.referralCode || null,
        active: true,
      },
    });

    // Create wallet
    await prisma.wallet.create({ data: { userId: user.id } });

    // Handle referral bonuses
    if (data.referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referral_code: data.referralCode },
      });

      if (referrer) {
        await prisma.referral.create({
          data: {
            referrerId: referrer.id,
            refereeId: user.id,
          },
        });

        await this.walletService.creditWallet(
          referrer.id,
          30,
          'Referral signup reward',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
        );

        const referrer_pts = 30000;
        await prisma.point.create({
          data: {
            userId: referrer.id,
            points: referrer_pts,
            reference: `POINTS_${generateFiveUniqueRandomNumbers()}`,
            type: 'referral_reward',
          },
        });

        await this.walletService.userCreateReward(
          referrer.id,
          25,
          'NGN',
          'Referral signup reward',
          EarningStatus.PAID_OUT,
        );

        await this.notificationService.createNotification(
          referrer.id,
          'Referral Reward',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
          'referral_reward'
        );

        await this.walletService.creditWallet(
          user.id,
          10,
          'Referral welcome bonus',
          `You earned ₦25 because ${user.username} signed up using your referral link.`,
        );

        const referreral_pts = 10000;
        await prisma.point.create({
          data: {
            userId: user.id,
            points: referreral_pts,
            reference: `POINTS_${generateFiveUniqueRandomNumbers()}`,
            type: 'referral_reward',
          },
        });

        await this.walletService.userCreateReward(
          user.id,
          10,
          'NGN',
          'Referral welcome bonus',
          EarningStatus.PAID_OUT,
        );

        await this.notificationService.createNotification(
          user.id,
          'Welcome Bonus',
          'You received ₦10 for signing up with a referral code.',
          'welcome_bonus'
        );
      }
    }

    return user;
  }
}

