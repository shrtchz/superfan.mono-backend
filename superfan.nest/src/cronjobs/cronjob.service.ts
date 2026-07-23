import { Injectable, Logger, NotFoundException, Inject, forwardRef } from "@nestjs/common";
import { Cron, CronExpression, SchedulerRegistry } from "@nestjs/schedule";
import { randomBytes } from "crypto";
import { subMinutes } from 'date-fns';
import { NotificationService } from "../notification/notification.service";
import { BitnobService } from "../payment/bitnob.service";
import { MonnifyService } from "../payment/monnify.service";
import { prisma } from "../prisma/prisma";
import { QuizService } from "../quiz/quiz.service";
import { UserService } from "../user/user.service";

@Injectable()
export class CronJobService {
    private readonly logger = new Logger(CronJobService.name);

    constructor(
        private readonly notificationService: NotificationService,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
        private readonly monnifyService: MonnifyService,
        private readonly quizService: QuizService,
        private readonly bitnobService: BitnobService,
        private readonly schedulerRegistry: SchedulerRegistry
    ) {}

    // @Cron(CronExpression.EVERY_10_SECONDS)
    // async handleSubScriptionDebit() {
    //     console.log('Running subscription debit job at', new Date().toISOString());
    // }

    @Cron(CronExpression.EVERY_DAY_AT_11AM)
    async sendDailyQuizNotification() {
        this.logger.log('Sending daily quiz notifications...');

        const result = await this.userService.findAllUsers();
        const users = result.data;
        const clientUsers = users.filter((user) => user.roleName === 'client');

        await Promise.all(
            clientUsers.map((user) =>
                this.notificationService.createNotification(
                    user.id,
                    "Don't miss today's quiz 🍊",
                    'Complete at least one test to earn rewards',
                ),
            ),
        );

        this.logger.log(`Daily quiz notifications sent to ${clientUsers.length} users.`);
    }

@Cron(CronExpression.EVERY_DAY_AT_11AM)
async handleDeleteInactiveSubscription() {
  console.log('Running delete inactive subscription job at', new Date().toISOString());
  const fiveMinutesAgo = subMinutes(new Date(), 5);

  await prisma.subscription.deleteMany({
    where: {
      status: {
        in: ['PENDING', 'PENDING_AUTHORIZATION'],
      },
      startDate: {
        lte: fiveMinutesAgo,
      },
    },
  });
}

    @Cron(CronExpression.EVERY_10_HOURS)
  async handleMonthlyDebit() {
    const today = new Date();

    // Find subscriptions due today
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
      },
    });

    for (const sub of subscriptions) {
      const lastDebit = await prisma.subscriptionDebit.findFirst({
        where: { subscriptionId: sub.id },
        orderBy: { createdAt: 'desc' },
      });

      const shouldDebit =
        !lastDebit ||
        this.isDueForDebit(lastDebit.createdAt, today);

      if (!shouldDebit) continue;

      const paymentReference = `SUB_${Date.now()}${Math.floor(Math.random() * 1000)}`;

      // check if paymentReference alreeady existed
      const payment_ref_exists = await prisma.subscriptionDebit.findUnique({
        where: {paymentReference}
      })

      if(payment_ref_exists) {
        throw new NotFoundException('payment reference already exists')
      }

      // Save pending debit
      await prisma.subscriptionDebit.create({
        data: {
          subscriptionId: sub.id,
          amount: sub.debitAmount,
          debitDate: today,
          paymentReference,
          status: 'PENDING',
        },
      });

      let userDetails = await prisma.user.findFirst({
        where: { id: sub.userId },
      });

      if (!userDetails) {
        this.logger.warn(`User not found for subscription ${sub.id}`);
        continue;
      }

      // Call Monnify debit API
      await this.monnifyService.debitMandate({
        paymentReference,
        mandateCode: sub.mandateCode,
        debitAmount: sub.debitAmount,
        narration: 'Superfan Subscription monthly debit',
        customerEmail: userDetails.email,
      });
    }
  }

// @Cron(CronExpression.EVERY_5_MINUTES)
async handleExpiredQuizzes() {
  this.logger.log('Checking for expired ongoing quizzes...');

  const now = new Date();

  const deletedQuizzes = await prisma.ongoingQuiz.deleteMany({
    where: {
      isCompleted: false,
      expiresAt: { lte: now },
    },
  });

  if (deletedQuizzes.count > 0) {
    this.logger.log(`Deleted ${deletedQuizzes.count} expired quizzes.`);
  }
}

