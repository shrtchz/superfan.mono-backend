import { HttpService } from '@nestjs/axios';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, InternalServerErrorException, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { JsonArray } from '@prisma/client/runtime/client';
import { firstValueFrom } from 'rxjs';
import { EarningStatus } from '../common/enums/task.enum';
import { QuizQuestion, UserAnswer } from '../common/utils/types';
import { getAccuracyBonus, getSpeedBonus, getStreakBonus } from '../common/utils/utils';
import { PaymentService } from '../payment/payment.service';
import { prisma } from '../prisma/prisma';
import { UserService } from '../user/user.service';
import { WalletService } from '../wallet/wallet.service';

import {
  CreateLiveQuizDto,
  CreateQuizCategoryDto,
  CreateQuizDto,
  GetQuizWithPreferencesDto,
  RecordAnswerDto,
  startRandomQuiz,
  UpdateLiveAnswerDto,
} from './quiz.dto';
import { QuestionAddedEvent } from './quiz.events';

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);
  private baseUrl = `${process.env.GO_ENDPOINT}/v1/quiz`;
  // private trackerBaseUrl = `${process.env.GO_ENDPOINT}/v1`;

  constructor(
    private readonly httpService: HttpService,
    private readonly walletService: WalletService,
    private readonly paymentService: PaymentService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
  ) {}

  private getLagosNow(): Date {
    return new Date(
      new Date().toLocaleString('en-US', {
        timeZone: 'Africa/Lagos',
      }),
    );
  }

  private toDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private rethrowGoProxyError(error: any, fallback: string): never {
    const status = error?.response?.status;
    const message =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      fallback;

    if (status === HttpStatus.FORBIDDEN) {
      throw new ForbiddenException(message);
    }
    if (status === HttpStatus.NOT_FOUND) {
      throw new NotFoundException(message);
    }
    if (status === HttpStatus.BAD_REQUEST) {
      throw new BadRequestException(message);
    }

    throw new HttpException(message, status || HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private extractSelectedAnswer(
    answers: any[],
    quizId: string,
  ): { selectedAnswer: string; submittedAt: Date } | null {
    if (!Array.isArray(answers)) return null;
    const row = answers.find((item) => String(item?.quizId) === String(quizId));
    if (!row?.selectedAnswer) return null;

    const submittedAt =
      this.toDate(row.submittedAt) ||
      this.toDate(row.answeredAt) ||
      this.getLagosNow();

    return {
      selectedAnswer: String(row.selectedAnswer),
      submittedAt,
    };
  }

  private parseLiveQuizPayload(response: any) {
    const payload = response?.data?.data ?? response?.data ?? response ?? {};
    const quiz = Array.isArray(payload) ? payload[0] ?? {} : payload;

    const quizId = String(quiz?.id ?? quiz?.quizId ?? '').trim();
    const answer = String(quiz?.answer ?? '').trim();
    const quizScheduleDate = this.toDate(quiz?.quizScheduleDate);
    const quizFinishDate = this.toDate(quiz?.quizFinishDate);
    const recipients = Number(quiz?.recipients ?? 0) || 0;
    const totalPrize = Number(quiz?.totalPrize ?? 0) || 0;
    const unitPrize =
      Number(quiz?.unitPrize ?? 0) ||
      (recipients > 0 ? totalPrize / recipients : 0);

    return {
      quizId,
      answer,
      quizScheduleDate,
      quizFinishDate,
      recipients,
      totalPrize,
      unitPrize,
    };
  }

  private async getLiveQuizMeta(quizId: string) {
    const response = await this.getLiveQuiz(quizId);
    const meta = this.parseLiveQuizPayload(response);
    if (!meta.quizId) {
      throw new NotFoundException('Live quiz not found');
    }
    return meta;
  }

  private async authenticateFinishedSubmissionsForQuiz(
    quizId: string,
  ): Promise<void> {
    const meta = await this.getLiveQuizMeta(quizId);
    const now = this.getLagosNow();
    if (!meta.quizFinishDate || now < meta.quizFinishDate) {
      return;
    }

    const sessions = await prisma.ongoingLiveQuiz.findMany({
      where: {
        quizIds: { has: quizId },
      },
    });

    const participants: Array<{
      userId: string;
      ongoingLiveQuizId: number;
      submittedAt: Date;
      isCorrect: boolean;
    }> = [];

    for (const session of sessions) {
      const answers = (session.answers as any[]) || [];
      const selection = this.extractSelectedAnswer(answers, quizId);
      if (!selection) continue;

      const isCorrect =
        this.normalizeText(selection.selectedAnswer) ===
        this.normalizeText(meta.answer);

      participants.push({
        userId: session.userId,
        ongoingLiveQuizId: session.id,
        submittedAt: selection.submittedAt,
        isCorrect,
      });
    }

    const dedupedParticipants = Array.from(
      participants.reduce((acc, current) => {
        const existing = acc.get(current.userId);
        if (!existing || current.submittedAt < existing.submittedAt) {
          acc.set(current.userId, current);
        }
        return acc;
      }, new Map<string, (typeof participants)[number]>() ).values(),
    );

    const correctParticipants = dedupedParticipants
      .filter((item) => item.isCorrect)
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());

    const maxWinners =
      meta.recipients > 0 ? meta.recipients : correctParticipants.length;
    const winnerKeys = new Set(
      correctParticipants
        .slice(0, Math.max(maxWinners, 0))
        .map((item) => `${item.userId}:${item.ongoingLiveQuizId}`),
    );

    await Promise.all(
      dedupedParticipants.map((participant) => {
        const key = `${participant.userId}:${participant.ongoingLiveQuizId}`;
        const isWinner = winnerKeys.has(key);

        return prisma.liveQuizAttempt.upsert({
          where: {
            userId_quizId: {
              userId: participant.userId,
              quizId,
            },
          },
          update: {
            ongoingLiveQuizId: participant.ongoingLiveQuizId,
            totalPrize: meta.totalPrize || null,
            recipients: meta.recipients || null,
            unitPrize: meta.unitPrize || null,
            earning: isWinner ? Math.round(meta.unitPrize || 0) : 0,
            isWinner,
            isCompleted: true,
            startedAt: participant.submittedAt,
            completedAt: now,
          },
          create: {
            userId: participant.userId,
            quizId,
            ongoingLiveQuizId: participant.ongoingLiveQuizId,
            totalPrize: meta.totalPrize || null,
            recipients: meta.recipients || null,
            unitPrize: meta.unitPrize || null,
            earning: isWinner ? Math.round(meta.unitPrize || 0) : 0,
            isWinner,
            isCompleted: true,
            startedAt: participant.submittedAt,
            completedAt: now,
          },
        });
      }),
    );
  }



  async createQuiz(quizData: CreateQuizDto) {
    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrl}/create`, quizData),
    );

    let resp = response.data

        this.eventEmitter.emit(
      'question.added',
      new QuestionAddedEvent(
        quizData.subject,
        quizData.testQuiz,
        quizData.testLevel
      ),
    );
    return resp;
  }

  async createLiveQuiz(liveQuizData: CreateLiveQuizDto) {
    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrl}/live`,
        liveQuizData,
),
    );
    return response.data;
  }


