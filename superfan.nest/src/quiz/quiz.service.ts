import { HttpService } from '@nestjs/axios';
import { BadRequestException, HttpException, HttpStatus, Injectable, InternalServerErrorException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
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
  // check existing active quiz
  const existingQuiz =
    await prisma.ongoingLiveQuiz.findFirst({
      where: {
        userId: String(userId),
        completed: false,
      },
    });

  if (existingQuiz) {
    return existingQuiz;
  }

  // fetch random quizzes
  const response = await firstValueFrom(
    this.httpService.get(
      `${this.baseUrl}/live/random/${totalQuestions}`,
    ),
  );

  const quizzes = response.data?.data || [];

  if (!quizzes.length) {
    throw new NotFoundException(
      'No live quizzes found',
    );
  }

  // filter quizzes by recipient cap and previous user attempts
  const filteredQuizzes = [];

  for (const quiz of quizzes) {
    const recipients = Number(quiz.recipients ?? 0);
    const [attemptCount, userAttempt] = await Promise.all([
      prisma.liveQuizAttempt.count({
        where: {
          quizId: quiz.id,
        },
      }),
      prisma.liveQuizAttempt.findUnique({
        where: {
          userId_quizId: {
            userId: String(userId),
            quizId: quiz.id,
          },
        },
      }),
    ]);

    // only allow quiz if recipients are not exhausted and this user has not attempted it
    if (!userAttempt && (!recipients || attemptCount < recipients)) {
      filteredQuizzes.push(quiz);
    }
  }

  if (!filteredQuizzes.length) {
    throw new NotFoundException(
      'No available live quizzes remaining',
    );
  }

  // limit to requested totalQuestions
  const selectedQuizzes = filteredQuizzes.slice(
    0,
    totalQuestions,
  );

  // save only required quiz data
  const questions = selectedQuizzes.map(
    (quiz: any) => ({
      quizId: quiz.id,
      question: quiz.question,
      options: quiz.options,
      imageLink: quiz.imageLink,
      totalPrize: quiz.totalPrize,
      recipients: quiz.recipients,
      unitPrize: quiz.unitPrize,
      quizScheduleDate:
        quiz.quizScheduleDate,

      selectedAnswer: null,
      isCorrect: null,
    }),
  );

  const quizIds = selectedQuizzes.map(
    (quiz: any) => quiz.id,
  );

  // create ongoing quiz
  return prisma.ongoingLiveQuiz.create({
    data: {
      userId: String(userId),
      quizIds,
      questions,
      answers: [],
      completed: false,
      streamId
    },
  });

}catch(error) {
  console.log(error, 'log error')
      throw new NotFoundException(
       error.response.message
      );
}
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
  const answers: any[]   = (ongoingQuiz.answers   as any[]) || [];

  let totalCorrect  = 0;
  let totalEarning  = 0;

  // ── 1. Grade every question ──────────────────────────────────────────────
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];

    const userAnswer = answers.find(
      (a) => a.quizId === question.quizId,
    );

    if (!userAnswer) {
      questions[i] = { ...question, isCorrect: false };
      continue;
    }

    const answerResponse = await this.getLiveQuizAnswer(question.quizId);
    const realAnswer     = answerResponse?.data?.answer;
    const isCorrect      = userAnswer.selectedAnswer === realAnswer;

    if (isCorrect) {
      totalCorrect++;
      totalEarning += question.unitPrize ?? 0;
    }

    questions[i] = {
      ...question,
      isCorrect,
      correctAnswer:  realAnswer,
      selectedAnswer: userAnswer.selectedAnswer,
    };
  }

  // ── 2. Determine if user is a winner (ALL correct) ───────────────────────
  const isWinner = totalCorrect === questions.length && questions.length > 0;

  // ── 3. Persist completed quiz with earning ───────────────────────────────
  const updatedQuiz = await prisma.ongoingLiveQuiz.update({
    where: { id: ongoingQuiz.id },
    data: {
      completed:    true,
      questions,
      totalEarning: totalEarning,
    },
  });

  const completedAt = new Date();

  await Promise.all(
    questions.map((question) =>
      prisma.liveQuizAttempt.upsert({
        where: {
          userId_quizId: {
            userId,
            quizId: question.quizId,
          },
        },
        update: {
          ongoingLiveQuizId: ongoingQuiz.id,
          totalPrize: question.totalPrize ?? null,
          recipients: question.recipients ?? null,
          unitPrize: question.unitPrize ?? null,
          earning: question.isCorrect ? question.unitPrize ?? 0 : 0,
          isWinner,
          isCompleted: true,
          completedAt,
        },
        create: {
          userId,
          quizId: question.quizId,
          ongoingLiveQuizId: ongoingQuiz.id,
          totalPrize: question.totalPrize ?? null,
          recipients: question.recipients ?? null,
          unitPrize: question.unitPrize ?? null,
          earning: question.isCorrect ? question.unitPrize ?? 0 : 0,
          isWinner,
          isCompleted: true,
          completedAt,
        },
      }),
    ),
  );

  // ── 4. Credit wallet once (sum of all correct unitPrizes) ────────────────
  const rewardStatus = isWinner ? 'paid' : totalEarning > 0 ? 'paid' : 'none';

  if (totalEarning > 0) {
    await this.walletService.createLiveQuizReward(
      Number(userId),
      totalEarning,
      EarningStatus.PAID_OUT,   // or whatever your "paid" enum value is
    );
  }

  // ── 5. Build leaderboard rows (one per question) ─────────────────────────
  const leaderboardRows = questions.map((question) => ({
    userId,
    quizId:      question.quizId,
    question:    question.question,
    answer:      question.correctAnswer ?? '',
    isWinner,
    participants: question.recipients  ?? 0,
    unitPrize:   question.unitPrize    ?? 0,
    rewardStatus: question.isCorrect ? rewardStatus : 'none',
    rewardType: 'CASH',
    quizDate:    question.quizScheduleDate
                   ? new Date(question.quizScheduleDate)
                   : new Date(),
  }));

  await prisma.liveQuizLeaderboard.createMany({
    data: leaderboardRows,
  });

  // ── 6. Return result ─────────────────────────────────────────────────────
  return {
    totalQuestions: questions.length,
    totalCorrect,
    totalWrong:    questions.length - totalCorrect,
    score:         totalCorrect,
    totalEarning,
    isWinner,
    quiz:          updatedQuiz,
  };
}

