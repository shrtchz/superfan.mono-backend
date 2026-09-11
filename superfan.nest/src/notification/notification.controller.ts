import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Delete } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { Public } from '../common/decorators';
import { NotificationService } from './notification.service';

@Controller(ApiRoutes.NOTIFICATION)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Post('/create')
  async createNotification(
    @Body() body: { userId: number; title: string; message: string; type?: string; data?: any },
  ) {
    return this.notificationService.createNotification(
      body.userId,
      body.title,
      body.message,
      body.type || 'live_quiz_reward',
    );
  }

  // ── Copy-paste ready trigger fan-outs (backend-only integrations).
  // These mutate NO domain state; they land on the existing notification page.
  @Public()
  @Post('/triggers/ad-approved-live')
  @HttpCode(HttpStatus.OK)
  triggerAdApprovedLive(@Body() body: { userId: number; campaignTitle: string }) {
    return this.notificationService.adApprovedLive(body.userId, body.campaignTitle);
  }

  @Public()
  @Post('/triggers/ad-ended')
  @HttpCode(HttpStatus.OK)
  triggerAdEnded(@Body() body: { userId: number; campaignTitle: string }) {
    return this.notificationService.adEnded(body.userId, body.campaignTitle);
  }

  @Public()
  @Post('/triggers/ad-performance-milestone')
  @HttpCode(HttpStatus.OK)
  triggerAdMilestone(@Body() body: { userId: number; campaignTitle: string; impressions: number }) {
    return this.notificationService.adPerformanceMilestone(body.userId, body.campaignTitle, body.impressions);
  }

  @Public()
  @Post('/triggers/ad-reward-credited')
  @HttpCode(HttpStatus.OK)
  triggerAdReward(@Body() body: { userId: number; amountNaira?: number }) {
    return this.notificationService.adRewardCredited(body.userId, body.amountNaira ?? 2);
  }

  @Public()
  @Post('/triggers/ad-limit-reached')
  @HttpCode(HttpStatus.OK)
  triggerAdLimit(@Body() body: { userId: number; resetsIn: string }) {
    return this.notificationService.adLimitReached(body.userId, body.resetsIn);
  }

  @Public()
  @Post('/triggers/podcast-new-episode')
  @HttpCode(HttpStatus.OK)
  triggerPodcast(@Body() body: { userIds: number[]; episodeTitle: string }) {
    return this.notificationService.podcastNewEpisode(body.userIds ?? [], body.episodeTitle);
  }

  @Public()
  @Post('/triggers/2fa-enabled')
  @HttpCode(HttpStatus.OK)
  trigger2faEnabled(@Body() body: { userId: number }) {
    return this.notificationService.twoFaEnabled(body.userId);
  }

  @Public()
  @Post('/triggers/new-login-device')
  @HttpCode(HttpStatus.OK)
  triggerNewLogin(@Body() body: { userId: number }) {
    return this.notificationService.newLoginDevice(body.userId);
  }

  @Public()
  @Post('/triggers/otp-sent')
  @HttpCode(HttpStatus.OK)
  triggerOtpSent(@Body() body: { userId: number; code: string }) {
    return this.notificationService.otpCodeSent(body.userId, body.code);
  }

  @Public()
  @Post('/triggers/live-quiz-starting-soon')
  @HttpCode(HttpStatus.OK)
  triggerLiveSoon(@Body() body: { userIds: number[]; minutes?: number }) {
    return this.notificationService.liveQuizStartingSoon(body.userIds ?? [], body.minutes ?? 5);
  }

  @Public()
  @Post('/triggers/tests-remaining-low')
  @HttpCode(HttpStatus.OK)
  triggerTestsLow(@Body() body: { userId: number; remaining: number }) {
    return this.notificationService.testsRemainingLow(body.userId, body.remaining);
  }

  @Public()
  @Post('/triggers/new-quiz-available')
  @HttpCode(HttpStatus.OK)
  triggerNewQuiz(@Body() body: { userIds: number[]; quizLabel?: string }) {
    return this.notificationService.newQuizAvailable(body.userIds ?? [], body.quizLabel);
  }

  @Public()
  @Post('/triggers/mid-quiz-ad-points')
  @HttpCode(HttpStatus.OK)
  triggerMidQuizAd(@Body() body: { userId: number; points?: number }) {
    return this.notificationService.midQuizAdPoints(body.userId, body.points ?? 200);
  }

  @Public()
  @Post('/triggers/account-banned')
  @HttpCode(HttpStatus.OK)
  triggerAccountBanned(@Body() body: { userId: number; reason?: string }) {
    return this.notificationService.accountBanned(body.userId, body.reason);
  }

  @Public()
  @Post('/triggers/account-unbanned')
  @HttpCode(HttpStatus.OK)
  triggerAccountUnbanned(@Body() body: { userId: number }) {
    return this.notificationService.accountUnbanned(body.userId);
  }

  @Public()
  @Post('/triggers/plan-upgraded')
  @HttpCode(HttpStatus.OK)
  triggerPlanUpgraded(@Body() body: { userId: number; plan?: string }) {
    return this.notificationService.planUpgraded(body.userId, body.plan);
  }

  @Public()
  @Post('/triggers/password-changed')
  @HttpCode(HttpStatus.OK)
  triggerPasswordChanged(@Body() body: { userId: number }) {
    return this.notificationService.passwordChanged(body.userId);
  }

  @Public()
  @Post('/triggers/contact-info-updated')
  @HttpCode(HttpStatus.OK)
  triggerContactInfoUpdated(@Body() body: { userId: number; field?: string }) {
    return this.notificationService.contactInfoUpdated(body.userId, body.field);
  }

  @Public()
  @Post('/triggers/wallet-credited')
  @HttpCode(HttpStatus.OK)
  triggerWalletCredited(@Body() body: { userId: number; amountNaira?: number }) {
    return this.notificationService.walletCredited(body.userId, body.amountNaira ?? 2);
  }

  @Public()
  @Post('/triggers/withdrawal-requested')
  @HttpCode(HttpStatus.OK)
  triggerWithdrawalRequested(@Body() body: { userId: number; amountNaira?: number }) {
    return this.notificationService.withdrawalRequested(body.userId, body.amountNaira ?? 2);
  }

  @Public()
  @Post('/triggers/withdrawal-completed')
  @HttpCode(HttpStatus.OK)
  triggerWithdrawalCompleted(@Body() body: { userId: number; amountNaira?: number; destination?: string }) {
    return this.notificationService.withdrawalCompleted(body.userId, body.amountNaira ?? 2, body.destination);
  }

  @Public()
  @Post('/triggers/withdrawal-failed')
  @HttpCode(HttpStatus.OK)
  triggerWithdrawalFailed(@Body() body: { userId: number }) {
    return this.notificationService.withdrawalFailed(body.userId);
  }

  @Public()
  @Post('/triggers/payment-method-added')
  @HttpCode(HttpStatus.OK)
  triggerPaymentMethodAdded(@Body() body: { userId: number; label?: string }) {
    return this.notificationService.paymentMethodAdded(body.userId, body.label);
  }

  @Public()
  @Post('/triggers/payment-method-removed')
  @HttpCode(HttpStatus.OK)
  triggerPaymentMethodRemoved(@Body() body: { userId: number; label?: string }) {
    return this.notificationService.paymentMethodRemoved(body.userId, body.label);
  }

  @Public()
  @Post('/triggers/default-payment-method-changed')
  @HttpCode(HttpStatus.OK)
  triggerDefaultPaymentMethod(@Body() body: { userId: number; label?: string }) {
    return this.notificationService.defaultPaymentMethodChanged(body.userId, body.label);
  }

  @Public()
  @Post('/triggers/minimum-withdrawal-not-met')
  @HttpCode(HttpStatus.OK)
  triggerMinimumWithdrawal(@Body() body: { userId: number; minimum?: number }) {
    return this.notificationService.minimumWithdrawalNotMet(body.userId, body.minimum ?? 1000);
  }

  @Public()
  @Post('/triggers/gold-personal-transfer')
  @HttpCode(HttpStatus.OK)
  triggerGoldPersonalTransfer(@Body() body: { userId: number; amountNaira: number; from: string; to: string }) {
    return this.notificationService.goldPersonalTransfer(body.userId, body.amountNaira, body.from, body.to);
  }

  @Public()
  @Post('/triggers/stream-comment-liked')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentLiked(@Body() body: { userId: number; likerName: string; commentPreview: string }) {
    return this.notificationService.streamCommentLiked(body.userId, body.likerName, body.commentPreview);
  }

  @Public()
  @Post('/triggers/stream-comment-liked-moderator')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentLikedModerator(@Body() body: { userIds: number[]; likerName: string; streamTitle: string }) {
    return this.notificationService.streamCommentLikedModerator(
      body.userIds ?? [],
      body.likerName,
      body.streamTitle,
    );
  }

  @Public()
  @Post('/triggers/stream-comment-reported')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentReported(@Body() body: { userIds: number[]; streamTitle: string }) {
    return this.notificationService.streamCommentReported(body.userIds ?? [], body.streamTitle);
  }

  @Public()
  @Post('/triggers/stream-admin-reply')
  @HttpCode(HttpStatus.OK)
  triggerStreamAdminReply(@Body() body: { userIds: number[]; adminName: string; streamTitle: string }) {
    return this.notificationService.streamAdminReply(body.userIds ?? [], body.adminName, body.streamTitle);
  }

  @Public()
  @Post('/triggers/stream-going-live')
  @HttpCode(HttpStatus.OK)
  triggerStreamGoingLive(@Body() body: { userIds: number[]; streamTitle: string }) {
    return this.notificationService.streamGoingLive(body.userIds ?? [], body.streamTitle);
  }

  @Public()
  @Post('/triggers/stream-ending-soon')
  @HttpCode(HttpStatus.OK)
  triggerStreamEndingSoon(@Body() body: { userIds: number[]; streamTitle: string; minutes?: number }) {
    return this.notificationService.streamEndingSoon(body.userIds ?? [], body.streamTitle, body.minutes ?? 10);
  }

  @Public()
  @Post('/triggers/stream-winner-tagged')
  @HttpCode(HttpStatus.OK)
  triggerStreamWinnerTagged(@Body() body: { userId: number }) {
    return this.notificationService.streamWinnerTagged(body.userId);
  }

  @Public()
  @Post('/triggers/stream-comment-removed')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentRemoved(@Body() body: { userId: number }) {
    return this.notificationService.streamCommentRemoved(body.userId);
  }

  @Public()
  @Post('/triggers/stream-chat-banned')
  @HttpCode(HttpStatus.OK)
  triggerStreamChatBanned(@Body() body: { userId: number; streamTitle: string }) {
    return this.notificationService.streamChatBanned(body.userId, body.streamTitle);
  }

  @Public()
  @Post('/triggers/stream-chat-lock-toggle')
  @HttpCode(HttpStatus.OK)
  triggerStreamChatLockToggle(@Body() body: { userIds: number[]; streamTitle: string; locked: boolean }) {
    return this.notificationService.streamChatLockToggle(body.userIds ?? [], body.streamTitle, body.locked);
  }

  @Public()
  @Post('/triggers/stream-manual-credit')
  @HttpCode(HttpStatus.OK)
  triggerStreamManualCredit(@Body() body: { userId: number; amountNaira?: number; streamTitle?: string }) {
    return this.notificationService.streamManualCredit(body.userId, body.amountNaira ?? 2, body.streamTitle);
  }

  @Public()
  @Post('/triggers/stream-live-quiz-jackpot')
  @HttpCode(HttpStatus.OK)
  triggerStreamLiveQuizJackpot(@Body() body: { userId: number; amountNaira: number }) {
    return this.notificationService.streamLiveQuizJackpot(body.userId, body.amountNaira);
  }

@Get('/:userId')
getUserNotifications(@Param('userId') userId: number) {
  // const userId = req.user.id; // from auth (JWT / Clerk / Passport)
  return this.notificationService.findNotificationByUserId(userId);
}

  @Get(':userId/unread-count')
  getUnreadCount(@Param('userId') userId: string) {
    return this.notificationService.getUnreadCount(Number(userId));
  }

  @Patch(':notificationId/read')
  markAsRead(@Param('notificationId') notificationId: string) {
    return this.notificationService.markAsRead(Number(notificationId));
  }

  @Patch(':userId/read-all')
  markAllAsRead(@Param('userId') userId: string) {
    return this.notificationService.markAllAsRead(Number(userId));
  }

@Delete('/:userId')
deleteNotifications(@Param('userId') userId: number) {
  // const userId = req.user.id; // from auth (JWT / Clerk / Passport)
  return this.notificationService.deleteNotificationsByUserId(userId);
}

@Delete('/:notificationId')
deleteNotification(@Param('notificationId') notificationId: number) {
  // const userId = req.user.id; // from auth (JWT / Clerk / Passport)
  return this.notificationService.deleteNotificationByUserId(notificationId);
}
}