async submitQuiz(
  userId: string,
  rewardType: string,
  quizTime: string,
  ad_bonuses: number,
  responses: { quizId: string; selectedAnswer: string }[],
) {
  // 1. Validate user
  const check_user_id = await prisma.user.findUnique({
    where: { id: Number(userId) },
  });

  if (!check_user_id) {
    throw new InternalServerErrorException('Invalid user ID');
  }

  // check if quiz is already submitted

  const checkQuiz = await prisma.ongoingQuiz.findFirst({
    where: {
      userId: Number(userId),
      isCompleted: false,
    },
  });

  if (!checkQuiz) {
    throw new InternalServerErrorException('Quiz already submitted');
  }

  // 2. Submit quiz to external service
  const response = await firstValueFrom(
    this.httpService.post(`${this.baseUrl}/submit`, {
      userId,
      responses,
      rewardType,
      quizTime,
    }),
  );

  const submission = response.data?.data?.submission;
  const { score, subject, totalEarning, responses: submissionResponses, submittedAt } = submission;

  // 3. Get test level from first quiz
  let testLevel = '';
  if (Array.isArray(submissionResponses) && submissionResponses.length > 0) {
    const quizMeta = await this.getQuiz(submissionResponses[0].quizId);
    const quizMetaData = quizMeta?.data?.data ?? quizMeta?.data ?? quizMeta ?? {};
    testLevel = quizMetaData?.testLevel ?? '';
  }

  // 4. Calculate bonuses
  const correctAnswers = (submissionResponses || []).filter(
    (r: any) => r.selectedAnswer === r.correctAnswer,
  ).length;

  // fetch totalQuestions from this.
  const get_ongoing_quiz = await this.getOngoingQuiz(Number(userId));
  const ongoingQuestions = (get_ongoing_quiz?.questions as JsonArray) || [];
  const totalQuestions = ongoingQuestions.length || submissionResponses?.length || 0;
  const baseScore = Number(totalEarning ?? 0);
  const speed_bonus = getSpeedBonus(quizTime);
  const accuracy_bonus = getAccuracyBonus(correctAnswers, totalQuestions);
  const streakData = await this.userService.updateDailyStreak(Number(userId));
  const { streakBonus, dailyStreak } = getStreakBonus({
    dailyStreak: streakData.streak,
  });

  // 5. Calculate total points
  //    Base score + percentage bonuses + flat streak/ad bonuses.
  const accuracyGain = Math.round(baseScore * (accuracy_bonus / 100));
  const speedGain = Math.round(baseScore * (speed_bonus / 100));
  const adBonusPoints = Number(ad_bonuses ?? 0);

  const totalPoints = baseScore + accuracyGain + speedGain + adBonusPoints + streakBonus;
  const amountInNaira = totalPoints / 1000;

  // 6. Save leaderboard rows (only earning > 0)
  const leaderboardRows = (submissionResponses || [])
    .map((item: any) => ({
      userId: String(userId),
      quizId: item.quizId,
      subject: item.subject ?? subject,
      testLevel,
      score: Number(score),
      accuracyBonus: `${accuracy_bonus}%`,
      selectedAnswer: item.selectedAnswer ?? null,
      correctAnswer: item.correctAnswer ?? null,
      earning: Number(item.earning ?? 0),
      quizTime: String(quizTime),
      submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
    }))
    .filter((row) => row.earning > 0);

  if (leaderboardRows.length) {
    await prisma.quizLeaderboard.createMany({ data: leaderboardRows });
  }

  // 7. Mark quiz as completed

        const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  )
  // let updateResult = await prisma.ongoingQuiz.update({
  //   where: { id: get_ongoing_quiz?.id },
  //   data: {
  //     isCompleted: true,
  //     completedAt: now,
  //     totalEarning: amountInNaira,
  //     quizTime: String(quizTime),
  //     baseScore,
  //     accuracyBonus: accuracyGain,
  //     speedBonus: speedGain,
  //     streakMultiplier: streakBonus,
  //     adBonuses: adBonusPoints,
  //     earnedAmount: amountInNaira,
  //   },
  // });

  let updateResult = await prisma.ongoingQuiz.update({
  where: { id: get_ongoing_quiz?.id },
  data: {
    isCompleted: true,
    completedAt: now,
    totalEarning: amountInNaira,
    quizTime: String(quizTime),
    baseScore,
    accuracyBonus: accuracyGain,
    speedBonus: speedGain,
    streakMultiplier: streakBonus,
    adBonuses: adBonusPoints,
    earnedAmount: amountInNaira,
    ...(checkQuiz?.isRandom && {
      startedAt: now,
      expiresAt: now,
    }),
  },
});

  let get_currencies = await prisma.ongoingQuiz.findUnique({
    where: { id: get_ongoing_quiz?.id },
    select: {
      totalEarninginUSDC: true,
      totalEarninginUSDT: true,
    }
  });

  // if (checkQuiz?.isRandom) {
  //   await prisma.quizAttempt.update({
  //     where: { quizId: checkQuiz?.id },
  //     data: {
  //       isCompleted: true,
  //       completedAt: now,
  //     }
  //   });
  // }

  if (checkQuiz?.isRandom) {
  await prisma.quizAttempt.update({
    where: { quizId: checkQuiz?.id },
    data: {
      isCompleted: true,
      completedAt: now,
      startedAt: now,
      expiresAt: now,
    },
  });
}

  // 8. Create wallet reward
  await this.walletService.createQuizReward(
    Number(userId),
    amountInNaira,
    'NGN',
    subject,
    EarningStatus.PAID_OUT,
    score,
  );

  // 9. Return enriched response
  return {
    ...response.data,
    totalQuestions: totalQuestions,
    streak: {
      current: dailyStreak,
      flameIcon: '🔥',
      bonusPoints: streakBonus,
      message:
        dailyStreak === 3 || dailyStreak === 7 || dailyStreak === 14 || dailyStreak === 30
          ? `🔥 ${dailyStreak}-day streak! Bonus applied.`
          : 'Streak saved! You completed a test just in time',
    },
    earnings: {
      totalPoints,
      amountInNaira,
      amountinUsdc: get_currencies.totalEarninginUSDC,
      amountInUsdt: get_currencies.totalEarninginUSDT,
      breakdown: {
        base: baseScore,
        accuracyGain,
        speedGain,
        streakGain: streakBonus,
        ad_bonuses: adBonusPoints,
        accuracy_bonus,
        speed_bonus,
        streak_bonus: streakBonus,
      },
    },
  };
}

