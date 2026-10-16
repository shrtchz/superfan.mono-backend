import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwoFactorService } from './two-factor.service';
import { TalkingDrumService } from './talking-drum.service';
import { TwilioService } from './twilio.service';
import { prisma } from '../../prisma/prisma';

// Mock dependencies
jest.mock('../../prisma/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe('TwoFactorService - Twilio & TalkingDrum flows', () => {
  let service: TwoFactorService;
  let talkingDrumService: Partial<TalkingDrumService>;
  let twilioService: Partial<TwilioService>;
  let configService: Partial<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();

    talkingDrumService = {
      sendOtp: jest.fn().mockResolvedValue({
        simulated: true,
        provider: 'africas-talking-simulation',
        to: '+1234567890',
      }),
    };

    twilioService = {
      sendOtp: jest.fn().mockResolvedValue({
        simulated: true,
        provider: 'twilio-simulation',
        to: '+1234567890',
      }),
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'SMS_PROVIDER') return 'twilio';
        return defaultValue;
      }),
    };

    service = new TwoFactorService(
      talkingDrumService as TalkingDrumService,
      twilioService as TwilioService,
      configService as ConfigService,
    );
  });

  describe('1. Twilio SMS OTP Flow', () => {
    it('should send OTP via Twilio by default when SMS_PROVIDER is twilio', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 1 });

      const result = await service.sendPhoneOtp(1, '+1234567890', 'text');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          twoFactorPhone: '+1234567890',
          twoFactorOtp: expect.any(String),
          twoFactorOtpExpiry: expect.any(Date),
        }),
      });

      expect(twilioService.sendOtp).toHaveBeenCalledWith({
        phone: '+1234567890',
        code: expect.stringMatching(/^\d{6}$/),
        channel: 'text',
      });

      expect(talkingDrumService.sendOtp).not.toHaveBeenCalled();
      expect(result.provider).toBe('twilio');
      expect(result.phone).toBe('••••7890');
    });

    it('should send voice OTP via Twilio when channel is call', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 1 });

      const result = await service.sendPhoneOtp(1, '+1234567890', 'call', 'twilio');

      expect(twilioService.sendOtp).toHaveBeenCalledWith({
        phone: '+1234567890',
        code: expect.stringMatching(/^\d{6}$/),
        channel: 'call',
      });
      expect(result.message).toContain('via call');
    });
  });

  describe('2. TalkingDrum SMS OTP Flow (Backwards Compatibility)', () => {
    it('should send OTP via TalkingDrum when provider is talking_drum', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 2 });
      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 2 });

      const result = await service.sendPhoneOtp(2, '+2348012345678', 'text', 'talking_drum');

      expect(talkingDrumService.sendOtp).toHaveBeenCalledWith({
        phone: '+2348012345678',
        code: expect.stringMatching(/^\d{6}$/),
        channel: 'text',
      });

      expect(twilioService.sendOtp).not.toHaveBeenCalled();
      expect(result.provider).toBe('talking_drum');
    });
  });

  describe('3. Phone OTP Verification', () => {
    it('should enable phone 2FA when valid code is submitted', async () => {
      // Simulate stored SHA-256 hash for code "123456"
      const crypto = require('crypto');
      const validHash = crypto.createHash('sha256').update('superfan:2fa:123456').digest('hex');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        twoFactorPhone: '+1234567890',
        twoFactorOtp: validHash,
        twoFactorOtpExpiry: new Date(Date.now() + 600000),
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 1 });

      const res = await service.enablePhoneOtp(1, '+1234567890', '123456');

      expect(res.enabled).toBe(true);
      expect(res.method).toBe('phone');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          twoFactorEnabled: true,
          twoFactorMethod: 'phone',
          twoFactorPhone: '+1234567890',
          twoFactorOtp: null,
          twoFactorOtpExpiry: null,
        },
      });
    });

    it('should reject invalid verification code', async () => {
      const crypto = require('crypto');
      const validHash = crypto.createHash('sha256').update('superfan:2fa:123456').digest('hex');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        twoFactorPhone: '+1234567890',
        twoFactorOtp: validHash,
        twoFactorOtpExpiry: new Date(Date.now() + 600000),
      });

      await expect(service.enablePhoneOtp(1, '+1234567890', '999999')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject expired verification code', async () => {
      const crypto = require('crypto');
      const validHash = crypto.createHash('sha256').update('superfan:2fa:123456').digest('hex');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        twoFactorPhone: '+1234567890',
        twoFactorOtp: validHash,
        twoFactorOtpExpiry: new Date(Date.now() - 600000), // expired
      });

      await expect(service.enablePhoneOtp(1, '+1234567890', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
