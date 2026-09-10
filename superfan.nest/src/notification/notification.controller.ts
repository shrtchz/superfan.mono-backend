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