// question-added.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PushNotificationService } from '../../notification/push-notification.service';
import { UserService } from '../../user/user.service';
import { QuestionAddedEvent } from '../quiz.events';

@Injectable()
export class QuestionAddedListener {
  constructor(
    private readonly userService: UserService,
    private readonly notificationService: PushNotificationService,
  ) {}

  @OnEvent('question.added', { async: true })
  async handleQuestionAdded(event: QuestionAddedEvent) {
  // Guard: don't process if the question event has null fields
  console.log(event, 'Received QuestionAddedEvent');
  if (!event.testQuiz || !event.subject || !event.testLevel) return;

  const matchingUsers = await this.userService.findUsersWithPreferences({
    languagePreference: event.testQuiz,
    subjectPreference: event.subject,
    testLevel: event.testLevel,
  });

  if (!matchingUsers.length) return;

  // Filter out users who haven't completed onboarding (null preferences)
  const eligibleUsers = matchingUsers.filter(
    (user) =>
      user.languagePreference !== null &&
      user.subjectPreference !== null &&
      user.testLevel !== null,
  );


  if (!eligibleUsers.length) return;

  const userIds = eligibleUsers.map((user) => user.id);

  const title = `New ${event.subject} question available!🔥`;
  const message = `Earn up to ₦3,000 today`;

  await this.notificationService.sendPushNotificationToUsers(
    userIds,
    title,
    message,
  );
}
}