async getQuizResult(userId: number) {
  const quiz = await prisma.ongoingQuiz.findFirst({
    where: {
      userId: Number(userId),
      isCompleted: true,
    },
    orderBy: {
      completedAt: 'desc',
    },
    select: {
      isCompleted: true,
      completedAt: true,
      totalEarning: true,
      baseScore: true,
      accuracyBonus: true,
      speedBonus: true,
      streakMultiplier: true,
      adBonuses: true,
      earnedAmount: true,
    },
  });

  return quiz;
}

async quitQuiz(
  userId: number,
  rewardType: string,
  quizTime: string,
  ad_bonuses: number,
) {
  const ongoingQuiz = await prisma.ongoingQuiz.findFirst({
    where: {
      userId,
      isCompleted: false,
    },
  });

  if (!ongoingQuiz) {
    throw new HttpException(
      'No active quiz session found.',
      HttpStatus.NOT_FOUND,
    );
  }

  const rawAnswers = (ongoingQuiz.answers as any[]) || [];
  const responses = rawAnswers
    .filter((answer) => answer?.quizId && answer?.selectedAnswer != null)
    .map((answer) => ({
      quizId: answer.quizId,
      selectedAnswer: answer.selectedAnswer,
    }));

  const now = new Date();
  let submitResult: any = null;

  if (responses.length > 0) {
    submitResult = await this.submitQuiz(
      String(userId),
      rewardType,
      quizTime,
      ad_bonuses,
      responses,
    );
  } else {
    await prisma.ongoingQuiz.update({
      where: { id: ongoingQuiz.id },
      data: {
        isCompleted: true,
        completedAt: now,
        timeRemaining: 0,
      },
    });
  }

  await prisma.quizAttempt.updateMany({
    where: { quizId: ongoingQuiz.id },
    data: {
      isCompleted: true,
      completedAt: now,
    },
  });

  return {
    success: true,
    message: 'Quiz has been quit successfully.',
    quiz: submitResult?.quiz ?? ongoingQuiz,
    submitted: responses.length > 0,
    submission: submitResult,
  };
}

async getRandomLiveQuiz(
  totalQuestions: number,
  streamId: number,
  userId: number,
) {
  try {
    // Resume existing session only — quiz content is fetched from Go by clients
    const existingQuiz = await prisma.ongoingLiveQuiz.findFirst({
      where: {
        userId: String(userId),
        completed: false,
      },
    });

    if (existingQuiz) {
      const questions = (existingQuiz.questions as any[]) || [];
      const now = this.getLagosNow();
      const allFinished =
        questions.length > 0 &&
        questions.every((question) => {
          const finishAt = this.toDate(
            question?.quizFinishDate ?? question?.quizScheduleDate,
          );
          return finishAt ? now >= finishAt : false;
        });

      if (allFinished) {
        await this.submitLiveQuiz(String(userId));
        const completedQuiz = await prisma.ongoingLiveQuiz.findUnique({
          where: { id: existingQuiz.id },
        });
        if (completedQuiz) {
          return completedQuiz;
        }
      }

      return existingQuiz;
    }

    throw new NotFoundException(
      'No ongoing live quiz session. Fetch questions from Go and POST /quiz/start-live-session.',
    );
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    console.log(error, 'log error');
    throw new NotFoundException(
      error?.response?.message || error?.message || 'Failed to get live quiz',
    );
  }
}

/**
 * Start a live quiz session using questions already fetched from Go.
 * Nest no longer calls Go for quiz content.
 */
async startLiveQuizSession(
  userId: number,
  streamId: number,
  quizzes: any[],
) {
  if (!Array.isArray(quizzes) || !quizzes.length) {
    throw new NotFoundException('No live quizzes provided');
  }

  const existingQuiz = await prisma.ongoingLiveQuiz.findFirst({
    where: {
      userId: String(userId),
      completed: false,
    },
  });
  if (existingQuiz) {
    return existingQuiz;
  }

  const filteredQuizzes = [];

  for (const quiz of quizzes) {
    const quizId = String(quiz.id ?? quiz.quizId ?? '');
    if (!quizId) continue;

    const recipients = Number(quiz.recipients ?? 0);
    const [attemptCount, userAttempt] = await Promise.all([
      prisma.liveQuizAttempt.count({
        where: { quizId },
      }),
      prisma.liveQuizAttempt.findUnique({
        where: {
          userId_quizId: {
            userId: String(userId),
            quizId,
          },
        },
      }),
    ]);

    if (!userAttempt && (!recipients || attemptCount < recipients)) {
      filteredQuizzes.push({ ...quiz, id: quizId });
    }
  }

  if (!filteredQuizzes.length) {
    throw new NotFoundException('No available live quizzes remaining');
  }

  const questions = filteredQuizzes.map((quiz: any) => ({
    quizId: quiz.id,
    question: quiz.question,
    options: quiz.options,
    imageLink: quiz.imageLink,
    totalPrize: quiz.totalPrize,
    jackpotAmount: quiz.jackpotAmount ?? quiz.totalPrize,
    recipients: quiz.recipients,
    unitPrize: quiz.unitPrize,
    quizScheduleDate: quiz.quizScheduleDate,
    quizFinishDate: quiz.quizFinishDate,
    selectedAnswer: null,
    isCorrect: null,
  }));

  const quizIds = filteredQuizzes.map((quiz: any) => quiz.id);

  return prisma.ongoingLiveQuiz.create({
    data: {
      userId: String(userId),
      quizIds,
      questions,
      answers: [],
      completed: false,
      streamId,
    },
  });
}


async fetchOngoingLiveQuiz(userId: number) {
  const ongoingQuiz = await prisma.ongoingLiveQuiz.findFirst({
    where: {
      userId: String(userId),
      completed: false,
    },
  });

  return ongoingQuiz;
}

async getCompletedLiveQuizWithStreamId(streamId: number) {
    const ongoingQuiz = await prisma.ongoingLiveQuiz.findMany({
      where: {streamId, completed: true}
      
    });

  return ongoingQuiz;

}

async fetchAllLiveQuiz() {
  const ongoingQuiz = await prisma.ongoingLiveQuiz.findMany({});

  return ongoingQuiz;
}

// async getLiveQuizLeaderboard() {
//   try {
//     const [leaderboard, ongoingQuizzes] = await Promise.all([
//       prisma.liveQuizLeaderboard.findMany({
//         orderBy: {
//           quizDate: 'desc',
//         },
//       }),
//       prisma.ongoingLiveQuiz.findMany(),
//     ]);

//     const participantMap = new Map<string, Set<string>>();

//     ongoingQuizzes.forEach((quiz) => {
//       quiz.quizIds.forEach((quizId) => {
//         if (!participantMap.has(quizId)) {
//           participantMap.set(quizId, new Set());
//         }

