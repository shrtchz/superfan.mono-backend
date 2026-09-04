import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EarningStatus } from '../common/enums/task.enum';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';
import { PointsConversionUtil } from '../common/utils/points-conversion.util';
import { PrismaService } from '../config/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '../prisma/prisma';
import { WalletTransactionFilterDto } from './wallet.dto';

export const MIN_WITHDRAWAL_NGN = 9999;

export const KYC_TRANSACTION_LIMITS = {
  TIER_0: { daily: 10000, monthly: 50000 },
  TIER_1: { daily: 500000, monthly: 5000000 },
};

export interface TransactionLimitStatus {
  tier: 'TIER_0' | 'TIER_1';
  isKycVerified: boolean;
  dailyLimit: number;
  monthlyLimit: number;
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  minWithdrawal: number;
}

@Injectable()
export class WalletService {
  readonly MIN_WITHDRAWAL_NGN = MIN_WITHDRAWAL_NGN;
  readonly KYC_TRANSACTION_LIMITS = KYC_TRANSACTION_LIMITS;

  constructor(
    private prisma: PrismaService, 
    private notificationService: NotificationService, 
    private pointsConversionUtil: PointsConversionUtil, 
    private eventEmitter: EventEmitter2
  ) {}

  /**
   * Retrieves real-time daily/monthly transaction limits and usage for a user (SCRUM-350)
   */
  async getTransactionLimitStatus(userId: number): Promise<TransactionLimitStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kyc_status: true,
        kyc_tier: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const isKycVerified = user.kyc_status === 'VERIFIED';
    const tier: 'TIER_0' | 'TIER_1' = isKycVerified ? 'TIER_1' : 'TIER_0';
    const limits = this.KYC_TRANSACTION_LIMITS[tier];

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Sum all completed and pending deposits/withdrawals since start of current month
    const transactions = await this.prisma.walletTransaction.findMany({
      where: {
        userId,
        status: { in: ['SUCCESS', 'PENDING'] },
        type: { in: ['credit', 'debit', 'deposit', 'withdrawal', 'FUNDING', 'WITHDRAWAL'] },
        createdAt: { gte: startOfMonth },
      },
      select: {
        amount: true,
        createdAt: true,
      },
    });

    let dailyUsed = 0;
    let monthlyUsed = 0;

    for (const tx of transactions) {
      const txAmount = Math.abs(Number(tx.amount) || 0);
      monthlyUsed += txAmount;
      if (tx.createdAt >= startOfDay) {
        dailyUsed += txAmount;
      }
    }