async updateLiveQuizAnswer(dto: UpdateLiveAnswerDto) {
  const ongoingQuiz =
    await prisma.ongoingLiveQuiz.findFirst({
      where: {
        userId: String(dto.userId),
        completed: false,
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
  };

  if (answerIndex !== -1) {
    answers[answerIndex] = answerPayload;
  } else {
    answers.push(answerPayload);
  }

  return prisma.ongoingLiveQuiz.update({
    where: {
      id: ongoingQuiz.id,
    },
    data: {
      questions,
      answers,
    },
  });
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



async getQuizWithPreferences(dto: GetQuizWithPreferencesDto, userId: number) {
  try {

    const activeNow = new Date(
      new Date().toLocaleString("en-US", {
        timeZone: "Africa/Lagos",
      })
    );

    // Delete any incomplete quizzes before creating a new one
    // This ensures fresh quiz attempts without orphaned incomplete records
    await Promise.all([
      // Delete incomplete ongoing quizzes (both random and non-random)
      prisma.ongoingQuiz.deleteMany({
        where: {
          userId,
          isCompleted: false,
        },
      }),
    ]);

    const subscription = await this.userService.checkSubscriptionStatusbyUserId(userId);
    const plan = subscription.subscriptionPlan?.toString().trim().toUpperCase() || '';

    if (plan === 'FREE') {
            const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
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
          orderBy: [
            { completedAt: 'desc' },
            { createdAt: 'desc' },
          ],
        });

        const quizzes = Array.isArray(lastCompletedQuiz?.questions)
          ? lastCompletedQuiz.questions
          : [];

        return {
          data: {
            quizzes,
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

    // Generate random preferences if isRandom is true
    let actualLanguagePreference = dto.languagePreference;
    let actualSubjectPreference = dto.subjectPreference;
    let actualTestLevel = dto.testLevel;

    // Fetch from user's onboarding details if any preference is null
    if (!actualLanguagePreference || !actualSubjectPreference || !actualTestLevel) {
      try {
        const onboardingDetails = await this.userService.fetchOnboardingdetails(userId);
        const { languagePreference, subjectPreference, testLevel } = onboardingDetails.data;

        actualLanguagePreference = actualLanguagePreference || languagePreference;
        actualSubjectPreference = actualSubjectPreference || subjectPreference;
        actualTestLevel = actualTestLevel || testLevel;
      } catch (error) {
        // If fetch fails, continue to random generation
        console.warn('Failed to fetch onboarding details:', error?.message);
      }
    }

    // If still null or isRandom, generate random preferences
    if (dto.isRandom || !actualLanguagePreference || !actualSubjectPreference || !actualTestLevel) {
      const languages = ['yoruba'];
      const subjects = ['general'];
      const levels = ['basic'];

      actualLanguagePreference = actualLanguagePreference || languages[Math.floor(Math.random() * languages.length)];
      actualSubjectPreference = actualSubjectPreference || subjects[Math.floor(Math.random() * subjects.length)];
      actualTestLevel = actualTestLevel || levels[Math.floor(Math.random() * levels.length)];
    }

    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/preferences`, {
        params: {
          languagePreference: actualLanguagePreference,
          subjectPreference: actualSubjectPreference,
          testLevel: actualTestLevel,
          questionPreference: dto.questionPreference,
          timePreference: dto.timePreference,
        },
      }),
    );

    const { quizzes } = response.data.data;

    // Derive totals from quizzes array (API returns per-question earning, not aggregates)
    const totalQuestions: number = quizzes.length;
    const totalEarning: number = quizzes.reduce(
      (sum: number, q: any) => sum + Number(q.earning ?? 0),
      0,
    );

    const amountInNaira = totalEarning / 1000;

    let convertToUSDC = await this.paymentService.getExchangeRate('USDC');
    let convertToUSDT = await this.paymentService.getExchangeRate('USDT');

    let amountInUSDC = amountInNaira / Number(convertToUSDC.rate);
    let amountInUSDT = amountInNaira / Number(convertToUSDT.rate);
    const totalTime: number = response.data.data.totalTime ?? totalQuestions * 2;

      const now = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Lagos",
    })
  );

  const expiresAt = new Date(
    now.getTime() + totalTime * 60 * 1000
  );

// console.log(lagosTime.toISOString());
// amountInNaira, amountInUSDC, amountInUSDT

    let quizAttempt = await prisma.ongoingQuiz.create({
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
    isRandom: dto.isRandom,
    timeRemaining: totalTime,
    questions: JSON.parse(JSON.stringify(quizzes)),
    answers: JSON.parse('[]'),
    ...(!dto.isRandom && {
      startedAt: now,
      expiresAt: expiresAt,
    }),
  },
});

    if (response?.data?.data) {
      response.data.data.quizId = quizAttempt.id;

      // attach currency amounts to the response payload
      response.data.data.amountInNaira = amountInNaira;
      response.data.data.amountInUSDC = amountInUSDC;
      response.data.data.amountInUSDT = amountInUSDT;

      if (dto.isRandom) {
        response.data.data.languagePreference = actualLanguagePreference;
        response.data.data.subjectPreference = actualSubjectPreference;
        response.data.data.testLevel = actualTestLevel;
      }
    }

        if (dto.isRandom) {
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

    // Attach the created quiz attempt id to the API response so callers
    // can reference the persisted `ongoingQuiz` record.
    try {
      if (response && response.data && response.data.data) {
        response.data.data.quizId = quizAttempt.id;
        response.data.data.amountInNaira = amountInNaira;
        response.data.data.amountInUSDC = amountInUSDC;
        response.data.data.amountInUSDT = amountInUSDT;
      } else if (response && response.data) {
        response.data.quizId = quizAttempt.id;
        response.data.amountInNaira = amountInNaira;
        response.data.amountInUSDC = amountInUSDC;
        response.data.amountInUSDT = amountInUSDT;
      }
    } catch (err) {
      // non-fatal: if we can't attach, still return the original response
      console.warn('Failed to attach quizAttemptId or amounts to response', err);
    }

    return response.data;
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
    const response = await firstValueFrom(
      this.httpService.patch(`${this.baseUrl}/live/${id}`, updateData),
    );
    return response.data;
  }

  async getAllCategory() {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/categories`),
    );
    return response.data;
  }

  async deleteLiveQuiz(id: string) {
    const response = await firstValueFrom(
      this.httpService.delete(`${this.baseUrl}/v1/quiz/live/${id}`),
    );
    return response.data;
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