//         participantMap.get(quizId)?.add(quiz.userId);
//       });
//     });

//     const quizMap = new Map<
//       string,
//       {
//         quizDate: Date;
//         quizId: string;
//         question: string;
//         answer: string;
//         participants: number;
//         quizWinners: Set<string>;
//         reward: string | null;
//         status: string;
//       }
//     >();

//     let totalRewardDistributed = 0;

//     leaderboard.forEach((entry) => {
//       if (!quizMap.has(entry.quizId)) {
//         quizMap.set(entry.quizId, {
//           quizDate: entry.quizDate,
//           quizId: entry.quizId,
//           question: entry.question,
//           answer: entry.answer,
//           participants:
//             participantMap.get(entry.quizId)?.size || 0,
//           quizWinners: new Set<string>(),
//           reward: entry.rewardType,
//           status: entry.rewardStatus,
//         });
//       }

//       if (entry.isWinner) {
//         quizMap.get(entry.quizId)?.quizWinners.add(
//           entry.userId,
//         );

//         totalRewardDistributed += Number(
//           entry.unitPrize || 0,
//         );
//       }
//     });

//     const leaderboardData = Array.from(
//       quizMap.values(),
//     ).map((quiz) => ({
//       ...quiz,
//       quizWinners: Array.from(quiz.quizWinners),
//     }));

//     const totalParticipants = Array.from(
//       participantMap.values(),
//     ).reduce((sum, participants) => {
//       return sum + participants.size;
//     }, 0);

//     return {
//       totalQuizzes: quizMap.size,
//       totalParticipants,
//       totalRewardDistributed,
//       leaderboard: leaderboardData,
//     };
//   } catch (error) {
//     throw new HttpException(
//       error?.message || 'Failed to fetch live quiz leaderboard',
//       HttpStatus.INTERNAL_SERVER_ERROR,
//     );
//   }
// }

// async getLiveQuizLeaderboard() {
//   try {
//     const [activeQuizzes, leaderboardEntries, ongoingQuizzes] =
//       await Promise.all([
//         this.getAllLiveQuiz(), // only quizzes whose schedule date has not passed
//         prisma.liveQuizLeaderboard.findMany({
//           orderBy: {
//             createdAt: 'desc',
//           },
//         }),
//         prisma.ongoingLiveQuiz.findMany(),
//       ]);

//     const participantMap = new Map<string, Set<string>>();

//     ongoingQuizzes.forEach((attempt) => {
//       attempt.quizIds.forEach((quizId) => {
//         if (!participantMap.has(quizId)) {
//           participantMap.set(quizId, new Set());
//         }

//         participantMap.get(quizId)?.add(attempt.userId);
//       });
//     });

//     let totalRewardDistributed = 0;

//     const leaderboard = activeQuizzes.map((quiz) => {
//       const quizEntries = leaderboardEntries.filter(
//         (entry) => entry.quizId === quiz.quizId,
//       );

//       const winners = [
//         ...new Set(
//           quizEntries
//             .filter((entry) => entry.isWinner)
//             .map((entry) => entry.userId),
//         ),
//       ];

//       const latestEntry = quizEntries.sort(
//         (a, b) =>
//           new Date(b.createdAt).getTime() -
//           new Date(a.createdAt).getTime(),
//       )[0];

//       totalRewardDistributed += quizEntries.reduce(
//         (sum, entry) =>
//           sum + Number(entry.unitPrize || 0),
//         0,
//       );

//       return {
//         quizDate: quiz.quizScheduleDate,
//         quizId: quiz.quizId,
//         question: quiz.question,
//         answer: quiz.answer,
//         participants:
//           participantMap.get(quiz.quizId)?.size || 0,
//         quizWinners: winners,
//         reward: latestEntry?.rewardType ?? null,
//         status:
//           latestEntry?.rewardStatus === 'PAID'
//             ? 'PAID'
//             : 'NONE',
//       };
//     });

//     const totalParticipants = leaderboard.reduce(
//       (sum, quiz) => sum + quiz.participants,
//       0,
//     );

//     return {
//       totalQuizzes: leaderboard.length,
//       totalParticipants,
//       totalRewardDistributed,
//       leaderboard,
//     };
//   } catch (error) {
//     throw new HttpException(
//       error?.message ||
//         'Failed to fetch live quiz leaderboard',
//       HttpStatus.INTERNAL_SERVER_ERROR,
//     );
//   }
// }

