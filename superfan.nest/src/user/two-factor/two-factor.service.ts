import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma } from '../../prisma/prisma';
import { TalkingDrumService } from './talking-drum.service';
import {
  buildOtpauthUri,
  generateTotpSecret,
  verifyTotpToken,
} from './totp.util';

const TOTP_ISSUER = 'Superfan';
const TOTP_DIGITS = 6;
const OTP_VALIDITY_MINUTES = 10;
const PHONE_PATTERN = /^[0-9]{6,15}$/;

export type TwoFactorMethod = 'authenticator' | 'phone';

function hashOtp(code: string): string {
  return crypto
    .createHash('sha256')
    .update(`superfan:2fa:${code}`)
    .digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateOtpCode(): string {
  return crypto.randomInt(0, 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  const digits = withPlus.replace(/^\+/, '');
  if (!PHONE_PATTERN.test(digits)) {
    throw new BadRequestException('Please provide a valid phone number.');
  }
  return `+${digits}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return phone;
  return `••••${digits.slice(-4)}`;
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(private readonly talkingDrumService: TalkingDrumService) {}

  async getStatus(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFactorEnabled: true,
        twoFactorMethod: true,
        twoFactorPhone: true,
        phone: true,
        email: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const enabled = Boolean(user.twoFactorEnabled);
    const method = (user.twoFactorMethod ?? null) as TwoFactorMethod | null;
    const activePhone = enabled ? user.twoFactorPhone : user.phone;

    return {
      enabled,
      method,
      phone: activePhone ? maskPhone(activePhone) : null,
      email: user.email ?? null,
    };
  }

  async setupTotp(userId: number, account?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const secret = generateTotpSecret();
    const accountName =
      account?.trim() ||
      user.email ||
      user.username ||
      `user-${userId}`;
    const otpauthUrl = buildOtpauthUri(secret, accountName, TOTP_ISSUER);

    return {
      secret,
      otpauthUrl,
      issuer: TOTP_ISSUER,
      account: accountName,
    };
  }

  async enableTotp(userId: number, code: string, pendingSecret?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const secret = (pendingSecret?.trim() || user.twoFactorSecret || '').trim();
    if (!secret) {
      throw new BadRequestException(
        'No pending authenticator setup found. Start 2FA setup again.',
      );
    }

    let valid = false;
    try {
      valid = verifyTotpToken(secret, code.trim());
    } catch (error) {
      this.logger.warn(
        `TOTP verification failed for user ${userId}: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`,
      );
      valid = false;
    }

    if (!valid) {
      throw new BadRequestException(
        'Invalid or expired verification code. Please try again.',
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: 'authenticator',
        twoFactorSecret: secret,
      },
    });

    return { enabled: true, method: 'authenticator' as const };
  }

  async sendPhoneOtp(userId: number, phone: string, channel: 'text' | 'call' = 'text') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const normalizedPhone = normalizePhone(phone);
    const code = generateOtpCode();

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorOtp: hashOtp(code),
        twoFactorOtpExpiry: new Date(
          Date.now() + OTP_VALIDITY_MINUTES * 60 * 1000,
        ),
        twoFactorPhone: normalizedPhone,
      },
    });

    await this.talkingDrumService.sendOtp({
      phone: normalizedPhone,
      code,
      channel,
    });

    return {
      message: `A ${TOTP_DIGITS}-digit code was sent to ${maskPhone(normalizedPhone)} via ${channel}.`,
      expiresInMinutes: OTP_VALIDITY_MINUTES,
      phone: maskPhone(normalizedPhone),
    };
  }

  async enablePhoneOtp(userId: number, phone: string, code: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFactorOtp: true,
        twoFactorOtpExpiry: true,
        twoFactorPhone: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const normalizedPhone = normalizePhone(phone);
    const storedPhone = user.twoFactorPhone;
    const storedHash = user.twoFactorOtp;
    const expiry = user.twoFactorOtpExpiry;

    if (!storedPhone || storedPhone !== normalizedPhone) {
      throw new BadRequestException(
        'No code was sent to this phone number. Send a new code first.',
      );
    }
    if (!storedHash || !expiry) {
      throw new BadRequestException(
        'No valid code request found. Send a new code first.',
      );
    }
    if (expiry.getTime() < Date.now()) {
      throw new BadRequestException(
        'This code has expired. Send a new code.',
      );
    }
    if (!safeEqual(hashOtp(code.trim()), storedHash)) {
      throw new BadRequestException(
        'Invalid or expired verification code. Please try again.',
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: 'phone',
        twoFactorPhone: storedPhone,
        twoFactorOtp: null,
        twoFactorOtpExpiry: null,
      },
    });

    return { enabled: true, method: 'phone' as const, phone: maskPhone(storedPhone) };
  }

  async disable(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorMethod: null,
        twoFactorSecret: null,
        twoFactorPhone: null,
        twoFactorOtp: null,
        twoFactorOtpExpiry: null,
      },
    });

    return { enabled: false, method: null };
  }
}