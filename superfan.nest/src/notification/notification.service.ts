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
  AD_REJECTED: 'ad_rejected',
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
  DAILY_STREAK: 'daily_streak',
  STREAK_ENDING_SOON: 'streak_ending_soon',
  STREAK_RESET: 'streak_reset',
  TESTS_REMAINING_LOW: 'tests_remaining_low',
  LIVE_QUIZ_STARTING_SOON: 'live_quiz_starting_soon',
  MANUAL_CREDIT_APPLIED: 'wallet_credit_manual',
  MID_QUIZ_AD_POINTS: 'mid_quiz_ad_points',
  ACCOUNT_BANNED: 'client_account_banned',
  ACCOUNT_UNBANNED: 'client_account_unbanned',
  PLAN_UPGRADED: 'plan_upgraded',
  PASSWORD_CHANGED: 'password_changed',
  CONTACT_INFO_UPDATED: 'contact_info_updated',
  WALLET_CREDITED: 'wallet_credited',
  WITHDRAWAL_REQUESTED: 'withdrawal_requested',
  WITHDRAWAL_COMPLETED: 'withdrawal_completed',
  WITHDRAWAL_FAILED: 'withdrawal_failed',
  PAYMENT_METHOD_ADDED: 'payment_method_added',
  PAYMENT_METHOD_REMOVED: 'payment_method_removed',
  DEFAULT_PAYMENT_METHOD_CHANGED: 'default_payment_method_changed',
  MINIMUM_WITHDRAWAL_NOT_MET: 'minimum_withdrawal_not_met',
  SAVINGS_CHECKING_TRANSFER: 'savings_checking_transfer',
  KYC_SUBMITTED: 'kyc_in_progress',
  KYC_APPROVED: 'kyc_approved',
  KYC_REJECTED: 'kyc_failed',
  KYC_WITHDRAWAL_LIMIT_REACHED: 'minimum_withdrawal_not_met',
  ADMIN_ACCOUNT_CREATED: 'admin_account_created',
  ADMIN_INVITED: 'admin_invited',
  ADMIN_INVITE_RESENT: 'admin_invite_resent',
  ADMIN_ROLE_CHANGED: 'admin_role_changed',
  ADMIN_TASK_ASSIGNED: 'admin_task_assigned',
  ADMIN_MESSAGE_RECEIVED: 'admin_message_received',
  ADMIN_LOGIN_DETECTED: 'admin_login_detected',
  ADMIN_PASSWORD_CHANGED: 'admin_password_changed',
  ADMIN_CONTACT_INFO_UPDATED: 'admin_contact_info_updated',
  STREAM_COMMENT_LIKED: 'stream_comment_liked',
  STREAM_COMMENT_LIKED_MODERATOR: 'stream_comment_liked_moderator',
  STREAM_COMMENT_REPORTED: 'stream_comment_reported',
  STREAM_COMMENT_REPORT_CONFIRMATION: 'stream_comment_report_confirmation',
  STREAM_ADMIN_REPLY: 'stream_admin_reply',
  STREAM_GOING_LIVE: 'stream_going_live',
  STREAM_ENDING_SOON: 'stream_ending_soon',
  STREAM_WINNER_TAGGED: 'stream_winner_tagged',
  STREAM_COMMENT_REMOVED: 'stream_comment_removed',
  STREAM_CHAT_BANNED: 'stream_chat_banned',
  STREAM_CHAT_LOCK_TOGGLE: 'stream_chat_lock_toggle',
  STREAM_MANUAL_CREDIT: 'stream_manual_credit',
  STREAM_LIVE_QUIZ_JACKPOT: 'stream_live_quiz_jackpot',
  LIVE_QUIZ_CONSOLATION: 'live_quiz_consolation',
  CHALLENGE_INVITE_SENT: 'challenge_invite_sent',
  CHALLENGE_INVITE_ACCEPTED: 'challenge_invite_accepted',
  CHALLENGE_INVITE_DECLINED: 'challenge_invite_declined',
  VERSUS_REQUEST_SENT: 'versus_request_sent',
  VERSUS_REQUEST_ACCEPTED: 'versus_request_accepted',
  VERSUS_REQUEST_DECLINED: 'versus_request_declined',
  VERSUS_REQUEST_EXPIRED: 'versus_request_expired',
  VERSUS_MATCH_WIN: 'versus_match_win',
  VERSUS_MATCH_DRAW: 'versus_match_draw',
  VERSUS_MATCH_LOSS: 'versus_match_loss',
} as const;

