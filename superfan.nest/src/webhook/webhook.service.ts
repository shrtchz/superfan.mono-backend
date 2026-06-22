import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';
import { NotificationService } from '../notification/notification.service';
import { prisma } from '../prisma/prisma';
import { DisbursementEventDataDto, MonnifyWebhookDto } from './webhook.dto';

@Injectable()
export class MonnifyWebhookService {
  private readonly logger = new Logger(MonnifyWebhookService.name);
  private readonly merchantClientSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
  ) {
    this.merchantClientSecret = process.env.MONNIFY_SECRET_KEY;
  }

  /**
   * Computes HMAC-SHA512 of the raw request body using the merchant client secret.
   * @param rawBody - Raw stringified request body
   * @returns Hex-encoded HMAC-SHA512 hash
   */
  computeHash(rawBody: string): string {
    return createHmac('sha512', this.merchantClientSecret)
      .update(rawBody)
      .digest('hex');
  }

  /**
   * Verifies that the hash in the request header matches the computed hash.
   * @param rawBody - Raw stringified request body
   * @param receivedHash - Hash received in the `monnify-signature` header
   * @throws UnauthorizedException if hashes do not match
   */
  verifySignature(rawBody: string, receivedHash: string): void {
    const computedHash = this.computeHash(rawBody);

    if (computedHash !== receivedHash) {
      this.logger.warn(
        `Webhook signature mismatch. Expected: ${computedHash}, Received: ${receivedHash}`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log('Webhook signature verified successfully');
  }

  /**
   * Processes the verified Monnify webhook payload.
   * Extend this method to handle different event types.
   * @param payload - The parsed webhook payload
   */
  async handleWebhookEvent(payload: any): Promise<void> {
    const { eventType, eventData } = payload;

    this.logger.log(`Processing webhook event: ${eventType}`);

    switch (eventType) {
      case 'SUCCESSFUL_TRANSACTION':
        await this.handleSuccessfulTransaction(eventData);
        break;

      case 'FAILED_TRANSACTION':
        await this.handleFailedTransaction(eventData);
        break;

      case 'REVERSED_TRANSACTION':
        await this.handleReversedTransaction(eventData);
        break;

      case 'MANDATE_UPDATE':
        await this.handleMandateUpdate(eventData);
        break;

      case 'DEBIT_MANDATE':
        await this.handleDebitMandate(eventData);

      case 'SUCCESSFUL_DISBURSEMENT':
        await this.handleSuccessfulDisbursement(
          eventData as DisbursementEventDataDto,
        );
        break;

      case 'FAILED_DISBURSEMENT':
        await this.handleFailedDisbursement(eventData);

      case 'REVERSED_DISBURSEMENT':
        await this.handleReverseDisbursement(eventData);

      case 'SUCCESSFUL_REFUND':
        await this.handleSuccessfulRefund(eventData);

      case 'FAILED_REFUND':
        await this.handleFailedRefund(eventData);

      case 'SETTLEMENT':
        await this.handleSettlement(eventData);

      case 'REJECTED_PAYMENT':
        await this.handleRejectedPayment(eventData);

      case 'ACCOUNT_ACTIVITY':
        await this.handleAccountActivity(eventData);

      case 'LOW_BALANCE_ALERT':
        await this.handleLowBalanceAlert(eventData);

      default:
        this.logger.warn(`Unhandled webhook event type: ${eventType}`);
    }
  }

//   private async handleSuccessfulTransaction(
//     eventData: MonnifyWebhookDto['eventData'],
//   ): Promise<void> {
//     this.logger.log(
//       `Successful transaction: ${eventData.transactionReference}`,
//     );

//     const accountNumber =
//       eventData.destinationAccountInformation?.accountNumber;

//     if (!accountNumber) {
//       this.logger.warn('No account number in webhook payload');
//       return;
//     }

//     // 🔍 Find user by account number inside JSON field
//     const user = await prisma.$queryRaw<{ id: number }[]>`
//   SELECT id FROM "User"
//   WHERE accounts::jsonb @> ${JSON.stringify([{ accountNumber }])}::jsonb
//   LIMIT 1
// `;

//     if (!user) {
//       this.logger.warn(`No user found for account number: ${accountNumber}`);
//       return;
//     }

//     const amount = Number(eventData.amountPaid);
//     const reference = eventData.paymentReference;

//     // ⚠️ Prevent duplicate credit (VERY IMPORTANT)
//     const existingTx = await prisma.walletTransaction.findFirst({
//       where: { reference },
//     });

//     if (existingTx) {
//       this.logger.warn(`Duplicate transaction ignored: ${reference}`);
//       return;
//     }

//     console.log(user[0].id, 'log user id')


//     await prisma.$transaction([
//       // console.log(user[0].id, 'log user wallet id'),
//       // 💰 Update Wallet Balance
//       prisma.wallet.update({
//         where: { userId: user[0].id },
//         data: { balance: { increment: amount } },
//       }),

//       // 🧾 Wallet Transaction
//       prisma.walletTransaction.create({
//         data: {
//           userId: user[0].id,
//           amount,
//           type: 'CREDIT',
//           transactionType: 'FUNDING',
//           status: 'SUCCESS',
//           reference,
//           payment_method: eventData.paymentMethod,
//           account_name: eventData.customer?.name,
//           bank_name: eventData.destinationAccountInformation?.bankName,
//           account_no: accountNumber,
//           description: 'Money added to wallet',
//         },
//       }),

//       // 📊 Activity Wallet
//       prisma.activityWallet.create({
//         data: {
//           userId: user[0].id,
//           type: 'CREDIT',
//           title: 'Money Added',
//           description: 'Money added to wallet',
//           amount,
//           currency: eventData.currency,
//           reference,
//           status: 'SUCCESS',
//           metadata: {
//             paymentMethod: eventData.paymentMethod,
//             bankName: eventData.destinationAccountInformation?.bankName,
//           },
//         },
//       }),
//     ]);

//     this.logger.log(
//       `Wallet credited for user ${user[0].id} | Amount: ${amount}`,
//     );
//   }

private async handleSuccessfulTransaction(
  eventData: MonnifyWebhookDto['eventData'],
): Promise<void> {
  this.logger.log(
    `Successful transaction: ${eventData.transactionReference}`,
  );

  const accountNumber =
    eventData.destinationAccountInformation?.accountNumber;

  if (!accountNumber) {
    this.logger.warn('No account number in webhook payload');
    return;
  }

  const amount = Number(eventData.amountPaid);
  const currency = eventData.currency || 'NGN';

  // 1. FIRST: resolve bank transfer
const bankTransfer = await prisma.bankTransfer.findFirst({
  where: {
    accountNumber,
    OR: [
      { paymentReference: eventData.paymentReference },
      { transactionReference: eventData.transactionReference },
    ],
  },
  include: { user: true },
});

if (bankTransfer) {
  this.logger.log(
    `Matched BankTransfer | User: ${bankTransfer.userId}`,
  );

  if (bankTransfer.status === 'PAID') {
    this.logger.warn(`Duplicate ignored: ${eventData.paymentReference}`);
    return;
  }

  const paymentStatus = eventData.paymentStatus;
  // Map payment status to valid BankTransferStatus enum values
  // Note: 'SUCCESS' requires migration 20260603124718 to be applied
  const mappedStatus = paymentStatus === 'PAID' ? 'PAID' : (paymentStatus || 'PENDING');

  await prisma.$transaction([
    prisma.bankTransfer.update({
      where: { id: bankTransfer.id },
      data: {
        status: mappedStatus,
        paidAt: paymentStatus === 'PAID' ? (eventData.paidOn ? new Date(eventData.paidOn) : new Date()) : null,
        completedAt: paymentStatus === 'PAID' ? new Date() : null,
      },
    }),

    prisma.walletTransaction.create({
      data: {
        userId: bankTransfer.userId,
        amount: amount,
        type: 'credit',
        transactionType: 'FUNDING',
        status: paymentStatus === 'PAID' ? 'SUCCESS' : 'PENDING',
        reference: eventData.paymentReference,
        payment_method: eventData.paymentMethod,
        account_name: bankTransfer.accountName,
        bank_name: bankTransfer.bankName,
        account_no: bankTransfer.accountNumber,
        account_type: 'personal',
        trx_ref: `${generateFiveUniqueRandomNumbers()}`
      },
    }),

    prisma.activityWallet.create({
      data: {
        userId: bankTransfer.userId,
        type: 'credit',
        title: 'Bank Transfer Funding',
        description: 'Money funded via bank transfer',
        amount: amount,
        currency: currency,
        reference: eventData.paymentReference,
        status: paymentStatus === 'PAID' ? 'SUCCESS' : 'PENDING',
        metadata: {
          bankName: bankTransfer.bankName,
          accountNumber: bankTransfer.accountNumber,
        },
      },
    }),
  ]);

    await this.notificationService.createNotification(
      bankTransfer.userId,
      'Wallet Credited',
      `Your wallet has been credited with ${currency} ${amount}`,
      'wallet_credited'
    );

  return;
}

  // 🔍 Fetch user WITH accounts
  const users = await prisma.$queryRaw<
    { id: number; accounts: any[] }[]
  >`
    SELECT id, accounts FROM "User"
    WHERE accounts::jsonb @> ${JSON.stringify([{ accountNumber }])}::jsonb
    LIMIT 1
  `;

  if (!users || users.length === 0) {
    this.logger.warn(`No user found for account number: ${accountNumber}`);
    return;
  }

  console.log(eventData.destinationAccountInformation?.accountNumber, 'log account number in webhook');

  const user = users[0];

  // 🔎 Find the exact matching account
  const matchedAccount = user.accounts?.find(
    (acc) => acc.accountNumber === accountNumber,
  );

  console.log(matchedAccount, 'log matches accounts')

  if (!matchedAccount) {
    this.logger.warn(
      `Account match failed for user ${user.id} | account: ${accountNumber}`,
    );
    return;
  }

  console.log(eventData.destinationAccountInformation?.accountNumber, 'log account number in webhook');

  const accountType = matchedAccount.accountType;

  const reference = eventData.paymentReference;
  const paymentMethod = eventData.paymentMethod;
  const bankName = eventData.destinationAccountInformation?.bankName;
  const accountName = eventData.customer?.name;

  const existingTx = await prisma.walletTransaction.findFirst({
    where: { reference },
  });

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.id },
  });

  if (!wallet) {
    this.logger.warn(`Wallet not found for user ${user.id}`);
    return;
  }

  if (existingTx) {
    if (existingTx.status === 'SUCCESS') {
      this.logger.warn(`Duplicate transaction ignored: ${reference}`);
      return;
    }

    const isDebit = existingTx.type === 'DEBIT';

    if (isDebit && wallet.balance < amount) {
      this.logger.error(
        `Insufficient wallet balance to complete debit for user ${user.id} | Amount: ${amount}`,
      );
      return;
    }

    this.logger.log(
      `Processing existing ${isDebit ? 'debit' : 'credit'} transaction | User: ${user.id} | Reference: ${reference} | Amount: ${amount}`,
    );

    await prisma.$transaction([
      prisma.wallet.update({
        where: { userId: user.id },
        data: {
          balance: isDebit
            ? { decrement: amount }
            : { increment: amount },
        },
      }),

      prisma.walletTransaction.update({
        where: { id: existingTx.id },
        data: {
          status: 'SUCCESS',
          payment_method: paymentMethod,
          account_name: accountName,
          bank_name: bankName,
          account_no: accountNumber,
          account_type: accountType,
          transactionType:
            existingTx.transactionType ??
            (isDebit ? 'WITHDRAWAL' : 'FUNDING'),
        },
      }),

      prisma.activityWallet.updateMany({
        where: { reference },
        data: {
          status: 'SUCCESS',
        },
      }),
    ]);




    await this.notificationService.createNotification(
      user.id,
      isDebit ? 'Wallet Debited' : 'Wallet Credited',
      `Your wallet has been ${isDebit ? 'debited' : 'credited'} with ${currency} ${amount}`,
    );

    this.logger.log(
      `Wallet ${isDebit ? 'debited' : 'credited'} successfully | User: ${user.id} | Amount: ${amount} | Reference: ${reference}`,
    );

    return;
  }

  this.logger.log(
    `Processing wallet funding | User: ${user.id} | AccountType: ${accountType} | Amount: ${amount}`,
  );

  await prisma.$transaction([
    // 💰 Update Wallet Balance (⚠️ still single wallet per user)
    prisma.wallet.update({
      where: { userId: user.id },
      data: {
        balance: { increment: amount },
      },
    }),

    // 🧾 Wallet Transaction
    prisma.walletTransaction.create({
      data: {
        userId: user.id,
        amount,
        type: 'credit',
        transactionType: 'FUNDING',
        status: 'SUCCESS',
        reference,
        payment_method: paymentMethod,
        account_name: accountName,
        bank_name: bankName,
        account_no: accountNumber,
        account_type: accountType,
        description: `Money added to wallet`,
        trx_ref: `${generateFiveUniqueRandomNumbers()}`
      },
    }),

    // 📊 Activity Wallet
    prisma.activityWallet.create({
      data: {
        userId: user.id,
        type: 'credit',
        title: 'Money Added',
        description: `Money added to wallet`,
        amount,
        currency: eventData.currency,
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

  await this.notificationService.createNotification(
    user.id,
    'Wallet Credited',
    `Your wallet has been credited with ${eventData.currency || 'NGN'} ${amount}`,
    'wallet_credit'
  );

  this.logger.log(
    `Wallet credited successfully | User: ${user.id} | AccountType: ${accountType} | Amount: ${amount}`,
  );
}

  private async handleFailedTransaction(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Failed transaction: ${eventData.transactionReference}`);
    // TODO: notify customer, log failure reason, etc.

    console.log(eventData, 'handle failed transaction');
  }

  private async handleLowBalanceAlert(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Failed transaction: ${eventData.transactionReference}`);
    // TODO: notify customer, log failure reason, etc.

    console.log(eventData, 'handle low balance alert');
  }

  private async handleAccountActivity(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Failed transaction: ${eventData.transactionReference}`);
    // TODO: notify customer, log failure reason, etc.

    console.log(eventData, 'handle account activity');
  }

  private async handleRejectedPayment(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Failed transaction: ${eventData.transactionReference}`);
    // TODO: notify customer, log failure reason, etc.

    console.log(eventData, 'handle rejected payment');
  }

  private async handleSettlement(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Failed transaction: ${eventData.transactionReference}`);
    // TODO: notify customer, log failure reason, etc.

    console.log(eventData, 'handle failed transaction');
  }

  private async handleFailedRefund(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Failed transaction: ${eventData.transactionReference}`);
    // TODO: notify customer, log failure reason, etc.

    console.log(eventData, 'handle failed transaction');
  }

  private async handleMandateUpdate(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    try {
      this.logger.warn(`Mandate update received`);

      const { externalMandateReference, mandateCode, mandateStatus } =
        eventData;

      console.log(eventData, 'mandate update data');

      // Validate required fields
      if (!externalMandateReference || !mandateCode) {
        this.logger.error('Missing mandate reference or mandate code');
        return;
      }

      // Find subscription
      const subscription = await prisma.subscription.findFirst({
        where: {
          mandateReference: externalMandateReference,
          mandateCode: mandateCode,
        },
      });

      if (!subscription) {
        this.logger.error(
          `Subscription not found for mandateReference=${externalMandateReference} and mandateCode=${mandateCode}`,
        );
        return;
      }

      let newPlan = subscription.subscriptionPlan;

      // Update subscription status
      await prisma.subscription.update({
        where: {
          id: subscription.id,
        },
        data: {
          status: mandateStatus, // mapping mandateStatus -> subscription.status
        },
      });

      await prisma.user.update({
        where: {
          id: subscription.userId,
        },
        data: {
          subscriptionPlan: newPlan,
        },
      });

      this.logger.log(
        `Subscription ${subscription.id} updated to status: ${mandateStatus}`,
      );
    } catch (error) {
      this.logger.error('Error handling mandate update', error);
    }
  }

  private async handleDebitMandate(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    try {
      this.logger.warn(
        `Debit mandate received ${eventData.transactionReference}`,
      );

      console.log(eventData, 'handle debit mandate');
    } catch (error) {
      this.logger.error('Error handling debit mandate', error);
    }
  }

  private async handleReversedTransaction(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Reversed transaction: ${eventData.transactionReference}`);
    console.log(eventData, 'reversed transaction data');
    // TODO: reverse any credits applied, notify customer, etc.
  }

  // handleReverseDisbursement

  private async handleReverseDisbursement(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(
      `Reversed disbursement: ${eventData.transactionReference}`,
    );
    console.log(eventData, 'reversed transaction data');
    // TODO: reverse any credits applied, notify customer, etc.
  }

  // handleSuccessfulRefund

  private async handleSuccessfulRefund(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(
      `Reversed disbursement: ${eventData.transactionReference}`,
    );
    console.log(eventData, 'reversed transaction data');
    // TODO: reverse any credits applied, notify customer, etc.
  }

  private async handleFailedDisbursement(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(
      `failed disbursement transaction: ${eventData.transactionReference}`,
    );
    console.log(eventData, 'reversed transaction data');
    // TODO: reverse any credits applied, notify customer, etc.
  }

  private async handleMandate(
    eventData: MonnifyWebhookDto['eventData'],
  ): Promise<void> {
    this.logger.warn(`Reversed transaction: ${eventData.transactionReference}`);
    // TODO: reverse any credits applied, notify customer, etc.
  }

  // private async handleSuccessfulDisbursement(
  //   eventData: DisbursementEventDataDto,
  // ): Promise<void> {
  //   this.logger.log(
  //     `Successful disbursement: ${eventData.transactionReference} | ` +
  //       `Ref: ${eventData.reference} | ` +
  //       `Amount: ${eventData.amount} ${eventData.currency} | ` +
  //       `Destination: ${eventData.destinationAccountName} (${eventData.destinationAccountNumber})`,
  //   );

  //   const subscription = await prisma.subscription.findFirst({
  //     where: { mandateReference: eventData.reference },
  //   });

  //   if (!subscription) {
  //     this.logger.warn(
  //       `No subscription found for mandateReference: ${eventData.reference}`,
  //     );
  //     return;
  //   }

  //   if (eventData.amount === 50) {
  //     await prisma.subscription.update({
  //       where: { id: subscription.id },
  //       data: { status: 'ACTIVE' },
  //     });
  //     this.logger.log(
  //       `Subscription ${subscription.id} (mandateReference: ${eventData.reference}) set to ACTIVE`,
  //     );
  //   } else {
  //     this.logger.warn(
  //       `Disbursement amount ${eventData.amount} does not meet threshold for subscription ${subscription.id}`,
  //     );
  //   }
  // }

  private async handleSuccessfulDisbursement(
  eventData: DisbursementEventDataDto,
): Promise<void> {
  this.logger.log(
    `Successful disbursement: ${eventData.transactionReference} | ` +
      `Ref: ${eventData.reference} | ` +
      `Amount: ${eventData.amount} ${eventData.currency} | ` +
      `Destination: ${eventData.destinationAccountName} (${eventData.destinationAccountNumber})`,
  );

  try {
    /**
     * -----------------------------
     * HANDLE SUBSCRIPTION ACTIVATION
     * -----------------------------
     */
    const subscription = await prisma.subscription.findFirst({
      where: {
        mandateReference: eventData.reference,
      },
    });

    if (subscription) {
      if (Number(eventData.amount) === 50) {
        await prisma.subscription.update({
          where: {
            id: subscription.id,
          },
          data: {
            status: 'ACTIVE',
          },
        });

        this.logger.log(
          `Subscription ${subscription.id} activated successfully`,
        );
      } else {
        this.logger.warn(
          `Subscription ${subscription.id} amount mismatch: ${eventData.amount}`,
        );
      }
    }

    /**
     * -----------------------------
     * HANDLE WALLET FUNDING
     * -----------------------------
     */
    const bankTransfer = await prisma.bankTransfer.findFirst({
      where: {
        OR: [
          {
            paymentReference: eventData.reference,
          },
          {
            transactionReference: eventData.transactionReference,
          },
          {
            accountNumber: eventData.destinationAccountNumber,
          },
        ],
      },
      include: {
        user: {
          include: {
            wallet: true,
          },
        },
      },
    });

    if (!bankTransfer) {
      this.logger.warn(
        `No bank transfer found for reference: ${eventData.reference}`,
      );
      return;
    }

    /**
     * Prevent duplicate processing
     */
    if (bankTransfer.status === 'PAID') {
      this.logger.warn(
        `Bank transfer already processed: ${bankTransfer.transactionReference}`,
      );
      return;
    }

    await prisma.$transaction(async (tx) => {
      /**
       * Update bank transfer
       */
      await tx.bankTransfer.update({
        where: {
          id: bankTransfer.id,
        },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          completedAt: eventData.completedOn
            ? new Date(eventData.completedOn)
            : new Date(),
        },
      });

      /**
       * Ensure wallet exists
       */
      let wallet = bankTransfer.user.wallet;

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: bankTransfer.userId,
            balance: 0,
          },
        });
      }

      /**
       * Credit wallet
       */
      const updatedWallet = await tx.wallet.update({
        where: {
          id: wallet.id,
        },
        data: {
          balance: {
            increment: Number(eventData.amount),
          },
        },
      });

      /**
       * Wallet transaction
       */
      await tx.walletTransaction.create({
        data: {
          userId: bankTransfer.userId,
          walletId: wallet.id,

          amount: Number(eventData.amount),

          type: 'CREDIT',
          transactionType: 'BANK_TRANSFER',
          payment_method: 'BANK_TRANSFER',

          account_name: eventData.destinationAccountName,
          account_no: eventData.destinationAccountNumber,
          bank_name: eventData.destinationBankName,

          reference: eventData.reference,
          trx_ref: `${generateFiveUniqueRandomNumbers()}`,

          status: 'SUCCESS',

          description:
            eventData.transactionDescription ||
            'Wallet funded via bank transfer',

          payment_date: new Date(),
        },
      });

      /**
       * Activity wallet log
       */
      await tx.activityWallet.create({
        data: {
          userId: bankTransfer.userId,

          type: 'credit',

          title: 'Wallet Funded',

          description: `₦${eventData.amount} credited via ${eventData.destinationBankName}`,

          amount: Number(eventData.amount),

          currency: eventData.currency || 'NGN',

          reference: eventData.reference,

          status: 'SUCCESS',

          metadata: {
            bankTransferId: bankTransfer.id,
            transactionReference: eventData.transactionReference,
            paymentReference: eventData.reference,
            bankName: eventData.destinationBankName,
            accountNumber: eventData.destinationAccountNumber,
            accountName: eventData.destinationAccountName,
          },
        },
      });

      this.logger.log(
        `Wallet credited successfully for user ${bankTransfer.userId}. Balance: ${updatedWallet.balance}`,
      );
    });
  } catch (error) {
    this.logger.error(
      `Failed processing disbursement webhook: ${eventData.reference}`,
      error,
    );

    throw error;
  }
}
}