    return {
      tier,
      isKycVerified,
      dailyLimit: limits.daily,
      monthlyLimit: limits.monthly,
      dailyUsed,
      monthlyUsed,
      dailyRemaining: Math.max(0, limits.daily - dailyUsed),
      monthlyRemaining: Math.max(0, limits.monthly - monthlyUsed),
      minWithdrawal: this.MIN_WITHDRAWAL_NGN,
    };
  }

  /**
   * Validates that a transaction complies with minimum withdrawal and KYC tier limits in real-time (SCRUM-350)
   */
  async validateTransactionLimits(
    userId: number,
    amount: number,
    type: 'DEPOSIT' | 'WITHDRAWAL',
  ): Promise<TransactionLimitStatus> {
    if (amount <= 0) {
      throw new BadRequestException('Transaction amount must be greater than zero');
    }

    // Deposits are not subject to KYC daily or monthly limits.
    if (type === 'DEPOSIT') {
      return this.getTransactionLimitStatus(userId);
    }

    // 1. Enforce minimum withdrawal of ₦9,999 on all withdrawal requests regardless of method
    if (type === 'WITHDRAWAL' && amount < this.MIN_WITHDRAWAL_NGN) {
      throw new BadRequestException(
        `Minimum withdrawal amount is ₦${this.MIN_WITHDRAWAL_NGN.toLocaleString()}. Your request was ₦${amount.toLocaleString()}.`,
      );
    }

    // 2. Fetch fresh real-time limit status from database
    const status = await this.getTransactionLimitStatus(userId);

    // 3. Enforce daily limit
    if (status.dailyUsed + amount > status.dailyLimit) {
      const msg =
        status.tier === 'TIER_0'
          ? `Transaction of ₦${amount.toLocaleString()} exceeds your daily limit of ₦${status.dailyLimit.toLocaleString()} (Remaining: ₦${status.dailyRemaining.toLocaleString()}). Complete KYC identity verification to increase your limit to ₦500,000/day.`
          : `Transaction of ₦${amount.toLocaleString()} exceeds your daily limit of ₦${status.dailyLimit.toLocaleString()} (Remaining: ₦${status.dailyRemaining.toLocaleString()}).`;
      throw new ForbiddenException(msg);
    }

    // 4. Enforce monthly limit
    if (status.monthlyUsed + amount > status.monthlyLimit) {
      const msg =
        status.tier === 'TIER_0'
          ? `Transaction of ₦${amount.toLocaleString()} exceeds your monthly limit of ₦${status.monthlyLimit.toLocaleString()} (Remaining: ₦${status.monthlyRemaining.toLocaleString()}). Complete KYC identity verification to increase your limit to ₦5,000,000/month.`
          : `Transaction of ₦${amount.toLocaleString()} exceeds your monthly limit of ₦${status.monthlyLimit.toLocaleString()} (Remaining: ₦${status.monthlyRemaining.toLocaleString()}).`;
      throw new ForbiddenException(msg);
    }

    return status;
  }
  async creditWallet(userId: number, amount: number, title: string, description: string, accountType?: string, currency: string = 'NGN') {
    console.log('[Wallet][creditWallet][START]', {
      userId,
      amount,
      title,
      description,
      accountType,
      currency,
    });

    const isGold = accountType === 'Gold';
    const balanceField = isGold ? 'goldBalance' : 'personalBalance';

    // Use transaction to ensure atomicity - all or nothing
    await prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: {
          balance: {
            increment: amount,
          },
          [balanceField]: {
            increment: amount,
          },
        },
      });
      console.log('[Wallet][creditWallet] Wallet balance updated', {
        userId,
        newBalance: updatedWallet.balance,
        increment: amount,
      });

      const walletTransaction = await (tx.walletTransaction as any).create({
        data: {
          user: {
            connect: { id: userId },
          },
          amount,
          type: 'credit',
          currency,
          status: 'SUCCESS',
          description,
          account_type: accountType,
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      });
      console.log('[Wallet][creditWallet] Wallet transaction created', {
        transactionId: walletTransaction.id,
        userId,
        amount,
      });

      const activityWallet = await tx.activityWallet.create({
        data: {
          user: {
            connect: { id: userId },
          },
          type: 'credit',
          title,
          description,
          amount,
          currency,
          status: 'SUCCESS',
        },
      });
      console.log('[Wallet][creditWallet] Activity wallet created', {
        activityId: activityWallet.id,
        userId,
        amount,
      });

      // Send notification for manual/deposit wallet credit
      if (title.startsWith('Deposit') || title === 'Manual Credit') {
        await this.notificationService.createNotification(
          userId,
          title,
          `Your wallet has been credited with ₦${amount}`,
          'wallet_credit_manual',
        );
      }
    });

    console.log('[Wallet][creditWallet][END] Completed successfully');
    
    // Fire socket events for live update
    this.eventEmitter.emit('user.wallet.updated', { userId });
    this.eventEmitter.emit('user.payment.history', { userId });
  }


  
  async userCreateReward(userId: number, amount: number, currency: string, type: string, status: EarningStatus) {
    await this.prisma.reward.create({
      data: {
        userId,
        amount,
        currency,
        type,
        status,
      },
    });
  }


  createReward(userId: number, points: number, type: string, status: EarningStatus) {
    const amount = this.pointsConversionUtil.pointsToNaira(points);
    return this.createRewardWithAmount(userId, amount, 'NGN', type, status);
  }

  private async createRewardWithAmount(userId: number, amount: number, currency: string, type: string, status: EarningStatus) {
    await this.prisma.reward.create({
      data: {
        userId,
        amount,
        currency,
        type,
        status,
      },
    });

    // Credit the wallet - system rewards always go to Gold Account
    const rewardLabel = type.toLowerCase().includes('ad') ? 'Ads Reward' : 'Test Quiz Earning';
    await this.creditWallet(userId, amount, rewardLabel, rewardLabel, 'Gold', currency);

    // Send notification
    await this.notificationService.createNotification(
      userId,
      rewardLabel,
      `You have earned ${amount} ${currency} from ${type}`,
    );

    // Fire socket events for live update
    this.eventEmitter.emit('user.wallet.updated', { userId });
    this.eventEmitter.emit('user.payment.history', { userId });

    return {
      success: true,
      message: `Wallet credited with ${amount} ${currency}`,
    };
  }

  async createQuizReward(userId: number, points: number, subject: string, status: EarningStatus, reference?: string) {
    const amount = this.pointsConversionUtil.pointsToNaira(points);
    const rewardReference = reference ?? `quiz_reward:${userId}:${subject}:${points}:${status}`;

    const existingReward = await this.prisma.reward.findFirst({
      where: {
        userId,
        type: 'quiz_reward',
        reference: rewardReference,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingReward) {
      return;
    }
    
    await this.prisma.reward.create({
      data: {
        userId,
        amount,
        currency: 'NGN',
        type: 'quiz_reward',
        status,
        reference: rewardReference,
      },
    });

    // Credit the wallet - quiz rewards go to Gold Account
    await this.creditWallet(userId, amount, 'Test Quiz Earning', 'Test Quiz Earning', 'Gold', 'NGN');

    await this.prisma.point.create({
      data: {
        userId,
        points,
        reference: rewardReference,
        type: 'quiz_reward',
      }
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { lifetimePoints: { increment: points } },
    });

    // Send notification
    await this.notificationService.createNotification(
      userId,
      'Test Quiz Earning',
      `You earned ₦${amount} from ${subject} Quiz`,
      'quiz_reward'
    );

        await this.notificationService.createNotification(
      userId,
      `you earned ${points}PTS🎮`,
      `from ${subject} Quiz`,
      'quiz_reward'
    );
  }

  async createLiveQuizReward(userId: number, points: number, status: EarningStatus, reference?: string) {
    const amount = this.pointsConversionUtil.pointsToNaira(points);
    const rewardReference = reference ?? `live_quiz_reward:${userId}:${points}:${status}`;

    const existingReward = await this.prisma.reward.findFirst({
      where: {
        userId,
        type: 'live_quiz_reward',
        reference: rewardReference,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingReward) {
      return;
    }
    
    await this.prisma.reward.create({
      data: {
        userId,
        amount,
        currency: 'NGN',
        type: 'live_quiz_reward',
        status,
        reference: rewardReference,
      },
    });

    // Credit the wallet - live quiz rewards go to Gold Account
    await this.creditWallet(userId, amount, 'Test Quiz Earning', 'Test Quiz Earning', 'Gold', 'NGN');

    await this.prisma.user.update({
      where: { id: userId },
      data: { lifetimePoints: { increment: points } },
    });

    await this.notificationService.createNotification(
      userId,
      'Test Quiz Earning',
      `You earned ₦${amount} from Live Quiz`,
      'live_quiz_reward'
    );
  }


async getUserWalletTransactions(filters: WalletTransactionFilterDto) {
  const {
    userId,
    accountType,
    startDate,
    endDate,
    type,
    currency,
    status,
    page = 1,
    limit = 20,
  } = filters;

  const where: Prisma.WalletTransactionWhereInput = {
    ...(userId && { userId: Number(userId) }),
    ...(accountType && { account_type: accountType }),
    ...(type && { type }),
    ...(currency && { currency }),
    ...(status && { status }),
    ...((startDate || endDate) && {
      createdAt: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      },
    }),
  };

  const [data, total] = await Promise.all([
    this.prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.walletTransaction.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

  async getWalletTransactionsbyId(id: number) {
    return await this.prisma.walletTransaction.findMany({
      where: { id },
    });
  }

  async fundWalletWithCard(userId: number, transactionReference: string) {
    // Get transaction details from Monnify
    // const transaction = await this.monnifyService.getTransactionByReference(transactionReference);
    const transaction: any = null; // Mocked

    if (!transaction || transaction.responseBody?.paymentStatus !== 'PAID') {
      throw new Error('Transaction not found or not successful');
    }

    const amount = Number(transaction.responseBody.amountPaid);
    const reference = transaction.responseBody.paymentReference || transactionReference;
    const paymentMethod = transaction.responseBody.paymentMethod;
    const customerName = transaction.responseBody.customer?.name;
    const bankName = transaction.responseBody.destinationAccountInformation?.bankName;
    const accountNumber = transaction.responseBody.destinationAccountInformation?.accountNumber;

    // Prevent duplicate
    const existingTx = await this.prisma.walletTransaction.findFirst({
      where: { reference },
    });

    if (existingTx) {
      throw new Error('Transaction already processed');
    }

    // Get user with subscription plan and accounts
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accounts: true,
        subscriptionPlan: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const accounts = user.accounts as any[];
    const matchedAccount = accounts?.find(
      (acc: any) => acc.accountNumber === accountNumber,
    );

    const accountType = matchedAccount?.accountType || 'Personal';

    // ✅ Reject deposits into Gold Account
    if (accountType === 'Gold') {
      throw new Error('Deposits into Gold Account are not allowed');
    }

    // ✅ Block Free-tier users from Personal Account deposits
    if (accountType === 'Personal' && user.subscriptionPlan === 'FREE') {
      throw new Error('Free tier users cannot deposit into Personal Account. Please upgrade to Pro or Pro Max.');
    }

    // Determine which balance to increment
    const balanceField = accountType === 'Gold' ? 'goldBalance' : 'personalBalance';

    await this.prisma.$transaction([
      // Update wallet balances
      this.prisma.wallet.update({
        where: { userId },
        data: {
          balance: { increment: amount },
          [balanceField]: { increment: amount },
        },
      }),

      // Create wallet transaction
      (this.prisma.walletTransaction as any).create({
        data: {
          userId,
          amount,
          type: 'credit',
          currency: 'NGN',
          transactionType: 'FUNDING',
          status: 'SUCCESS',
          reference,
          payment_method: paymentMethod,
          account_name: customerName,
          bank_name: bankName,
          account_no: accountNumber,
          account_type: accountType,
          description: 'Deposit - Debit Card',
          holdUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      }),

      // Create activity wallet
      this.prisma.activityWallet.create({
        data: {
          userId,
          type: 'credit',
          title: 'Deposit - Debit Card',
          description: 'Deposit - Debit Card',
          amount,
          currency: 'NGN',
          reference,
          status: 'SUCCESS',
          metadata: {
            paymentMethod,
            bankName,
            accountType,
          },
        },
      }),
    ]);

    // Fire socket events for live update
    this.eventEmitter.emit('user.wallet.updated', { userId });
    this.eventEmitter.emit('user.payment.history', { userId });

    return { message: 'Wallet funded successfully', amount };
  }

  async transferbtwPersonalandGoldAccount(userId: number, amount: number, fromAccountType: 'Personal' | 'Gold') {
    // Validate amount
    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Get user and wallet
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accounts: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get wallet
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Check if wallet has sufficient balance
    if (wallet.balance < amount) {
      throw new Error('Insufficient wallet balance');
    }

    // Get accounts
    const accounts = (user.accounts as any[]) || [];
    const personalAccount = accounts.find((acc: any) => acc.accountType === 'Personal');
    const goldAccount = accounts.find((acc: any) => acc.accountType === 'Gold');

    if (!personalAccount || !goldAccount) {
      throw new Error('Personal or Gold account not found');
    }

    // Determine source and destination based on fromAccountType
    const sourceAccount = fromAccountType === 'Personal' ? personalAccount : goldAccount;
    const destinationAccount = fromAccountType === 'Personal' ? goldAccount : personalAccount;
    const destinationAccountType = fromAccountType === 'Personal' ? 'Gold' : 'Personal';
const trf_reference = `TRANSFER_${Date.now()}`;
    // Perform transfer in a transaction
    await this.prisma.$transaction([
      // Debit source account
      (this.prisma.walletTransaction as any).create({
        data: {
          userId,
          amount,
          type: 'debit',
          currency: 'NGN',
          transactionType: 'TRANSFER',
          status: 'SUCCESS',
          reference: trf_reference,
          description: `Transfer from ${fromAccountType} to ${destinationAccountType} account`,
          account_no: sourceAccount.accountNumber,
          account_name: sourceAccount.accountName,
          account_type: fromAccountType,
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      }),

      // Credit destination account
      (this.prisma.walletTransaction as any).create({
        data: {
          userId,
          amount,
          type: 'credit',
          currency: 'NGN',
          transactionType: 'TRANSFER',
          status: 'SUCCESS',
          reference: trf_reference,
          description: `Transfer from ${fromAccountType}`,
          account_no: destinationAccount.accountNumber,
          account_name: destinationAccount.accountName,
          account_type: destinationAccountType,
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      }),

      // // Update wallet balance
      // this.prisma.wallet.update({
      //   where: { userId },
      //   data: {
      //     balance: {
      //       decrement: amount,
      //     },
      //   },
      // }),

      // Create activity wallet log
      this.prisma.activityWallet.create({
        data: {
          userId,
          type: 'debit',
          title: 'Account Transfer',
          description: `Transferred ${amount} NGN from ${fromAccountType} to ${destinationAccountType} account`,
          amount,
          currency: 'NGN',
          reference: trf_reference,
          status: 'SUCCESS',
          metadata: {
            fromAccount: fromAccountType,
            toAccount: destinationAccountType,
            fromAccountNumber: sourceAccount.accountNumber,
            toAccountNumber: destinationAccount.accountNumber,
          },
        },
      }),
    ]);

    // Send notification
    await this.notificationService.createNotification(
      userId,
      'Transfer Successful',
      `You have transferred ${amount} NGN from ${fromAccountType} to ${destinationAccountType} account`,
      'money_transfer'
    );

    // Fire socket events for live update
    this.eventEmitter.emit('user.wallet.updated', { userId });
    this.eventEmitter.emit('user.payment.history', { userId });

    return {
      message: 'Transfer successful',
      amount,
      from: fromAccountType,
      to: destinationAccountType,
    };
  }

  async getWalletTransactionByReference(tx_ref: string) {
    return await this.prisma.walletTransaction.findFirst({
      where: { trx_ref: tx_ref },
    });
  }
}
