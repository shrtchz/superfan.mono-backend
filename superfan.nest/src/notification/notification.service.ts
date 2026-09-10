import { Injectable } from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { NotificationGateway } from './notification.gateway';

/**
 * Central catalogue of backend notification triggers.
 * UI must NOT be touched — every entry lands on the existing
 * notifications page via createNotification + websocket push.
 */
export const NotificationTriggers = {
  REFERRAL_SIGNUP_BONUS: 'referral_signup_bonus',
  REFERRAL_FIRST_TEST_BONUS: 'referral_first_test_bonus',
  REFEREE_SIGNUP_BONUS: 'referee_signup_bonus',
  ORDER_CONFIRMED: 'order_confirmed',
  ORDER_STATUS_UPDATE: 'order_status_update',
  PAYMENT_FAILED: 'payment_failed',
  AD_APPROVED_LIVE: 'ad_approved_live',
  AD_ENDED: 'ad_ended',
  AD_PERFORMANCE_MILESTONE: 'ad_performance_milestone',
  AD_REWARD_CREDITED: 'ad_reward_credited',
  AD_LIMIT_REACHED: 'ad_limit_reached',
  PODCAST_NEW_EPISODE: 'podcast_new_episode',
  TWO_FA_ENABLED: 'two_fa_enabled',
  NEW_LOGIN_DEVICE: 'new_login_device',
  OTP_CODE_SENT: 'otp_code_sent',
  TEST_QUIZ_REWARD: 'quiz_reward',
  LIVE_QUIZ_REWARD: 'live_quiz_reward',
  LIVE_QUIZ_JACKPOT: 'live_quiz_jackpot',
  NEW_QUIZ_AVAILABLE: 'new_quiz_available',
  QUIZ_REMINDER: 'quiz_reminder',
  TESTS_REMAINING_LOW: 'tests_remaining_low',
  LIVE_QUIZ_STARTING_SOON: 'live_quiz_starting_soon',
  MANUAL_CREDIT_APPLIED: 'wallet_credit_manual',
  MID_QUIZ_AD_POINTS: 'mid_quiz_ad_points',
  ACCOUNT_BANNED: 'client_account_banned',
  ACCOUNT_UNBANNED: 'client_account_unbanned',
  PLAN_UPGRADED: 'plan_upgraded',
  PASSWORD_CHANGED: 'password_changed',
  CONTACT_INFO_UPDATED: 'contact_info_updated',
} as const;

export type NotificationTrigger =
  (typeof NotificationTriggers)[keyof typeof NotificationTriggers];

@Injectable()
export class NotificationService {
  constructor(private gateway: NotificationGateway) {}

