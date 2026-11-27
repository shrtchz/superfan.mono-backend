import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Patch, Post, Delete, UseGuards } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { Public, Roles } from '../common/decorators';
import { Role } from '../common/enums/role.enum';
import { RoleGuard } from '../common/guards/roles.guard';
import { NotificationService } from './notification.service';

@Controller([ApiRoutes.NOTIFICATION, 'api/v1/notifications', 'notifications', 'notification'])
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  private isAdmin(req: any): boolean {
    return (
      req.user?.roleName === Role.superadmin ||
      req.user?.roleName === Role.subadmin
    );
  }

  private assertOwnerOrAdmin(req: any, targetUserId: number): void {
    if (!this.isAdmin(req) && Number(req.user?.id) !== Number(targetUserId)) {
      throw new ForbiddenException('You can only access your own notifications');
    }
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/create')
  async createNotification(
    @Body()
    body: {
      userId: number | string;
      title?: string;
      message?: string;
      type?: string;
      amount?: number;
      points?: number;
      createdAt?: string;
      data?: any;
    },
  ) {
    const resolvedUserId = Number(body.userId);
    if (!resolvedUserId || isNaN(resolvedUserId)) {
      return null;
    }

    const type = body.type || 'live_quiz_reward';
    const createdAtDate = body.createdAt ? new Date(body.createdAt) : undefined;
    const points = Number(body.points ?? body.data?.points ?? 0);
    const amount = Number(body.amount ?? body.data?.amount ?? 0);

    // Route standard trigger types directly to authentic NotificationService methods
    if (type === 'quiz_reward' || type === 'test_quiz_reward') {
      return this.notificationService.testQuizReward(
        resolvedUserId,
        points,
        amount,
      );
    }

    if (type === 'live_quiz_reward') {
      return this.notificationService.liveQuizReward(
        resolvedUserId,
        amount,
        createdAtDate,
      );
    }

    if (type === 'live_quiz_consolation') {
      return this.notificationService.liveQuizConsolationReward(
        resolvedUserId,
        points || 500,
        body.data?.quizName || 'Live Quiz',
        createdAtDate,
      );
    }

    if (type === 'live_quiz_jackpot') {
      return this.notificationService.liveQuizJackpot(
        resolvedUserId,
        amount,
        createdAtDate,
      );
    }

    if (type === 'minimum_withdrawal_not_met') {
      return this.notificationService.minimumWithdrawalNotMet(
        resolvedUserId,
        amount || 1000,
      );
    }

    const title = body.title?.trim() || '';
    const message = body.message?.trim() || '';

    return this.notificationService.createNotification(
      resolvedUserId,
      title || message || '',
      message || title || '',
      type,
      createdAtDate,
    );
  }

  // ── Copy-paste ready trigger fan-outs (backend-only integrations).
  // These mutate NO domain state; they land on the existing notification page.
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/ad-approved-live')
  @HttpCode(HttpStatus.OK)
  triggerAdApprovedLive(@Body() body: { userId: number; campaignTitle: string }) {
    return this.notificationService.adApprovedLive(body.userId, body.campaignTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/ad-rejected')
  @HttpCode(HttpStatus.OK)
  triggerAdRejected(
    @Body()
    body: {
      userId: number;
      campaignTitle: string;
      reason: string;
      notes?: string;
      refundAmount?: number;
    },
  ) {
    return this.notificationService.adRejected(
      body.userId,
      body.campaignTitle,
      body.reason,
      body.notes,
      body.refundAmount,
    );
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/ad-ended')
  @HttpCode(HttpStatus.OK)
  triggerAdEnded(@Body() body: { userId: number; campaignTitle: string }) {
    return this.notificationService.adEnded(body.userId, body.campaignTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/ad-performance-milestone')
  @HttpCode(HttpStatus.OK)
  triggerAdMilestone(@Body() body: { userId: number; campaignTitle: string; impressions: number }) {
    return this.notificationService.adPerformanceMilestone(body.userId, body.campaignTitle, body.impressions);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/ad-reward-credited')
  @HttpCode(HttpStatus.OK)
  triggerAdReward(@Body() body: { userId: number; amountNaira?: number }) {
    return this.notificationService.adRewardCredited(body.userId, body.amountNaira);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/ad-limit-reached')
  @HttpCode(HttpStatus.OK)
  triggerAdLimit(@Body() body: { userId: number; resetsIn: string }) {
    return this.notificationService.adLimitReached(body.userId, body.resetsIn);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/podcast-new-episode')
  @HttpCode(HttpStatus.OK)
  triggerPodcast(@Body() body: { userIds: number[]; episodeTitle: string }) {
    return this.notificationService.podcastNewEpisode(body.userIds ?? [], body.episodeTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/2fa-enabled')
  @HttpCode(HttpStatus.OK)
  trigger2faEnabled(@Body() body: { userId: number }) {
    return this.notificationService.twoFaEnabled(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/new-login-device')
  @HttpCode(HttpStatus.OK)
  triggerNewLogin(@Body() body: { userId: number }) {
    return this.notificationService.newLoginDevice(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/otp-sent')
  @HttpCode(HttpStatus.OK)
  triggerOtpSent(@Body() body: { userId: number; code: string }) {
    return this.notificationService.otpCodeSent(body.userId, body.code);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/live-quiz-starting-soon')
  @HttpCode(HttpStatus.OK)
  triggerLiveSoon(@Body() body: { userIds: number[]; minutes?: number }) {
    return this.notificationService.liveQuizStartingSoon(body.userIds ?? [], body.minutes ?? 5);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/referral-first-test')
  @HttpCode(HttpStatus.OK)
  triggerReferralFirstTest(
    @Body() body: { referrerId: number; refereeUsername: string },
  ) {
    return this.notificationService.referralFirstTestBonus(
      body.referrerId,
      body.refereeUsername,
    );
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/test-quiz-reward')
  @HttpCode(HttpStatus.OK)
  triggerTestQuizReward(
    @Body() body: { userId: number; points: number; amountNaira?: number; amount?: number },
  ) {
    return this.notificationService.testQuizReward(
      Number(body.userId),
      Number(body.points ?? 0),
      Number(body.amountNaira ?? body.amount ?? 0),
    );
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/live-quiz-reward')
  @HttpCode(HttpStatus.OK)
  triggerLiveQuizReward(
    @Body() body: { userId: number; amountNaira: number; createdAt?: string },
  ) {
    const createdAtDate = body.createdAt ? new Date(body.createdAt) : undefined;
    return this.notificationService.liveQuizReward(
      Number(body.userId),
      Number(body.amountNaira),
      createdAtDate,
    );
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/live-quiz-consolation')
  @HttpCode(HttpStatus.OK)
  triggerLiveQuizConsolation(
    @Body()
    body: {
      userId: number;
      points?: number;
      quizName?: string;
      createdAt?: string;
    },
  ) {
    const createdAtDate = body.createdAt ? new Date(body.createdAt) : undefined;
    return this.notificationService.liveQuizConsolationReward(
      Number(body.userId),
      body.points,
      body.quizName,
      createdAtDate,
    );
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/live-quiz-jackpot')
  @HttpCode(HttpStatus.OK)
  triggerLiveQuizJackpot(
    @Body() body: { userId: number; amountNaira: number; createdAt?: string },
  ) {
    const createdAtDate = body.createdAt ? new Date(body.createdAt) : undefined;
    return this.notificationService.liveQuizJackpot(
      Number(body.userId),
      Number(body.amountNaira),
      createdAtDate,
    );
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/tests-remaining-low')
  @HttpCode(HttpStatus.OK)
  triggerTestsLow(@Body() body: { userId: number; remaining: number }) {
    return this.notificationService.testsRemainingLow(body.userId, body.remaining);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/new-quiz-available')
  @HttpCode(HttpStatus.OK)
  triggerNewQuiz(@Body() body: { userIds: number[]; quizLabel?: string }) {
    return this.notificationService.newQuizAvailable(body.userIds ?? [], body.quizLabel);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/mid-quiz-ad-points')
  @HttpCode(HttpStatus.OK)
  triggerMidQuizAd(@Body() body: { userId: number; points?: number }) {
    return this.notificationService.midQuizAdPoints(body.userId, body.points ?? 200);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/account-banned')
  @HttpCode(HttpStatus.OK)
  triggerAccountBanned(@Body() body: { userId: number; reason?: string }) {
    return this.notificationService.accountBanned(body.userId, body.reason);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/account-unbanned')
  @HttpCode(HttpStatus.OK)
  triggerAccountUnbanned(@Body() body: { userId: number }) {
    return this.notificationService.accountUnbanned(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/plan-upgraded')
  @HttpCode(HttpStatus.OK)
  triggerPlanUpgraded(@Body() body: { userId: number; plan?: string }) {
    return this.notificationService.planUpgraded(body.userId, body.plan);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/password-changed')
  @HttpCode(HttpStatus.OK)
  triggerPasswordChanged(@Body() body: { userId: number }) {
    return this.notificationService.passwordChanged(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/contact-info-updated')
  @HttpCode(HttpStatus.OK)
  triggerContactInfoUpdated(@Body() body: { userId: number; field?: string }) {
    return this.notificationService.contactInfoUpdated(body.userId, body.field);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/kyc-submitted')
  @HttpCode(HttpStatus.OK)
  triggerKycSubmitted(@Body() body: { userId: number }) {
    return this.notificationService.kycSubmitted(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/kyc-approved')
  @HttpCode(HttpStatus.OK)
  triggerKycApproved(@Body() body: { userId: number }) {
    return this.notificationService.kycApproved(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/kyc-rejected')
  @HttpCode(HttpStatus.OK)
  triggerKycRejected(@Body() body: { userId: number }) {
    return this.notificationService.kycRejected(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/kyc-withdrawal-limit-reached')
  @HttpCode(HttpStatus.OK)
  triggerKycWithdrawalLimitReached(@Body() body: { userId: number }) {
    return this.notificationService.kycWithdrawalLimitReached(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-account-created')
  @HttpCode(HttpStatus.OK)
  triggerAdminAccountCreated(@Body() body: { userId: number; adminName: string }) {
    return this.notificationService.adminAccountCreated(body.userId, body.adminName);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-invite-sent')
  @HttpCode(HttpStatus.OK)
  triggerAdminInviteSent(@Body() body: { userId: number; inviterName?: string }) {
    return this.notificationService.adminInviteSent(body.userId, body.inviterName);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-invite-resent')
  @HttpCode(HttpStatus.OK)
  triggerAdminInviteResent(@Body() body: { userId: number }) {
    return this.notificationService.adminInviteResent(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-role-changed')
  @HttpCode(HttpStatus.OK)
  triggerAdminRoleChanged(@Body() body: { userId: number; roleName?: string }) {
    return this.notificationService.adminRoleChanged(body.userId, body.roleName);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-task-assigned')
  @HttpCode(HttpStatus.OK)
  triggerAdminTaskAssigned(@Body() body: { userId: number; assignedBy: string; taskTitle: string }) {
    return this.notificationService.adminTaskAssigned(body.userId, body.assignedBy, body.taskTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-message-received')
  @HttpCode(HttpStatus.OK)
  triggerAdminMessageReceived(@Body() body: { userId: number; senderName: string; message: string }) {
    return this.notificationService.adminMessageReceived(body.userId, body.senderName, body.message);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-login-detected')
  @HttpCode(HttpStatus.OK)
  triggerAdminLoginDetected(@Body() body: { userId: number; location?: string; ip?: string }) {
    return this.notificationService.adminLoginDetected(body.userId, body.location, body.ip);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-password-changed')
  @HttpCode(HttpStatus.OK)
  triggerAdminPasswordChanged(@Body() body: { userId: number }) {
    return this.notificationService.adminPasswordChanged(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/admin-contact-info-updated')
  @HttpCode(HttpStatus.OK)
  triggerAdminContactInfoUpdated(@Body() body: { userId: number; field?: string }) {
    return this.notificationService.adminContactInfoUpdated(body.userId, body.field);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/wallet-credited')
  @HttpCode(HttpStatus.OK)
  triggerWalletCredited(@Body() body: { userId: number; amountNaira?: number }) {
    return this.notificationService.walletCredited(body.userId, body.amountNaira ?? 2);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/withdrawal-requested')
  @HttpCode(HttpStatus.OK)
  triggerWithdrawalRequested(@Body() body: { userId: number; amountNaira?: number }) {
    return this.notificationService.withdrawalRequested(body.userId, body.amountNaira ?? 2);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/withdrawal-completed')
  @HttpCode(HttpStatus.OK)
  triggerWithdrawalCompleted(@Body() body: { userId: number; amountNaira?: number; destination?: string }) {
    return this.notificationService.withdrawalCompleted(body.userId, body.amountNaira ?? 2, body.destination);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/withdrawal-failed')
  @HttpCode(HttpStatus.OK)
  triggerWithdrawalFailed(@Body() body: { userId: number }) {
    return this.notificationService.withdrawalFailed(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/payment-method-added')
  @HttpCode(HttpStatus.OK)
  triggerPaymentMethodAdded(@Body() body: { userId: number; label?: string }) {
    return this.notificationService.paymentMethodAdded(body.userId, body.label);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/payment-method-removed')
  @HttpCode(HttpStatus.OK)
  triggerPaymentMethodRemoved(@Body() body: { userId: number; label?: string }) {
    return this.notificationService.paymentMethodRemoved(body.userId, body.label);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/default-payment-method-changed')
  @HttpCode(HttpStatus.OK)
  triggerDefaultPaymentMethod(@Body() body: { userId: number; label?: string }) {
    return this.notificationService.defaultPaymentMethodChanged(body.userId, body.label);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/minimum-withdrawal-not-met')
  @HttpCode(HttpStatus.OK)
  triggerMinimumWithdrawal(@Body() body: { userId: number; minimum?: number }) {
    return this.notificationService.minimumWithdrawalNotMet(body.userId, body.minimum ?? 1000);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/savings-checking-transfer')
  @HttpCode(HttpStatus.OK)
  triggerSavingsCheckingTransfer(@Body() body: { userId: number; amountNaira: number; from: string; to: string }) {
    return this.notificationService.savingsCheckingTransfer(body.userId, body.amountNaira, body.from, body.to);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-comment-liked')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentLiked(@Body() body: { userId: number; likerName: string; commentPreview: string }) {
    return this.notificationService.streamCommentLiked(body.userId, body.likerName, body.commentPreview);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-comment-liked-moderator')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentLikedModerator(@Body() body: { userIds: number[]; likerName: string; streamTitle: string }) {
    return this.notificationService.streamCommentLikedModerator(
      body.userIds ?? [],
      body.likerName,
      body.streamTitle,
    );
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-comment-reported')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentReported(@Body() body: { userIds: number[]; streamTitle: string }) {
    return this.notificationService.streamCommentReported(body.userIds ?? [], body.streamTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-admin-reply')
  @HttpCode(HttpStatus.OK)
  triggerStreamAdminReply(@Body() body: { userIds: number[]; adminName: string; streamTitle: string }) {
    return this.notificationService.streamAdminReply(body.userIds ?? [], body.adminName, body.streamTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-going-live')
  @HttpCode(HttpStatus.OK)
  triggerStreamGoingLive(@Body() body: { userIds: number[]; streamTitle: string }) {
    return this.notificationService.streamGoingLive(body.userIds ?? [], body.streamTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-ending-soon')
  @HttpCode(HttpStatus.OK)
  triggerStreamEndingSoon(@Body() body: { userIds: number[]; streamTitle: string; minutes?: number }) {
    return this.notificationService.streamEndingSoon(body.userIds ?? [], body.streamTitle, body.minutes ?? 10);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-winner-tagged')
  @HttpCode(HttpStatus.OK)
  triggerStreamWinnerTagged(@Body() body: { userId: number }) {
    return this.notificationService.streamWinnerTagged(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-comment-removed')
  @HttpCode(HttpStatus.OK)
  triggerStreamCommentRemoved(@Body() body: { userId: number }) {
    return this.notificationService.streamCommentRemoved(body.userId);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-chat-banned')
  @HttpCode(HttpStatus.OK)
  triggerStreamChatBanned(@Body() body: { userId: number; streamTitle: string }) {
    return this.notificationService.streamChatBanned(body.userId, body.streamTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-chat-lock-toggle')
  @HttpCode(HttpStatus.OK)
  triggerStreamChatLockToggle(@Body() body: { userIds: number[]; streamTitle: string; locked: boolean }) {
    return this.notificationService.streamChatLockToggle(body.userIds ?? [], body.streamTitle, body.locked);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('/triggers/stream-manual-credit')
  @HttpCode(HttpStatus.OK)
  triggerStreamManualCredit(@Body() body: { userId: number; amountNaira?: number; streamTitle?: string }) {
    return this.notificationService.streamManualCredit(body.userId, body.amountNaira ?? 2, body.streamTitle);
  }
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
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