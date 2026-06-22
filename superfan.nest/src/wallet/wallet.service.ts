import { Injectable } from '@nestjs/common';
import { EarningStatus } from '../common/enums/task.enum';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';
import { PrismaService } from '../config/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MonnifyService } from '../payment/monnify.service';
import { prisma } from '../prisma/prisma';


@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService, private monnifyService: MonnifyService, private notificationService: NotificationService) {}
  async creditWallet(userId: number, amount: number, title: string, description: string) {
    await prisma.wallet.update({
      where: { userId },
      data: {
        balance: {
          increment: amount,
        },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        user: {
          connect: { id: userId },
        },
        amount,
        type: 'credit',
        description,
        trx_ref: `${generateFiveUniqueRandomNumbers()}`
      },
    });

          await prisma.activityWallet.create({
        data: {
          // userId,
            user: {
          connect: { id: userId },
        },
          type: 'credit',
          title,
          description,
          amount,
          currency: 'NGN',
          status: 'SUCCESS',
        },
      });
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


  async createReward(userId: number, amount: number, currency: string, type: string, status: EarningStatus) {
    await this.prisma.reward.create({
      data: {
        userId,
        amount,
        currency,
        type,
        status,
      },
    });

    // Credit the wallet
    await this.creditWallet(userId, amount, `${type} Reward`, `Earned ${amount} ${currency} from ${type}`);

    // Send notification
    await this.notificationService.createNotification(
      userId,
      'Reward Earned',
      `You have earned ${amount} ${currency} from ${type}`,
    );
  }

  async createQuizReward(userId: number, amount: number, currency: string, subject: string, status: EarningStatus, points: number) {
        await this.prisma.reward.create({
      data: {
        userId,
        amount,
        currency,
        type: 'quiz_reward',
        status,
      },
    });

        // Credit the wallet
    await this.creditWallet(userId, amount, `₦${amount} has  been added to your wallet`, `You earned ${amount} from Quiz`);

    await this.prisma.point.create({
      data: {
        userId,
        points,
        reference: `POINTS_${generateFiveUniqueRandomNumbers()}`,
        type: 'quiz_reward',
      }
    });

    // Send notification
    await this.notificationService.createNotification(
      userId,
      `₦${amount} has  been added to your wallet`,
      `You earned ₦${amount} from ${subject} Quiz`,
      'quiz_reward'
    );

        await this.notificationService.createNotification(
      userId,
      `you earned ${points}PTS🎮`,
      // `₦${amount} has  been added to your wallet`,
      `from ${subject} Quiz`,
      'quiz_reward'
    );
  }

  async createLiveQuizReward(userId: number, amount: number, status: EarningStatus) {
            await this.prisma.reward.create({
      data: {
        userId,
        amount,
        currency: 'NGN',
        type: 'live_quiz_reward',
        status,
      },
    });

    await this.creditWallet(userId, amount, `₦${amount} has  been added to your wallet`, `You earned ${amount} from Live Quiz`);

        await this.notificationService.createNotification(
      userId,
      `₦${amount} has  been added to your wallet`,
      `You earned ₦${amount} from Live Quiz`,
      'live_quiz_reward'
    );
  }


async getUserWalletTransactions(
  userId?: number,
  accountType?: string,
) {
  return await this.prisma.walletTransaction.findMany({
    where: {
      ...(userId && { userId }),
      ...(accountType && { account_type: accountType }),
    },
    orderBy: { id: 'desc' },
  });
}

  async getWalletTransactionsbyId(id: number) {
    return await this.prisma.walletTransaction.findMany({
      where: { id },
    });
  }

  async fundWalletWithCard(userId: number, transactionReference: string) {
    // Get transaction details from Monnify
    const transaction = await this.monnifyService.getTransactionByReference(transactionReference);

    if (!transaction || transaction.responseBody?.paymentStatus !== 'PAID') {
      throw new Error('Transaction not found or not successful');
    }

    const amount = Number(transaction.responseBody.amountPaid);
    const reference = transaction.responseBody.paymentReference || transactionReference;
    const paymentMethod = transaction.responseBody.paymentMethod;
    // const currency = transaction.responseBody.currency;
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

    // Get user accounts to find accountType
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accounts: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const accounts = user.accounts as any[];
    const matchedAccount = accounts?.find(
      (acc: any) => acc.accountNumber === accountNumber,
    );

    const accountType = matchedAccount?.accountType

    await this.prisma.$transaction([
      // Update wallet balance
      this.prisma.wallet.update({
        where: { userId },
        data: { balance: { increment: amount } },
      }),

      // Create wallet transaction
      this.prisma.walletTransaction.create({
        data: {
          userId,
          amount,
          type: 'credit',
          transactionType: 'FUNDING',
          status: 'SUCCESS',
          reference,
          payment_method: paymentMethod,
          account_name: customerName,
          bank_name: bankName,
          account_no: accountNumber,
          account_type: 'Personal',
          description: 'Wallet funded with card',
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      }),

      // Create activity wallet
      this.prisma.activityWallet.create({
        data: {
          userId,
          type: 'credit',
          title: 'Card Funding',
          description: 'Wallet funded with card',
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
      this.prisma.walletTransaction.create({
        data: {
          userId,
          amount,
          type: 'debit',
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
      this.prisma.walletTransaction.create({
        data: {
          userId,
          amount,
          type: 'credit',
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
