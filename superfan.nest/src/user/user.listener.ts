// question-added.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserService } from './user.service';
import { PushNotificationService } from '../notification/push-notification.service';


@Injectable()
export class UserListener {
  constructor(
    private readonly userService: UserService,
    private readonly notificationService: PushNotificationService,
  ) {}

  @OnEvent('user.logged_in')
async handleUserLogin(payload: { userId: number }) {
  const { streak, milestoneReached } = await this.userService.updateDailyStreak(
    payload.userId,
  );


  if (milestoneReached) {
    await this.notificationService.sendPushNotificationToUsers(
      [payload.userId],
      'Daily streak: 7 days! 🔥',
      'Take a test to keep it going',
    );
  }
}

}