async getLiveQuizLeaderboard() {
  try {
    const [activeQuizzesResponse, leaderboardEntries, ongoingQuizzes] =
      await Promise.all([
        this.getAllLiveQuiz(), // expected: { data: Quiz[] } or Quiz[]
        prisma.liveQuizLeaderboard.findMany({
          orderBy: {
            createdAt: 'desc',
          },
        }),
        prisma.ongoingLiveQuiz.findMany(),
      ]);

    // ✅ FIX: normalize response from getAllLiveQuiz()
    const activeQuizzes = Array.isArray(activeQuizzesResponse)
      ? activeQuizzesResponse
      : activeQuizzesResponse?.data ?? [];

    const participantMap = new Map<string, Set<string>>();

    ongoingQuizzes.forEach((attempt) => {
      attempt.quizIds?.forEach((quizId) => {
        if (!participantMap.has(quizId)) {
          participantMap.set(quizId, new Set());
        }

        participantMap.get(quizId)?.add(attempt.userId);
      });
    });

    let totalRewardDistributed = 0;

    const leaderboard = activeQuizzes.map((quiz) => {
      const quizEntries = leaderboardEntries.filter(
        (entry) => entry.quizId === quiz.id || entry.quizId === quiz.quizId,
      );

      const winners = [
        ...new Set(
          quizEntries
            .filter((entry) => entry.isWinner)
            .map((entry) => entry.userId),
        ),
      ];

      const latestEntry =
        quizEntries.length > 0
          ? [...quizEntries].sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            )[0]
          : null;

      totalRewardDistributed += quizEntries.reduce(
        (sum, entry) => sum + Number(entry.unitPrize || 0),
        0,
      );

      return {
        quizDate: quiz.quizScheduleDate,
        quizId: quiz.id || quiz.quizId,
        question: quiz.question,
        answer: quiz.answer ?? null,

        participants:
          participantMap.get(quiz.id || quiz.quizId)?.size || 0,

        quizWinners: winners,

        reward: latestEntry?.rewardType ?? null,

        status: latestEntry?.rewardStatus ?? 'NONE',
      };
    });

    const totalParticipants = leaderboard.reduce(
      (sum, quiz) => sum + (quiz.participants || 0),
      0,
    );

    return {
      totalQuizzes: leaderboard.length,
      totalParticipants,
      totalRewardDistributed,
      leaderboard,
    };
  } catch (error) {
    throw new HttpException(
      error?.message ||
        'Failed to fetch live quiz leaderboard',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}


async submitLiveQuiz(userId: string) {
  const ongoingQuiz = await prisma.ongoingLiveQuiz.findFirst({
    where: {
      userId,
      completed: false,
    },
  });

  if (!ongoingQuiz) {
    throw new NotFoundException('No active live quiz found');
  }

  const questions: any[] = (ongoingQuiz.questions as any[]) || [];
  const answers: any[] = (ongoingQuiz.answers as any[]) || [];
  const now = this.getLagosNow();

  const finishChecks = await Promise.all(
    questions.map(async (question) => {
      const quizId = String(question?.quizId ?? '');
      if (!quizId) return { quizId, finished: false };
      const meta = await this.getLiveQuizMeta(quizId);
      return {
        quizId,
        finished: Boolean(meta.quizFinishDate && now >= meta.quizFinishDate),
      };
    }),
  );

  if (finishChecks.some((row) => !row.finished)) {
    throw new BadRequestException(
      'Live quiz authentication is only available after finish time',
    );
  }

  // Authenticate globally per quiz using stored submission timestamps.
  for (const question of questions) {
    const quizId = String(question?.quizId ?? '');
    if (!quizId) continue;
    await this.authenticateFinishedSubmissionsForQuiz(quizId);
  }

  const attempts = await prisma.liveQuizAttempt.findMany({
    where: {
      userId,
      quizId: { in: questions.map((q) => String(q?.quizId ?? '')).filter(Boolean) },
      isCompleted: true,
    },
  });

  let totalCorrect = 0;
  let totalEarning = 0;
  const attemptsByQuizId = new Map(attempts.map((item) => [item.quizId, item]));

  const gradedQuestions = await Promise.all(
    questions.map(async (question) => {
      const quizId = String(question?.quizId ?? '');
      if (!quizId) return { ...question, isCorrect: false };
      const attempt = attemptsByQuizId.get(quizId);
      const selection = this.extractSelectedAnswer(answers, quizId);
      const meta = await this.getLiveQuizMeta(quizId);
      const isCorrect =
        Boolean(selection) &&
        this.normalizeText(selection?.selectedAnswer) === this.normalizeText(meta.answer);

      if (isCorrect) totalCorrect += 1;
      totalEarning += Number(attempt?.earning ?? 0);

      return {
        ...question,
        isCorrect,
        selectedAnswer: selection?.selectedAnswer ?? null,
        correctAnswer: meta.answer,
      };
    }),
  );

  const updatedQuiz = await prisma.ongoingLiveQuiz.update({
    where: { id: ongoingQuiz.id },
    data: {
      completed: true,
      questions: gradedQuestions,
      totalEarning: Math.round(totalEarning),
    },
  });

  const isWinner = attempts.some((attempt) => attempt.isWinner);
  const rewardStatus = totalEarning > 0 ? 'paid' : 'none';

  await prisma.liveQuizLeaderboard.deleteMany({
    where: {
      userId,
      quizId: { in: gradedQuestions.map((q) => String(q?.quizId ?? '')).filter(Boolean) },
    },
  });

  await prisma.liveQuizLeaderboard.createMany({
    data: gradedQuestions
      .map((question) => {
        const quizId = String(question?.quizId ?? '');
        if (!quizId) return null;
        const attempt = attemptsByQuizId.get(quizId);
        return {
          userId,
          quizId,
          question: String(question?.question ?? ''),
          answer: String(question?.correctAnswer ?? ''),
          isWinner: Boolean(attempt?.isWinner),
          participants: Number(question?.recipients ?? 0) || 0,
          unitPrize: Number(question?.unitPrize ?? 0) || 0,
          rewardStatus: attempt?.isWinner ? rewardStatus : 'none',
          rewardType: 'CASH',
          quizDate: this.toDate(question?.quizScheduleDate) || now,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row)),
  });

  if (totalEarning > 0) {
    await this.walletService.createLiveQuizReward(
      Number(userId),
      Math.round(totalEarning),
      EarningStatus.PAID_OUT,
    );
  }

  return {
    totalQuestions: gradedQuestions.length,
    totalCorrect,
    totalWrong: gradedQuestions.length - totalCorrect,
    score: totalCorrect,
    totalEarning: Math.round(totalEarning),
    isWinner,
    quiz: updatedQuiz,
  };
}

async updateLiveQuizAnswer(dto: UpdateLiveAnswerDto, authenticatedUserId?: number) {
  const resolvedUserId = String(authenticatedUserId ?? dto.userId ?? '');
  if (!resolvedUserId) {
    throw new BadRequestException('User identity is required');
  }

  const ongoingQuiz =
    await prisma.ongoingLiveQuiz.findFirst({
      where: {
        userId: resolvedUserId,
        completed: false,
        quizIds: {
          has: dto.quizId,
        },
      },
    });

  if (!ongoingQuiz) {
    throw new NotFoundException(
      'Active live quiz not found',
    );
  }

  const questions: any[] =
    (ongoingQuiz.questions as any[]) || [];

  const answers: any[] =
    (ongoingQuiz.answers as any[]) || [];

  const questionIndex = questions.findIndex(
    (q) => q.quizId === dto.quizId,
  );

  if (questionIndex === -1) {
    throw new NotFoundException(
      'Quiz question not found',
    );
  }

  const now = this.getLagosNow();
  const meta = await this.getLiveQuizMeta(dto.quizId);

  if (meta.quizScheduleDate && now < meta.quizScheduleDate) {
    throw new BadRequestException('Submission window is not open yet');
  }

  if (meta.quizFinishDate && now >= meta.quizFinishDate) {
    // Authenticate all pending submissions for this quiz once finish time is reached.
    await this.authenticateFinishedSubmissionsForQuiz(dto.quizId);
    throw new ForbiddenException(
      'Submission window has closed for this live quiz',
    );
  }

  // update question snapshot
  questions[questionIndex] = {
    ...questions[questionIndex],
    selectedAnswer: dto.selectedAnswer,
  };

  // update answers array
  const answerIndex = answers.findIndex(
    (a) => a.quizId === dto.quizId,
  );

  const answerPayload = {
    quizId: dto.quizId,
    selectedAnswer: dto.selectedAnswer,
    submittedAt: now.toISOString(),
  };

  if (answerIndex !== -1) {
    const existingAnswer = String(answers[answerIndex]?.selectedAnswer ?? '').trim();
    const incomingAnswer = String(dto.selectedAnswer ?? '').trim();

    if (this.normalizeText(existingAnswer) !== this.normalizeText(incomingAnswer)) {
      throw new ConflictException(
        'Answer already submitted and cannot be changed',
      );
    }

    return {
      ...ongoingQuiz,
      questions,
      answers,
    };
  } else {
    answers.push(answerPayload);
  }

  const updated = await prisma.ongoingLiveQuiz.update({
    where: {
      id: ongoingQuiz.id,
    },
    data: {
      questions,
      answers,
    },
  });

  await prisma.liveQuizAttempt.upsert({
    where: {
      userId_quizId: {
        userId: resolvedUserId,
        quizId: dto.quizId,
      },
    },
    update: {
      ongoingLiveQuizId: ongoingQuiz.id,
      totalPrize: Number(meta.totalPrize || 0) || null,
      recipients: Number(meta.recipients || 0) || null,
      unitPrize: Number(meta.unitPrize || 0) || null,
    },
    create: {
      userId: resolvedUserId,
      quizId: dto.quizId,
      ongoingLiveQuizId: ongoingQuiz.id,
      totalPrize: Number(meta.totalPrize || 0) || null,
      recipients: Number(meta.recipients || 0) || null,
      unitPrize: Number(meta.unitPrize || 0) || null,
      isWinner: false,
      isCompleted: false,
      earning: 0,
      startedAt: now,
    },
  });

  return updated;
}

async submitLiveAnswerByQuizId(
  userId: number,
  quizId: string,
  selectedAnswer: string,
) {
  return this.updateLiveQuizAnswer(
    {
      userId: String(userId),
      quizId,
      selectedAnswer,
    },
    userId,
  );
}

async hasSubmittedLiveQuizForStream(
    streamId: number,
    userId: number,
  ): Promise<boolean> {
    const completedQuiz = await prisma.ongoingLiveQuiz.findFirst({
      where: {
        streamId,
        userId: String(userId),
        completed: true,
      },
      select: { id: true },
    });

    return Boolean(completedQuiz);
  }


  async getLiveQuiz(id: string) {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/live/${id}`),
    );
    return response.data;
  }

  async getAllLiveQuiz() {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/live`),
    );
    return response.data;
  }

  async getAllQuizSubmissions() {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/get-quiz-submissions`),
    );
    return response.data;
  }

  async getQuizSubmissionByUserId(id: string) {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/get-user-submissions/${id}`),
    );
    return response.data;
  }

  async getQuizAnswer(id: string) {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/quiz-answer/${id}`),
    );
    return response.data;
  }

    async getLiveQuizAnswer(id: string) {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/live-answer/${id}`),
    );
    return response.data;
  }

  async getCompletedLiveQuiz(userId: number) {
    const completedQuiz = await prisma.ongoingLiveQuiz.findFirst({
      where: {
        userId: String(userId),
        completed: true,
      },
      select: {
        answers: true,
        createdAt: true,
      }
    }); 

    return completedQuiz;
  }

    async getCompletedQuiz(userId: number) {
    const completedQuiz = await prisma.ongoingQuiz.findFirst({
      where: {
        userId,
        isCompleted: true,
      },
      select: {
        answers: true,
        createdAt: true,
      }
    }); 

    return completedQuiz;
  }

      async getAllCompletedQuiz() {
        console.log('hit completedquiz')
    const completedQuiz = await prisma.ongoingQuiz.findMany({
      where: {
        isCompleted: true,
      },
    }); 

    return completedQuiz;
  }