@Cron(CronExpression.EVERY_10_MINUTES)
  async handleAutoSubmitQuiz() {
    try {
      const now = new Date();

      // 1. Find expired quizzes
      const expiredQuizzes = await prisma.ongoingQuiz.findMany({
  where: {
    isCompleted: false,
    OR: [
      // Normal quizzes
      {
        isRandom: false,
        expiresAt: {
          lte: now,
        },
      },

      // Random quizzes
      {
        isRandom: true,
        quizAttempt: {
          is: {
            isStarted: true,
            expiresAt: {
              lte: now,
            },
          },
        },
      },
    ],
  },
  include: {
    quizAttempt: true,
  },
});

      if (!expiredQuizzes.length) {
        return;
      }

      this.logger.log(
        `Found ${expiredQuizzes.length} expired quizzes`,
      );

      for (const quiz of expiredQuizzes) {
        try {
          // 2. Parse answers
          const answers =
            typeof quiz.answers === 'string'
              ? JSON.parse(quiz.answers)
              : quiz.answers;

          // Skip if no answers
          if (!Array.isArray(answers) || answers.length === 0) {
            this.logger.warn(
              `Skipping quiz ${quiz.id} because answers are empty`,
            );

            // Mark as completed to avoid repeated cron checks
            await prisma.ongoingQuiz.update({
              where: { id: quiz.id },
              data: {
                isCompleted: true,
                completedAt: new Date(),
              },
            });

            continue;
          }

          // 3. Build responses payload
          const responses = answers.map((answer: any) => ({
            quizId: answer.quizId,
            selectedAnswer: answer.selectedAnswer,
          }));

          // 4. Calculate quiz time used
          const totalTime = quiz.totalTime || 0;
          const timeRemaining = quiz.timeRemaining || 0;

          const timeUsed = Math.max(
            totalTime - timeRemaining,
            0,
          );

          // 5. Submit quiz automatically
          await this.quizService.submitQuiz(
            String(quiz.userId),
            quiz.testQuiz,
            String(timeUsed),
            0, // ad bonuses
            responses,
          );

          this.logger.log(
            `Auto submitted quiz ${quiz.id} for user ${quiz.userId}`,
          );
        } catch (error) {
          if (error?.message === 'Quiz already submitted') {
            this.logger.warn(
              `Skipping quiz ${quiz.id} because it was already submitted`,
            );
            continue;
          }

          this.logger.error(
            `Failed to auto submit quiz ${quiz.id}`,
            error?.stack,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Quiz auto submit cron failed',
        error?.stack,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleAutoCloseLiveQuizSessions() {
    try {
      const closed = await this.quizService.closeExpiredLiveQuizSessions();
      if (closed > 0) {
        this.logger.log(`Auto-closed ${closed} expired live quiz session(s).`);
      }
    } catch (error) {
      this.logger.error(
        'Live quiz auto-close cron failed',
        error?.stack,
      );
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
async handleUpdateCryptoPrices() {
  try {
    this.logger.log('Updating cryptocurrency prices...');
    const [usdtQuote, usdcQuote] = await Promise.all([
  this.bitnobService.createPayoutQuote({
    amount: '10',
    country: 'NG',
    from_asset: 'USDT',
    reference: `PAYOUT-USDT-${randomBytes(8).toString('hex')}`,
    source: 'offchain',
    to_currency: 'NGN',
  }),
  this.bitnobService.createPayoutQuote({
    amount: '10',
    country: 'NG',
    from_asset: 'USDC',
    reference: `PAYOUT-USDC-${randomBytes(8).toString('hex')}`,
    source: 'offchain',
    to_currency: 'NGN',
  }),
]);

// this.logger.log({ usdtQuote, usdcQuote }, 'Cryptocurrency prices updated successfully')
  } catch (error) {
    this.logger.error(
      'Failed to update cryptocurrency prices',
      error?.stack,
    );
  }
}

  
getAllCronJobs() {
  const jobs = this.schedulerRegistry.getCronJobs();
  jobs.forEach((value, key, map) => {
    let next;
    try {
      next = value.nextDate().toJSDate();
    } catch (e) {
      next = 'error: next fire date is in the past!';
    }
    this.logger.log(`job: ${key} -> next: ${next}`);
  });
}



// check if ongoingQuiz isExpired and iscompleted is false, 

  private isNextOneMinute(lastDate: Date, current: Date): boolean {
  const diffInMs = current.getTime() - lastDate.getTime();
  return diffInMs >= 60 * 1000; // 1 minute
}

private isDueForDebit(lastDate: Date, current: Date): boolean {
  const msIn30Days = 30 * 24 * 60 * 60 * 1000;
  return (current.getTime() - lastDate.getTime()) >= msIn30Days;
}
}