  async createNotification(userId: number, title: string, message: string, type?: string) {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type
      },
    });

    // realtime websocket
    let check_notif = await this.gateway.sendNotificationToUser(
      userId,
      notification,
    );

    return notification;
  }

  async notify(
    userId: number,
    type: NotificationTrigger | string,
    title: string,
    message: string,
  ) {
    return this.createNotification(userId, title, message, type);
  }

  async referralSignupBonus(referrerId: number, refereeUsername: string) {
    return this.notify(
      referrerId,
      NotificationTriggers.REFERRAL_SIGNUP_BONUS,
      '🎉 ₦20 Earned!',
      `${refereeUsername} signed up with your referral code.`,
    );
  }

  async referralFirstTestBonus(referrerId: number, refereeUsername: string) {
    return this.notify(
      referrerId,
      NotificationTriggers.REFERRAL_FIRST_TEST_BONUS,
      '💰 ₦10 More!',
      `${refereeUsername} completed their first test.`,
    );
  }

  async refereeSignupBonus(newUserId: number) {
    return this.notify(
      newUserId,
      NotificationTriggers.REFEREE_SIGNUP_BONUS,
      'Welcome Bonus!',
      'You earned ₦20 for joining with a referral code.',
    );
  }

  async orderConfirmed(userId: number, productLabel: string) {
    return this.notify(
      userId,
      NotificationTriggers.ORDER_CONFIRMED,
      '✅ Order Confirmed',
      `Order Confirmed for ${productLabel}.`,
    );
  }

  async orderStatusUpdate(userId: number, orderNumber: string, status: string) {
    const normalized = String(status || '').toUpperCase();
    const title =
      normalized === 'SHIPPED' ? '📦 Order Shipped!' : `📦 Order Update: ${status}`;
    return this.notify(
      userId,
      NotificationTriggers.ORDER_STATUS_UPDATE,
      title,
      normalized === 'SHIPPED'
        ? `#${orderNumber} is on its way.`
        : `#${orderNumber} status: ${status}.`,
    );
  }

  async paymentFailed(userId: number, orderNumber?: string) {
    return this.notify(
      userId,
      NotificationTriggers.PAYMENT_FAILED,
      '⚠️ Payment Failed.',
      orderNumber ? `Payment for #${orderNumber} failed. Tap to retry.` : 'Tap to retry.',
    );
  }

  async adApprovedLive(userId: number, campaignTitle: string) {
    return this.notify(
      userId,
      NotificationTriggers.AD_APPROVED_LIVE,
      '📢 Your Ad Is Live!',
      `"${campaignTitle}" is now running.`,
    );
  }

  async adEnded(userId: number, campaignTitle: string) {
    return this.notify(
      userId,
      NotificationTriggers.AD_ENDED,
      'Ad Campaign Ended.',
      `"${campaignTitle}" has wrapped.`,
    );
  }

  async adPerformanceMilestone(userId: number, campaignTitle: string, impressions: number) {
    return this.notify(
      userId,
      NotificationTriggers.AD_PERFORMANCE_MILESTONE,
      `🚀 "${campaignTitle}" just hit ${Number(impressions).toLocaleString()} impressions!`,
      `"${campaignTitle}" just hit ${Number(impressions).toLocaleString()} impressions!`,
    );
  }

  async adRewardCredited(userId: number, amountNaira = 2) {
    return this.notify(
      userId,
      NotificationTriggers.AD_REWARD_CREDITED,
      `🎬 You earned ₦${amountNaira} for watching an ad.`,
      `🎬 You earned ₦${amountNaira} for watching an ad.`,
    );
  }

  async adLimitReached(userId: number, resetsIn: string) {
    return this.notify(
      userId,
      NotificationTriggers.AD_LIMIT_REACHED,
      "📺 Today's ad limit reached, resets in " + resetsIn + '.',
      "📺 Today's ad limit reached, resets in " + resetsIn + '.',
    );
  }

  async podcastNewEpisode(userIds: number[], episodeTitle: string) {
    const title = `🎧 "${episodeTitle}" just dropped.`;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.PODCAST_NEW_EPISODE, title, title).catch(() => null),
      ),
    );
    return { sent: userIds.length };
  }

  async twoFaEnabled(userId: number) {
    return this.notify(
      userId,
      NotificationTriggers.TWO_FA_ENABLED,
      '🔒 Two-factor authentication is now active.',
      '🔒 Two-factor authentication is now active.',
    );
  }

  async newLoginDevice(userId: number) {
    return this.notify(
      userId,
      NotificationTriggers.NEW_LOGIN_DEVICE,
      "New login from a new device. Wasn't you? Secure your account.",
      "New login from a new device. Wasn't you? Secure your account.",
    );
  }

  async otpCodeSent(userId: number, code: string) {
    return this.notify(
      userId,
      NotificationTriggers.OTP_CODE_SENT,
      `Your Superfan code is ${code}. Expires in 10 min.`,
      `Your Superfan code is ${code}. Expires in 10 min.`,
    );
  }

  async testQuizReward(userId: number, points: number, amountNaira: number) {
    const msg = `🎉 You earned ${Number(points).toLocaleString()} pts (₦${amountNaira}).`;
    return this.notify(userId, NotificationTriggers.TEST_QUIZ_REWARD, msg, msg);
  }

  async liveQuizReward(userId: number, amountNaira: number) {
    const msg = `🏆 You earned ₦${Number(amountNaira).toLocaleString()} from today's live quiz.`;
    return this.notify(userId, NotificationTriggers.LIVE_QUIZ_REWARD, msg, msg);
  }

  async liveQuizJackpot(userId: number, amountNaira: number) {
    const msg = `💥 Jackpot! ₦${Number(amountNaira).toLocaleString()} credited to your Gold Account.`;
    return this.notify(userId, NotificationTriggers.LIVE_QUIZ_JACKPOT, msg, msg);
  }

  async newQuizAvailable(userIds: number[], quizLabel = 'A fresh quiz just dropped.') {
    const msg = `📝 ${quizLabel}`;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.NEW_QUIZ_AVAILABLE, msg, msg).catch(() => null),
      ),
    );
    return { sent: userIds.length };
  }

  async quizReminder(userId: number) {
    const msg = "⏳ Don't forget your quiz today.";
    return this.notify(userId, NotificationTriggers.QUIZ_REMINDER, msg, msg);
  }

  async testsRemainingLow(userId: number, remaining: number) {
    const msg = `🎯 ${remaining} Test(s) Left Today.`;
    return this.notify(userId, NotificationTriggers.TESTS_REMAINING_LOW, msg, msg);
  }

  async liveQuizStartingSoon(userIds: number[], minutes = 5) {
    const msg = `🔴 Kicks off in ${minutes} minutes.`;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.LIVE_QUIZ_STARTING_SOON, msg, msg).catch(() => null),
      ),
    );
    return { sent: userIds.length };
  }

  async manualCreditApplied(userId: number, amountNaira = 2) {
    const msg = `💰 ₦${amountNaira} added from a recent live quiz.`;
    return this.notify(userId, NotificationTriggers.MANUAL_CREDIT_APPLIED, msg, msg);
  }

  async midQuizAdPoints(userId: number, points = 200) {
    const msg = `+${points} PTS added to your score.`;
    return this.notify(userId, NotificationTriggers.MID_QUIZ_AD_POINTS, msg, msg);
  }

  async accountBanned(userId: number, reason?: string) {
    const msg = reason
      ? `⛔ Account Suspended: ${reason}`
      : '⛔ Account Suspended: Violation of community guidelines.';
    return this.notify(userId, NotificationTriggers.ACCOUNT_BANNED, msg, msg);
  }

  async accountUnbanned(userId: number) {
    const msg = '✅ Account Restored.';
    return this.notify(userId, NotificationTriggers.ACCOUNT_UNBANNED, msg, msg);
  }

  async planUpgraded(userId: number, plan?: string) {
    const normalized = String(plan || '').toUpperCase();
    const label =
      normalized === 'PREMIUM_PRO_MAX' ? 'Pro Max' : normalized === 'PREMIUM_PRO' ? 'Pro' : normalized || 'Pro';
    const msg = `🌟 Welcome to ${label}!`;
    return this.notify(userId, NotificationTriggers.PLAN_UPGRADED, msg, msg);
  }

  async passwordChanged(userId: number) {
    const msg = '🔒 Your password was just updated.';
    return this.notify(userId, NotificationTriggers.PASSWORD_CHANGED, msg, msg);
  }

  async contactInfoUpdated(userId: number, field = 'email') {
    const msg = `Your ${field} was updated.`;
    return this.notify(userId, NotificationTriggers.CONTACT_INFO_UPDATED, msg, msg);
  }

  findNotificationByUserId(userId: number) {
    return prisma.notification.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getUnreadCount(userId: number) {
    return prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  async markAsRead(notificationId: number) {
    return prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: number) {
    return prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
      },
    });
  }

  deleteNotificationsByUserId(userId: number) {
    return prisma.notification.deleteMany({
      where: {
        userId: userId,
      },
    });
  }

  deleteNotificationByUserId(notificationId: number) {
    return prisma.notification.delete({
      where: {
        id: notificationId,
      },
    });
  }
}