/**
 * Create a quick-start quiz session from a pack already fetched from Go.
 * Nest no longer needs to call Go when the client supplies the pack.
 */
async startQuickQuizSession(
  userId: number,
  pack: Record<string, any>,
  isRandom = true,
) {
  try {
    await prisma.ongoingQuiz.deleteMany({
      where: {
        userId,
        isCompleted: false,
      },
    });

    const subscription =
      await this.userService.checkSubscriptionStatusbyUserId(userId);
    const plan =
      subscription.subscriptionPlan?.toString().trim().toUpperCase() || '';

    if (plan === 'FREE') {
      const now = new Date(
        new Date().toLocaleString('en-US', {
          timeZone: 'Africa/Lagos',
        }),
      );
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const completedToday = await prisma.ongoingQuiz.count({
        where: {
          userId: Number(userId),
          isCompleted: true,
          completedAt: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
      });

      if (completedToday >= 5) {
        const lastCompletedQuiz = await prisma.ongoingQuiz.findFirst({
          where: {
            userId: Number(userId),
            isCompleted: true,
            totalQuestions: 25,
            completedAt: {
              gte: startOfDay,
              lt: endOfDay,
            },
          },
          orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
        });

        const limitQuizzes = Array.isArray(lastCompletedQuiz?.questions)
          ? lastCompletedQuiz.questions
          : [];

        return {
          data: {
            quizzes: limitQuizzes,
            totalEarning: lastCompletedQuiz?.totalEarning ?? 0,
            totalQuestions: lastCompletedQuiz?.totalQuestions ?? 25,
            totalTime: lastCompletedQuiz?.totalTime ?? null,
            quizId: lastCompletedQuiz?.id ?? null,
            message: 'Upgrade your plan to get daily tests.',
            limitReached: true,
          },
        };
      }
    }

    const quizzes = Array.isArray(pack?.quizzes) ? pack.quizzes : [];
    if (!quizzes.length) {
      throw new NotFoundException('No quizzes provided');
    }

    const languagePreference = pack.languagePreference || null;
    const subjectPreference = pack.subjectPreference || null;
    const testLevel = pack.testLevel || quizzes[0]?.testLevel || null;

    const totalQuestions: number = quizzes.length;
    const totalEarning: number =
      Number(pack.totalEarning) ||
      quizzes.reduce(
        (sum: number, q: any) => sum + Number(q.earning ?? 0),
        0,
      );

    const amountInNaira = totalEarning / 1000;

    const convertToUSDC = await this.paymentService.getExchangeRate('USDC');
    const convertToUSDT = await this.paymentService.getExchangeRate('USDT');

    const amountInUSDC = amountInNaira / Number(convertToUSDC.rate);
    const amountInUSDT = amountInNaira / Number(convertToUSDT.rate);
    const totalTime: number = pack.totalTime ?? totalQuestions * 2;

    const now = new Date(
      new Date().toLocaleString('en-US', {
        timeZone: 'Africa/Lagos',
      }),
    );

    const expiresAt = new Date(now.getTime() + totalTime * 60 * 1000);

    const quizAttempt = await prisma.ongoingQuiz.create({
      data: {
        userId: Number(userId),
        testQuiz: quizzes[0]?.testQuiz ?? '',
        subject: quizzes[0]?.subject ?? '',
        testLevel: quizzes[0]?.testLevel ?? '',
        totalEarning,
        totalEarninginNaira: amountInNaira,
        totalEarninginUSDC: amountInUSDC,
        totalEarninginUSDT: amountInUSDT,
        totalQuestions,
        totalTime,
        isRandom,
        timeRemaining: totalTime,
        questions: JSON.parse(JSON.stringify(quizzes)),
        answers: JSON.parse('[]'),
        ...(!isRandom && {
          startedAt: now,
          expiresAt,
        }),
      },
    });

    if (isRandom) {
      await prisma.quizAttempt.create({
        data: {
          quizId: quizAttempt.id,
          userId: Number(userId),
          isStarted: false,
          isCompleted: false,
          startedAt: now,
          expiresAt,
        },
      });
    }

    return {
      data: {
        ...pack,
        quizzes,
        totalQuestions,
        totalTime,
        totalEarning,
        quizId: quizAttempt.id,
        amountInNaira,
        amountInUSDC,
        amountInUSDT,
        isRandom,
        languagePreference,
        subjectPreference,
        testLevel,
      },
    };
  } catch (error) {
    if (error instanceof HttpException) throw error;

    console.log(error, 'startQuickQuizSession error');

    const message =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      'Failed to start quick quiz session';

    throw new HttpException(message, error?.response?.status || 500);
  }
}

async getQuizWithPreferences(dto: GetQuizWithPreferencesDto, userId: number) {
  try {
    let actualLanguagePreference = dto.languagePreference;
    let actualSubjectPreference = dto.subjectPreference;
    let actualTestLevel = dto.testLevel;

    if (
      !dto.isRandom &&
      (!actualLanguagePreference ||
        !actualSubjectPreference ||
        !actualTestLevel)
    ) {
      try {
        const onboardingDetails =
          await this.userService.fetchOnboardingdetails(userId);
        const { languagePreference, subjectPreference, testLevel } =
          onboardingDetails.data;

        actualLanguagePreference =
          actualLanguagePreference || languagePreference;
        actualSubjectPreference =
          actualSubjectPreference || subjectPreference;
        actualTestLevel = actualTestLevel || testLevel;
      } catch (error) {
        console.warn('Failed to fetch onboarding details:', error?.message);
      }
    }

    // Legacy Nest GET still fetches pack from Go, then creates session locally.
    // Prefer client → Go /quick-start + POST /quiz/start-quick-session.
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/quick-start`, {
        params: {
          languagePreference: actualLanguagePreference,
          subjectPreference: actualSubjectPreference,
          testLevel: actualTestLevel,
          questionPreference: dto.questionPreference,
          timePreference: dto.timePreference,
          isRandom: dto.isRandom === true ? 'true' : 'false',
        },
      }),
    );

    const pack = response.data?.data || response.data || {};
    return this.startQuickQuizSession(userId, pack, !!dto.isRandom);
  } catch (error) {
    if (error instanceof HttpException) throw error;

    console.log(error, 'meta error');

    const message =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      'Failed to get quiz with preferences';

    throw new HttpException(message, error?.response?.status || 500);
  }
}

async getOngoingQuiz (userId: number) {
    const ongoingQuiz = await prisma.ongoingQuiz.findFirst({
    where: {
      userId,
      isCompleted: false,
    },
  });

  return ongoingQuiz;

}

async fetchOngoingQuiz(userId: number) {
  const ongoingQuiz = await prisma.ongoingQuiz.findFirst({
    where: {
      userId,
      isCompleted: false,
    },
    include: {
      quizAttempt: true,
    },
  });

  if (!ongoingQuiz) {
    return null;
  }

  // RANDOM QUIZ FLOW
  if (ongoingQuiz.isRandom) {
    // QuizAttempt was somehow deleted or never created
    if (!ongoingQuiz.quizAttempt) {
      return {
        missingQuizAttempt: true,
        quizId: ongoingQuiz.id,
      };
    }


        const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  );

    if (
      ongoingQuiz.quizAttempt.isStarted &&
      ongoingQuiz.quizAttempt.expiresAt &&
      ongoingQuiz.quizAttempt.expiresAt <= now
    ) {
      return {
        expired: true,
        message: 'Your quiz has expired. Please start a new quiz.',
      };
    }

    return ongoingQuiz;
  }
          const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  );

  // NORMAL QUIZ FLOW
  if (
    ongoingQuiz.expiresAt &&
    ongoingQuiz.expiresAt <= now
    
    // new Date()
  ) {
    return {
      expired: true,
      message: 'Your quiz has expired. Please start a new quiz.',
    };
  }

  return ongoingQuiz;
}


async startRandomQuiz(dto: startRandomQuiz) {

  if(!dto.quizId || !dto.userId) {
    throw new BadRequestException('quizId and userId are required to start a random quiz');
  }
  
  const quiz = await prisma.ongoingQuiz.findUnique({
    where: { id: dto.quizId },
  });

  if (!quiz) {
    throw new NotFoundException('Quiz not found');
  }

        const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  );

  const expiresAt = new Date(
    now.getTime() + quiz.totalTime * 60 * 1000,
  );

  await prisma.quizAttempt.updateMany({
    where: {
      quizId: dto.quizId,
      userId: dto.userId,
      isStarted: false,
    },
    data: {
      isStarted: true,
      startedAt: now,
      expiresAt,
    },
  });

  await prisma.ongoingQuiz.update({
    where: { id: dto.quizId },
    data: {
      startedAt: now,
      expiresAt,
    },
  });
}

// quiz.service.ts
async recordAnswer(userId: number, dto: RecordAnswerDto) {
  try {
            const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  );
    const ongoingQuiz = await prisma.ongoingQuiz.findFirst({
      where: {
        userId,
        isCompleted: false,
      },
      include: {
        quizAttempt: true,
      },
    });

    if (!ongoingQuiz) {
      throw new HttpException(
        'No active quiz session found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (ongoingQuiz.isRandom) {
      const quizAttempt = ongoingQuiz.quizAttempt;

      if (!quizAttempt.isStarted) {
        throw new HttpException(
          'Please start random quiz before submitting answers.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (quizAttempt.expiresAt && quizAttempt.expiresAt <= now) {
        throw new HttpException(
          'Your random quiz session has expired.',
          HttpStatus.GONE,
        );
      }
    }

    const questions = ongoingQuiz.questions as unknown as QuizQuestion[];
    const questionExists = questions.find((q) => q.id === dto.quizId);

    if (!questionExists) {
      throw new HttpException(
        'Question does not belong to your active quiz.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Parse existing answers
    const existingAnswers = ongoingQuiz.answers as unknown as UserAnswer[];

    // Upsert — update if already answered, insert if new
    const answerIndex = existingAnswers.findIndex(
      (a) => a.quizId === dto.quizId,
    );

  //           const now = new Date(
  //   new Date().toLocaleString("en-US", {
  //     timeZone: "Africa/Lagos",
  //   })
  // );

    if (answerIndex !== -1) {
      // Update existing answer
      existingAnswers[answerIndex] = {
        ...existingAnswers[answerIndex],
        selectedAnswer: dto.selectedAnswer,
        answeredAt: now,
      };
    } else {
      // Add new answer
      existingAnswers.push({
        quizId: dto.quizId,
        selectedAnswer: dto.selectedAnswer,
        answeredAt: now,
      });
    }

    // Update currentIndex to track progress
    const currentIndex = existingAnswers.length;

    const updated = await prisma.ongoingQuiz.update({
      where: { id: ongoingQuiz.id },
      data: {
        answers:  existingAnswers as unknown as Prisma.JsonArray,
        currentIndex,
      },
    });

    return {
      data: {
        quizId: dto.quizId,
        selectedAnswer: dto.selectedAnswer,
        totalAnswered: existingAnswers.length,
        totalQuestions: ongoingQuiz.totalQuestions,
        // Return in submit_format shape for easy final submission
        responses: existingAnswers.map(({ quizId, selectedAnswer }) => ({
          quizId,
          selectedAnswer,
        })),
      },
      message: 'Answer recorded successfully',
      success: true,
    };
  } catch (error) {
    if (error instanceof HttpException) throw error;

    throw new HttpException(
      error?.message || 'Failed to record answer',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

async getQuizleaderboard(filter: 'all' | 'today' | 'weekly' | 'monthly' = 'all') {
  try {
    // const now = new Date();
            const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  );

    let dateFilter = {};

    // Filter logic
    switch (filter) {
      case 'today': {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        dateFilter = {
          gte: startOfDay,
        };
        break;
      }

      case 'weekly': {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);

        dateFilter = {
          gte: sevenDaysAgo,
        };
        break;
      }

      case 'monthly': {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);

        dateFilter = {
          gte: thirtyDaysAgo,
        };
        break;
      }

      default:
        break;
    }

    // Fetch leaderboard rows
    const quizBoard = await prisma.quizLeaderboard.findMany({
      where:
        filter === 'all'
          ? {}
          : {
              submittedAt: dateFilter,
            },
      orderBy: {
        submittedAt: 'asc',
      },
    });

    // Group user submissions
    const grouped = new Map();

    for (const row of quizBoard) {
      // Groups same quiz session together
      const key = `${row.userId}_${new Date(row.submittedAt).toISOString()}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          userId: row.userId,
          submittedAt: row.submittedAt,
          totalScore: 0,
          totalEarning: 0,
          totalQuestions: 0,
          rows: [],
        });
      }

      const current = grouped.get(key);

      current.totalScore += Number(row.score || 0);
      current.totalEarning += Number(row.earning || 0);
      current.totalQuestions += 1;
      current.rows.push(row);
    }

    // Convert to array
    const leaderboard = Array.from(grouped.values());

    // Sort leaderboard
    leaderboard.sort((a, b) => {
      // Highest score first
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }

      // Earlier submission wins tie
      return (
        new Date(a.submittedAt).getTime() -
        new Date(b.submittedAt).getTime()
      );
    });

    // Assign positions
    for (let i = 0; i < leaderboard.length; i++) {
      leaderboard[i].position = i + 1;
    }

    // Update DB
    for (const user of leaderboard) {
      await prisma.quizLeaderboard.updateMany({
        where: {
          userId: user.userId,
        },
        data: {
          position: user.position,
        },
      });
    }

    return leaderboard;

  } catch (error) {
    throw new HttpException(
      error?.message || 'Failed to fetch live quiz leaderboard',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

// async getLiveQuizLeaderboard() {
//   try {
//     const quiz_board = await prisma.liveQuizLeaderboard.findMany({
//     });

//     return quiz_board;

//   } catch(error) {
//     throw new HttpException(
//       error?.message || 'Failed to fetch live quiz leaderboard',
//       HttpStatus.INTERNAL_SERVER_ERROR,
//     )
//   }
// }

// Fetch current state of ongoing quiz with answers
async getOngoingQuizAnswers(userId: number) {
  try {
            const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  );
    const ongoingQuiz = await prisma.ongoingQuiz.findFirst({
      where: {
        userId,
        isCompleted: false,
        expiresAt: { gt: now },
      },
    });

    if (!ongoingQuiz) {
      throw new HttpException(
        'No active quiz session found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const answers = ongoingQuiz.answers as unknown as UserAnswer[];

    return {
      data: {
        ongoingQuizId: ongoingQuiz.id,
        totalAnswered: answers.length,
        totalQuestions: ongoingQuiz.totalQuestions,
        currentIndex: ongoingQuiz.currentIndex,
        timeRemaining: ongoingQuiz.timeRemaining,
        expiresAt: ongoingQuiz.expiresAt,
        // Always returned in submit_format shape
        responses: answers.map(({ quizId, selectedAnswer }) => ({
          quizId,
          selectedAnswer,
        })),
      },
      message: 'success',
      success: true,
    };
  } catch (error) {
    if (error instanceof HttpException) throw error;

    throw new HttpException(
      error?.message || 'Failed to fetch quiz answers',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

  async updateLiveQuiz(updateData: any, id: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.patch(`${this.baseUrl}/live/${id}`, updateData),
      );
      return response.data;
    } catch (error) {
      this.rethrowGoProxyError(error, 'Failed to update live quiz');
    }
  }

  async getAllCategory() {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/categories`),
    );
    return response.data;
  }

  async deleteLiveQuiz(id: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/live/${id}`),
      );
      return response.data;
    } catch (error) {
      this.rethrowGoProxyError(error, 'Failed to delete live quiz');
    }
  }

  async closeExpiredLiveQuizSessions(): Promise<number> {
    const sessions = await prisma.ongoingLiveQuiz.findMany({
      where: { completed: false },
    });

    if (!sessions.length) {
      return 0;
    }

    const now = this.getLagosNow();
    let closed = 0;

    for (const session of sessions) {
      const questions = (session.questions as any[]) || [];
      if (!questions.length) {
        continue;
      }

      const allFinished = questions.every((question) => {
        const finishAt = this.toDate(
          question?.quizFinishDate ?? question?.quizScheduleDate,
        );
        return finishAt ? now >= finishAt : false;
      });

      if (!allFinished) {
        continue;
      }

      try {
        await this.submitLiveQuiz(String(session.userId));
        closed += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to auto-close live quiz session for user ${session.userId}: ${error?.message}`,
        );
      }
    }

    return closed;
  }

  async createQuizCategory(createQuizCategoryData: CreateQuizCategoryDto) {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/create-category`,
        createQuizCategoryData,
      ),
    );
    return response.data;
  }

  async getQuiz(id: string) {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/get/${id}`),
    );
    return response.data;
  }

  async getAllQuiz() {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/getall`),
    );
    return response.data;
  }

  async updateQuiz(id: string, updateData: any) {
    const response = await firstValueFrom(
      this.httpService.patch(`${this.baseUrl}/update/${id}`, updateData),
    );
    return response.data;
  }

  async deleteQuiz(id: string) {
    const response = await firstValueFrom(
      this.httpService.delete(`${this.baseUrl}/delete/${id}`),
    );
    return response.data;
  }
}