export type NotificationTrigger =
  (typeof NotificationTriggers)[keyof typeof NotificationTriggers];

@Injectable()
export class NotificationService {
  constructor(private gateway: NotificationGateway) {}

  private sanitizeText(value: string) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async findRecentDuplicate(
    userId: number,
    type: string | undefined,
    title: string,
    message: string,
  ) {
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const normalizedTitle = this.sanitizeText(title);
    const normalizedMessage = this.sanitizeText(message);

    return prisma.notification.findFirst({
      where: {
        userId,
        ...(type ? { type } : {}),
        ...(type ? { message: normalizedMessage } : { title: normalizedTitle, message: normalizedMessage }),
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createNotification(
    userId: number,
    title: string,
    message: string,
    type?: string,
    createdAt?: Date,
  ) {
    const sanitizedTitle = this.sanitizeText(title);
    const sanitizedMessage = this.sanitizeText(message);

    if (!sanitizedTitle && !sanitizedMessage) return null;

    const duplicate = await this.findRecentDuplicate(userId, type, sanitizedTitle, sanitizedMessage);
    if (duplicate) {
      return duplicate;
    }

    const notification = await prisma.notification.create({
      data: {
        userId,
        title: sanitizedTitle,
        message: sanitizedMessage,
        type,
        ...(createdAt ? { createdAt } : {}),
      },
    });

    // realtime websocket
    await this.gateway.sendNotificationToUser(
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
    createdAt?: Date,
  ) {
    return this.createNotification(userId, title, message, type, createdAt);
  }

  async referralSignupBonus(referrerId: number, refereeUsername: string) {
    return this.notify(
      referrerId,
      NotificationTriggers.REFERRAL_SIGNUP_BONUS,
      'Referral Bonus - Sign up',
      `₦20 Earned! @${String(refereeUsername || "").replace(/^@/, "").trim()} signed up with your referral code.`,
    );
  }

  async referralFirstTestBonus(referrerId: number, refereeUsername: string) {
    return this.notify(
      referrerId,
      NotificationTriggers.REFERRAL_FIRST_TEST_BONUS,
      'Referral Bonus - First Test',
      `₦10 More! @${String(refereeUsername || "").replace(/^@/, "").trim()} completed their first test.`,
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

  async challengeInviteSent(receiverId: number, senderUsername: string) {
    const msg = `New Challenge! @${String(senderUsername || "").replace(/^@/, "").trim()} just challenged you to a quiz.`;
    return this.notify(
      receiverId,
      NotificationTriggers.CHALLENGE_INVITE_SENT,
      msg,
      msg,
    );
  }

  async challengeInviteAccepted(senderId: number, receiverUsername: string) {
    const msg = `Challenge Accepted! @${String(receiverUsername || "").replace(/^@/, "").trim()} accepted your challenge.`;
    return this.notify(
      senderId,
      NotificationTriggers.CHALLENGE_INVITE_ACCEPTED,
      msg,
      msg,
    );
  }

  async challengeInviteDeclined(senderId: number, receiverUsername: string) {
    const msg = `@${String(receiverUsername || "").replace(/^@/, "").trim()} can't take on your challenge right now.`;
    return this.notify(
      senderId,
      NotificationTriggers.CHALLENGE_INVITE_DECLINED,
      msg,
      msg,
    );
  }

  private versusIdempotencyKeys = new Set<string>();

  async createVersusNotification(
    userId: number,
    title: string,
    message: string,
    type: string,
    idempotencyKey: string,
  ) {
    if (this.versusIdempotencyKeys.has(idempotencyKey)) {
      return null;
    }

    const sanitizedMessage = this.sanitizeText(message);
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type,
        message: sanitizedMessage,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      this.versusIdempotencyKeys.add(idempotencyKey);
      return existing;
    }

    this.versusIdempotencyKeys.add(idempotencyKey);
    return this.createNotification(userId, title, message, type);
  }

  async versusRequestSent(
    opponentId: number,
    hostUsername: string,
    mode: string,
    jackpot: number,
    versusId: number = 0,
  ) {
    const formattedMode = String(mode || '').toLowerCase().includes('schedule')
      ? 'Schedule H2H'
      : 'Live 1v1';
    const cleanHost = String(hostUsername || '').replace(/^@/, '').trim();
    const formattedJackpot = Number(jackpot).toLocaleString();

    const title = 'New Versus Request!';
    const msg =
      formattedMode === 'Schedule H2H'
        ? `New Versus request! @${cleanHost} challenged you to a Schedule H2H for a ₦${formattedJackpot} jackpot. It starts in 48hrs. Tap to respond.`
        : `New Versus request! @${cleanHost} challenged you to a Live 1v1 for a ₦${formattedJackpot} jackpot. Tap to respond.`;

    const idempotencyKey = `versus_${versusId}_request_received_${opponentId}`;
    return this.createVersusNotification(
      opponentId,
      title,
      msg,
      NotificationTriggers.VERSUS_REQUEST_SENT,
      idempotencyKey,
    );
  }

  async versusRequestAccepted(
    hostId: number,
    opponentUsername: string,
    versusId: number = 0,
  ) {
    const cleanOpponent = String(opponentUsername || '').replace(/^@/, '').trim();
    const title = 'Versus Request Accepted!';
    const msg = `@${cleanOpponent} accepted your Versus request. Start the match when you're ready.`;

    const idempotencyKey = `versus_${versusId}_request_accepted_${hostId}`;
    return this.createVersusNotification(
      hostId,
      title,
      msg,
      NotificationTriggers.VERSUS_REQUEST_ACCEPTED,
      idempotencyKey,
    );
  }

  async versusRequestDeclined(hostId: number, opponentUsername: string) {
    const cleanOpponent = String(opponentUsername || '').replace(/^@/, '').trim();
    const title = 'Versus Request Declined';
    const msg = `@${cleanOpponent} declined your Versus challenge. Your escrowed funds have been refunded.`;
    return this.notify(
      hostId,
      NotificationTriggers.VERSUS_REQUEST_DECLINED,
      title,
      msg,
    );
  }

  async versusRequestExpired(
    versusId: number,
    hostId: number,
    opponentId: number,
    hostUsername: string,
    opponentUsername: string,
    mode: string,
  ) {
    const formattedMode = String(mode || '').toLowerCase().includes('schedule')
      ? 'Schedule H2H'
      : 'Live 1v1';
    const cleanHost = String(hostUsername || '').replace(/^@/, '').trim();
    const cleanOpponent = String(opponentUsername || '').replace(/^@/, '').trim();

    const hostTitle = 'Versus Request Expired';
    const hostMessage = `Your ${formattedMode} with @${cleanOpponent} expired because it was not started in time.`;
    const hostKey = `versus_${versusId}_request_expired_${hostId}`;

    const oppTitle = 'Versus Request Expired';
    const oppMessage = `The ${formattedMode} request from @${cleanHost} expired.`;
    const oppKey = `versus_${versusId}_request_expired_${opponentId}`;

    const [hostNotif, oppNotif] = await Promise.all([
      this.createVersusNotification(
        hostId,
        hostTitle,
        hostMessage,
        NotificationTriggers.VERSUS_REQUEST_EXPIRED,
        hostKey,
      ),
      this.createVersusNotification(
        opponentId,
        oppTitle,
        oppMessage,
        NotificationTriggers.VERSUS_REQUEST_EXPIRED,
        oppKey,
      ),
    ]);

    return { hostNotif, oppNotif };
  }

  async versusMatchResult(match: {
    id: number;
    outcome: string;
    hostId: number;
    opponentId: number;
    host: { username: string };
    opponent: { username: string };
    jackpot: number;
    payoutStatus?: string;
  }) {
    if (!match.outcome || (match.outcome !== 'DRAW' && match.payoutStatus !== 'PAID')) {
      return null;
    }

    const cleanHost = String(match.host?.username || '').replace(/^@/, '').trim();
    const cleanOpponent = String(match.opponent?.username || '').replace(/^@/, '').trim();
    const formattedJackpot = Number(match.jackpot).toLocaleString();

    if (match.outcome === 'HOST_WON') {
      const winMessage = `You won ₦${formattedJackpot} in your Versus against @${cleanOpponent}! It has been credited to your Savings Account.`;
      const lossMessage = `@${cleanHost} won this Versus. Want a rematch?`;

      const hostKey = `versus_${match.id}_match_result_${match.hostId}`;
      const oppKey = `versus_${match.id}_match_result_${match.opponentId}`;

      return Promise.all([
        this.createVersusNotification(
          match.hostId,
          'Versus Match Won!',
          winMessage,
          NotificationTriggers.VERSUS_MATCH_WIN,
          hostKey,
        ),
        this.createVersusNotification(
          match.opponentId,
          'Versus Match Lost',
          lossMessage,
          NotificationTriggers.VERSUS_MATCH_LOSS,
          oppKey,
        ),
      ]);
    } else if (match.outcome === 'OPPONENT_WON') {
      const winMessage = `You won ₦${formattedJackpot} in your Versus against @${cleanHost}! It has been credited to your Savings Account.`;
      const lossMessage = `@${cleanOpponent} won this Versus. Want a rematch?`;

      const hostKey = `versus_${match.id}_match_result_${match.hostId}`;
      const oppKey = `versus_${match.id}_match_result_${match.opponentId}`;

      return Promise.all([
        this.createVersusNotification(
          match.hostId,
          'Versus Match Lost',
          lossMessage,
          NotificationTriggers.VERSUS_MATCH_LOSS,
          hostKey,
        ),
        this.createVersusNotification(
          match.opponentId,
          'Versus Match Won!',
          winMessage,
          NotificationTriggers.VERSUS_MATCH_WIN,
          oppKey,
        ),
      ]);
    } else if (match.outcome === 'DRAW') {
      const hostMessage = `It's a draw! You and @${cleanOpponent} finished level.`;
      const oppMessage = `It's a draw! You and @${cleanHost} finished level.`;

      const hostKey = `versus_${match.id}_match_result_${match.hostId}`;
      const oppKey = `versus_${match.id}_match_result_${match.opponentId}`;

      return Promise.all([
        this.createVersusNotification(
          match.hostId,
          'Versus Match Draw',
          hostMessage,
          NotificationTriggers.VERSUS_MATCH_DRAW,
          hostKey,
        ),
        this.createVersusNotification(
          match.opponentId,
          'Versus Match Draw',
          oppMessage,
          NotificationTriggers.VERSUS_MATCH_DRAW,
          oppKey,
        ),
      ]);
    }
    return null;
  }

  async streakMilestone(userId: number, days: number) {
    const msg = `${days}-Day Streak! Keep the fire burning.`;
    return this.notify(userId, NotificationTriggers.DAILY_STREAK, msg, msg);
  }

  async streakEndingSoon(userId: number, days: number) {
    const msg = `Streak Ending Soon. Take a quiz to save your ${days}-day streak.`;
    return this.notify(userId, NotificationTriggers.STREAK_ENDING_SOON, msg, msg);
  }

  async streakReset(userId: number) {
    const msg = 'Streak Reset. Start a fresh one today.';
    return this.notify(userId, NotificationTriggers.STREAK_RESET, msg, msg);
  }

  async orderConfirmed(userId: number, productLabel: string) {
    return this.notify(
      userId,
      NotificationTriggers.ORDER_CONFIRMED,
      'Order Confirmed',
      `Order Confirmed for ${productLabel}.`,
    );
  }

  async orderStatusUpdate(userId: number, orderNumber: string, status: string) {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized !== 'SHIPPED') return null;

    const message = `Order Shipped! #${orderNumber} is on its way.`;
    return this.notify(
      userId,
      NotificationTriggers.ORDER_STATUS_UPDATE,
      message,
      message,
    );
  }

  async paymentFailed(userId: number, _orderNumber?: string) {
    const message = 'Payment Failed. Tap to retry.';
    return this.notify(
      userId,
      NotificationTriggers.PAYMENT_FAILED,
      message,
      message,
    );
  }

  async adApprovedLive(userId: number, campaignTitle?: string) {
    void campaignTitle;
    const msg = 'Your Ad Is Live';
    return this.notify(
      userId,
      NotificationTriggers.AD_APPROVED_LIVE,
      msg,
      msg,
    );
  }

  async adRejected(
    userId: number,
    campaignTitle: string,
    reason: string,
    notes?: string,
    refundAmount?: number,
  ) {
    void refundAmount;
    const cleanNotes = (notes || '').trim();
    const noteText = cleanNotes ? ` - Note: ${cleanNotes}` : '';
    const msg = `Refund for rejected ad: ${campaignTitle} (Reason: ${reason})${noteText}`;
    return this.notify(
      userId,
      NotificationTriggers.AD_REJECTED,
      `Refund for rejected ad: ${campaignTitle}`,
      msg,
    );
  }

  async adEnded(userId: number, campaignTitle: string) {
    const msg = `Ad Campaign Ended. "${campaignTitle}" has wrapped.`;
    return this.notify(
      userId,
      NotificationTriggers.AD_ENDED,
      msg,
      msg,
    );
  }

  async adPerformanceMilestone(userId: number, campaignTitle: string, impressions: number) {
    return this.notify(
      userId,
      NotificationTriggers.AD_PERFORMANCE_MILESTONE,
      `"${campaignTitle}" just hit ${Number(impressions).toLocaleString()} impressions!`,
      `"${campaignTitle}" just hit ${Number(impressions).toLocaleString()} impressions!`,
    );
  }

  async adRewardCredited(userId: number, amountNaira = 2) {
    return this.notify(
      userId,
      NotificationTriggers.AD_REWARD_CREDITED,
      `You earned ₦${amountNaira} for watching an ad.`,
      `You earned ₦${amountNaira} for watching an ad.`,
    );
  }

  async adLimitReached(userId: number, resetsIn: string) {
    return this.notify(
      userId,
      NotificationTriggers.AD_LIMIT_REACHED,
      "Today's ad limit reached, resets in " + resetsIn + '.',
      "Today's ad limit reached, resets in " + resetsIn + '.',
    );
  }

  async podcastNewEpisode(userIds: number[], episodeTitle: string) {
    const title = `"${episodeTitle}" just dropped.`;
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
      'Two-factor authentication is now active.',
      'Two-factor authentication is now active.',
    );
  }

  async newLoginDevice(userId: number) {
    const recent = await prisma.notification.findFirst({
      where: {
        userId,
        type: NotificationTriggers.NEW_LOGIN_DEVICE,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return recent; // already alerted for this login burst

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
    const msg = `You earned ${Number(points).toLocaleString()} pts (₦${amountNaira}).`;
    return this.notify(userId, NotificationTriggers.TEST_QUIZ_REWARD, msg, msg);
  }

  async liveQuizReward(userId: number, amountNaira: number, createdAt?: Date) {
    const msg = `You won ₦${Number(amountNaira).toLocaleString()} from today's live quiz.`;
    return this.notify(userId, NotificationTriggers.LIVE_QUIZ_REWARD, msg, msg, createdAt);
  }

  async liveQuizJackpot(userId: number, amountNaira: number, createdAt?: Date) {
    const msg = `Jackpot! ₦${Number(amountNaira).toLocaleString()} credited to your Savings Account.`;
    return this.notify(userId, NotificationTriggers.LIVE_QUIZ_JACKPOT, msg, msg, createdAt);
  }

  async liveQuizConsolationReward(userId: number, points = 500, quizName = 'Live Quiz', createdAt?: Date) {
    const msg = `+${Number(points).toLocaleString()} PTS for playing! Every quiz counts.`;
    return this.notify(userId, NotificationTriggers.LIVE_QUIZ_CONSOLATION, msg, msg, createdAt);
  }

  async newQuizAvailable(userIds: number[], quizLabel = 'A fresh quiz just dropped.', createdAt?: Date) {
    const msg = quizLabel;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.NEW_QUIZ_AVAILABLE, msg, msg, createdAt).catch(() => null),
      ),
    );
    return { sent: userIds.length };
  }

  async quizReminder(userId: number) {
    const msg =
      "Don't miss today's quiz! Complete your 5 quizzes to make your daily Savings Deposit.";
    return this.notify(userId, NotificationTriggers.QUIZ_REMINDER, msg, msg);
  }

  async testsRemainingLow(userId: number, remaining: number) {
    const msg = `${remaining} Test(s) Left Today.`;
    return this.notify(userId, NotificationTriggers.TESTS_REMAINING_LOW, msg, msg);
  }

  async liveQuizStartingSoon(userIds: number[], minutes = 5) {
    const msg = `Kicks off in ${minutes} minutes.`;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.LIVE_QUIZ_STARTING_SOON, msg, msg).catch(() => null),
      ),
    );
    return { sent: userIds.length };
  }

  async manualCreditApplied(userId: number, amountNaira = 2) {
    const msg = `₦${amountNaira} added from a recent live quiz.`;
    return this.notify(userId, NotificationTriggers.MANUAL_CREDIT_APPLIED, msg, msg);
  }

  async midQuizAdPoints(userId: number, points = 200) {
    const msg = `+${points} PTS added to your score.`;
    return this.notify(userId, NotificationTriggers.MID_QUIZ_AD_POINTS, msg, msg);
  }

  async accountBanned(userId: number, reason?: string) {
    const msg = reason
      ? `Account Suspended: ${reason}`
      : 'Account Suspended: Violation of community guidelines.';
    return this.notify(userId, NotificationTriggers.ACCOUNT_BANNED, msg, msg);
  }

  async accountUnbanned(userId: number) {
    const msg = 'Account Restored.';
    return this.notify(userId, NotificationTriggers.ACCOUNT_UNBANNED, msg, msg);
  }

  async planUpgraded(userId: number, plan?: string) {
    const normalized = String(plan || '').toUpperCase();
    const label =
      normalized === 'PREMIUM_PRO_MAX' ? 'Pro Max' : normalized === 'PREMIUM_PRO' ? 'Pro' : normalized || 'Pro';
    const msg = `Welcome to ${label}!`;
    return this.notify(userId, NotificationTriggers.PLAN_UPGRADED, msg, msg);
  }

  async passwordChanged(userId: number) {
    const msg = 'Your password was just updated.';
    return this.notify(userId, NotificationTriggers.PASSWORD_CHANGED, msg, msg);
  }

  async contactInfoUpdated(userId: number, field = 'email') {
    const msg = `Your ${field} was updated.`;
    return this.notify(userId, NotificationTriggers.CONTACT_INFO_UPDATED, msg, msg);
  }

  async kycSubmitted(userId: number) {
    const msg = "We're reviewing your documents.";
    return this.notify(userId, NotificationTriggers.KYC_SUBMITTED, msg, msg);
  }

  async kycApproved(userId: number) {
    const msg = 'KYC Verified! Enjoy higher limits.';
    return this.notify(userId, NotificationTriggers.KYC_APPROVED, msg, msg);
  }

  async kycRejected(userId: number) {
    const msg = 'Verification failed. Tap to resubmit.';
    return this.notify(userId, NotificationTriggers.KYC_REJECTED, msg, msg);
  }

  async kycWithdrawalLimitReached(userId: number) {
    const msg = 'Complete your KYC to unlock higher withdrawal limits.';
    return this.notify(userId, NotificationTriggers.KYC_WITHDRAWAL_LIMIT_REACHED, msg, msg);
  }

  async adminAccountCreated(userId: number, adminName: string) {
    const msg = `${adminName} was added as an admin.`;
    return this.notify(userId, NotificationTriggers.ADMIN_ACCOUNT_CREATED, msg, msg);
  }

  async adminInviteSent(userId: number, inviterName?: string) {
    const msg = inviterName
      ? `${inviterName} invited you to join Superfan as an Admin.`
      : 'You have been invited to join Superfan as an Admin.';
    return this.notify(userId, NotificationTriggers.ADMIN_INVITED, msg, msg);
  }

  async adminInviteResent(userId: number) {
    const msg = 'Your admin invitation was resent.';
    return this.notify(userId, NotificationTriggers.ADMIN_INVITE_RESENT, msg, msg);
  }

  async adminRoleChanged(userId: number, roleName = 'Sub-Admin') {
    const msg = `Your role was updated to ${roleName}.`;
    return this.notify(userId, NotificationTriggers.ADMIN_ROLE_CHANGED, msg, msg);
  }

  async adminTaskAssigned(userId: number, assignedBy: string, taskTitle: string) {
    const msg = `${assignedBy} assigned you: "${taskTitle}"`;
    return this.notify(userId, NotificationTriggers.ADMIN_TASK_ASSIGNED, msg, msg);
  }

  async adminMessageReceived(userId: number, senderName: string, message: string) {
    const msg = `${senderName}: "${message}"`;
    return this.notify(userId, NotificationTriggers.ADMIN_MESSAGE_RECEIVED, msg, msg);
  }

  async adminLoginDetected(userId: number, location = 'Lagos, Nigeria', ip = '197.210.54.12') {
    const msg = `New login from ${location}, IP ${ip}.`;
    return this.notify(userId, NotificationTriggers.ADMIN_LOGIN_DETECTED, msg, msg);
  }

  async adminPasswordChanged(userId: number) {
    const msg = 'Your password was just updated.';
    return this.notify(userId, NotificationTriggers.ADMIN_PASSWORD_CHANGED, msg, msg);
  }

  async adminContactInfoUpdated(userId: number, field = 'email') {
    const msg = `Your ${field} was updated.`;
    return this.notify(userId, NotificationTriggers.ADMIN_CONTACT_INFO_UPDATED, msg, msg);
  }

  async walletCredited(userId: number, amountNaira = 2) {
    const msg = `₦${amountNaira.toLocaleString()} was added to your wallet.`;
    return this.notify(userId, NotificationTriggers.WALLET_CREDITED, msg, msg);
  }

  async withdrawalRequested(userId: number, amountNaira = 2) {
    const msg = `Payout of ₦${amountNaira.toLocaleString()} is processing.`;
    return this.notify(userId, NotificationTriggers.WITHDRAWAL_REQUESTED, msg, msg);
  }

  async withdrawalCompleted(userId: number, amountNaira = 2, destination?: string) {
    const msg = `₦${amountNaira.toLocaleString()} sent to your ${destination || 'bank'} account.`;
    return this.notify(userId, NotificationTriggers.WITHDRAWAL_COMPLETED, msg, msg);
  }

  async withdrawalFailed(userId: number) {
    const msg = 'Payout failed. Tap to retry.';
    return this.notify(userId, NotificationTriggers.WITHDRAWAL_FAILED, msg, msg);
  }

  async paymentMethodAdded(userId: number, label?: string) {
    const msg = `Your ${label || 'bank account'} was added.`;
    return this.notify(userId, NotificationTriggers.PAYMENT_METHOD_ADDED, msg, msg);
  }

  async paymentMethodRemoved(userId: number, label?: string) {
    const msg = `Your ${label || 'bank account'} was deleted.`;
    return this.notify(userId, NotificationTriggers.PAYMENT_METHOD_REMOVED, msg, msg);
  }

  async defaultPaymentMethodChanged(userId: number, label?: string) {
    const msg = `Default payout method is now ${label || 'Flutterwave'}.`;
    return this.notify(userId, NotificationTriggers.DEFAULT_PAYMENT_METHOD_CHANGED, msg, msg);
  }

  async minimumWithdrawalNotMet(userId: number, minimum = 1000) {
    const msg = `Need ₦${minimum.toLocaleString()} to withdraw. Keep earning!`;
    return this.notify(userId, NotificationTriggers.MINIMUM_WITHDRAWAL_NOT_MET, msg, msg);
  }

  async savingsCheckingTransfer(userId: number, amountNaira: number, from: string, to: string) {
    const msg = `Transferred ₦${amountNaira.toLocaleString()} from ${from} to ${to}`;
    return this.notify(userId, NotificationTriggers.SAVINGS_CHECKING_TRANSFER, msg, msg);
  }

  async streamCommentLiked(ownerUserId: number, likerName: string, commentPreview: string) {
    const preview =
      commentPreview.length > 60 ? `${commentPreview.slice(0, 60).trim()}…` : commentPreview;
    const msg = `${likerName} liked your comment: "${preview}"`;
    return this.notify(ownerUserId, NotificationTriggers.STREAM_COMMENT_LIKED, msg, msg);
  }

  async streamCommentLikedModerator(
    moderatorUserIds: number[],
    likerName: string,
    streamTitle: string,
  ) {
    if (!moderatorUserIds.length) return { sent: 0 };
    const msg = `${likerName} liked a comment in ${streamTitle}.`;
    await Promise.all(
      moderatorUserIds.map((id) =>
        this.notify(id, NotificationTriggers.STREAM_COMMENT_LIKED_MODERATOR, msg, msg).catch(
          () => null,
        ),
      ),
    );
    return { sent: moderatorUserIds.length };
  }

  async streamCommentReported(moderatorUserIds: number[], streamTitle: string) {
    if (!moderatorUserIds.length) return { sent: 0 };
    const msg = `New Report. A comment in ${streamTitle} was reported — tap to review.`;
    await Promise.all(
      moderatorUserIds.map((id) =>
        this.notify(id, NotificationTriggers.STREAM_COMMENT_REPORTED, msg, msg).catch(
          () => null,
        ),
      ),
    );
    return { sent: moderatorUserIds.length };
  }

  async streamCommentReportConfirmation(reporterUserId: number) {
    const msg = "Report Received. Thanks — we'll review this comment.";
    return this.notify(
      reporterUserId,
      NotificationTriggers.STREAM_COMMENT_REPORT_CONFIRMATION,
      msg,
      msg,
    );
  }

  async streamAdminReply(
    otherModeratorUserIds: number[],
    adminName: string,
    streamTitle: string,
  ) {
    if (!otherModeratorUserIds.length) return { sent: 0 };
    const msg = `Admin Replied. ${adminName} replied to a comment in ${streamTitle}.`;
    await Promise.all(
      otherModeratorUserIds.map((id) =>
        this.notify(id, NotificationTriggers.STREAM_ADMIN_REPLY, msg, msg).catch(
          () => null,
        ),
      ),
    );
    return { sent: otherModeratorUserIds.length };
  }

  async streamGoingLive(userIds: number[], streamTitle: string) {
    if (!userIds.length) return { sent: 0 };
    const msg = `We're Live! ${streamTitle} just started.`;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.STREAM_GOING_LIVE, msg, msg).catch(
          () => null,
        ),
      ),
    );
    return { sent: userIds.length };
  }

  async streamEndingSoon(userIds: number[], streamTitle: string, minutes = 10) {
    if (!userIds.length) return { sent: 0 };
    const msg = `${streamTitle} wraps up in ${minutes} minutes.`;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.STREAM_ENDING_SOON, msg, msg).catch(
          () => null,
        ),
      ),
    );
    return { sent: userIds.length };
  }

  async streamWinnerTagged(userId: number) {
    const msg = 'You Won! Check your wallet.';
    return this.notify(userId, NotificationTriggers.STREAM_WINNER_TAGGED, msg, msg);
  }

  async streamCommentRemoved(userId: number) {
    const msg = 'Your comment was removed for violating guidelines.';
    return this.notify(userId, NotificationTriggers.STREAM_COMMENT_REMOVED, msg, msg);
  }

  async streamChatBanned(userId: number, streamTitle: string) {
    const msg = `You've been muted from chat on ${streamTitle}.`;
    return this.notify(userId, NotificationTriggers.STREAM_CHAT_BANNED, msg, msg);
  }

  async streamChatLockToggle(userIds: number[], streamTitle: string, locked: boolean) {
    if (!userIds.length) return { sent: 0 };
    const msg = locked
      ? `Chat is locked on ${streamTitle}.`
      : `Chat is open again on ${streamTitle}.`;
    await Promise.all(
      userIds.map((id) =>
        this.notify(id, NotificationTriggers.STREAM_CHAT_LOCK_TOGGLE, msg, msg).catch(
          () => null,
        ),
      ),
    );
    return { sent: userIds.length };
  }

  async streamManualCredit(userId: number, amountNaira = 2, streamTitle?: string) {
    const msg = streamTitle
      ? ` ₦${amountNaira.toLocaleString()} added during ${streamTitle}.`
      : ` ₦${amountNaira.toLocaleString()} added during a live stream.`;
    return this.notify(userId, NotificationTriggers.STREAM_MANUAL_CREDIT, msg, msg);
  }

  async streamLiveQuizJackpot(userId: number, amountNaira: number) {
    const msg = `You won ₦${amountNaira.toLocaleString()} from today's live quiz.`;
    return this.notify(userId, NotificationTriggers.STREAM_LIVE_QUIZ_JACKPOT, msg, msg);
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
