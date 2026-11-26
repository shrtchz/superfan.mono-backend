import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';
import { MailService } from '../mail/mail.service';
import { ClerkService } from '../common/clerk/clerk.service';
import { NotificationService } from '../notification/notification.service';
import { prisma } from '../prisma/prisma';
import { WalletService } from '../wallet/wallet.service';
import { DisbursementEventDataDto, MonnifyWebhookDto } from './webhook.dto';

@Injectable()
export class MonnifyWebhookService {
  private readonly logger = new Logger(MonnifyWebhookService.name);
  private readonly merchantClientSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly walletService: WalletService,
    private readonly mailService: MailService,
    private readonly clerkService: ClerkService,
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
    if (!this.merchantClientSecret || !this.merchantClientSecret.trim()) {
      this.logger.error('Monnify webhook secret is not configured');
      throw new UnauthorizedException('Webhook secret not configured');
    }
    const computedHash = this.computeHash(rawBody).toLowerCase();
    const receivedLower = String(receivedHash || '').trim().toLowerCase();
    const a = Buffer.from(computedHash, 'utf8');
    const b = Buffer.from(receivedLower, 'utf8');

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Monnify webhook signature mismatch');
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
    `Matched BankTransfer | User: ${bankTransfer.userId} | PaymentStatus: ${eventData.paymentStatus}`,
  );

  if (bankTransfer.status === 'PAID') {
    this.logger.warn(`Duplicate ignored: ${eventData.paymentReference}`);
    return;
  }

  const paymentStatus = eventData.paymentStatus;
  const mappedStatus = paymentStatus === 'PAID' ? 'PAID' : (paymentStatus || 'PENDING');

  if (paymentStatus === 'PAID') {
    await prisma.$transaction([
      prisma.bankTransfer.update({
        where: { id: bankTransfer.id },
        data: {
          status: 'PAID',
          paidAt: eventData.paidOn ? new Date(eventData.paidOn) : new Date(),
          completedAt: new Date(),
        },
      }),

      prisma.wallet.update({
        where: { userId: bankTransfer.userId },
        data: {
          balance: { increment: amount },
          checkingBalance: { increment: amount },
        },
      }),

      prisma.walletTransaction.create({
        data: {
          userId: bankTransfer.userId,
          amount: amount,
          type: 'credit',
          transactionType: 'FUNDING',
          status: 'SUCCESS',
          reference: eventData.paymentReference,
          payment_method: eventData.paymentMethod || 'ACCOUNT_TRANSFER',
          account_name: bankTransfer.accountName,
          bank_name: bankTransfer.bankName,
          account_no: bankTransfer.accountNumber,
          account_type: 'checking',
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      }),

      prisma.activityWallet.create({
        data: {
          userId: bankTransfer.userId,
          type: 'credit',
          title: 'Deposit - Bank Transfer',
          description: 'Deposit - Bank Transfer',
          amount: amount,
          currency: currency,
          reference: eventData.paymentReference,
          status: 'SUCCESS',
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
  } else {
    this.logger.warn(`BankTransfer not paid (status: ${paymentStatus}), updating status without crediting wallet`);
    await prisma.bankTransfer.update({
      where: { id: bankTransfer.id },
      data: {
        status: mappedStatus,
      },
    });
  }

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

    let notificationTitle = "Deposit - Bank Transfer";
    if (String(paymentMethod).toUpperCase().includes("CARD")) {
      notificationTitle = "Deposit - Debit Card";
    } else if (String(paymentMethod).toUpperCase().includes("CRYPTO") || String(paymentMethod).toUpperCase().includes("STABLE")) {
      notificationTitle = "Deposit - Stablecoin";
    }

    await prisma.$transaction([
      // 💰 Update Wallet Balance (⚠️ still single wallet per user)dddd
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
          description: notificationTitle,
          holdUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      }),

      // 📊 Activity Wallet
      prisma.activityWallet.create({
        data: {
          userId: user.id,
          type: 'credit',
          title: notificationTitle,
          description: notificationTitle,
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
    // ⚠️ Payment Failed. Tap to retry. — resolve payer from payment reference
    try {
      const reference = eventData?.paymentReference || eventData?.transactionReference;
      if (reference) {
        const existingTx = await prisma.walletTransaction.findFirst({
          where: { reference },
          select: { userId: true },
        });
        if (existingTx?.userId) {
          await this.notificationService.paymentFailed(existingTx.userId);
        }
      }
    } catch {
      // notifications must never break webhook processing
    }

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
    // ⚠️ Payment Failed. Tap to retry.
    try {
      const reference = eventData?.paymentReference || eventData?.transactionReference;
      if (reference) {
        const existingTx = await prisma.walletTransaction.findFirst({
          where: { reference },
          select: { userId: true },
        });
        if (existingTx?.userId) {
          await this.notificationService.paymentFailed(existingTx.userId);
        }
      }
    } catch {
      // notifications must never break webhook processing
    }

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
    try {
      const payout = await prisma.payout.findFirst({
        where: {
          OR: [
            { reference: eventData.reference },
            { reference: eventData.transactionReference },
            { providerRef: eventData.reference },
            { providerRef: eventData.transactionReference },
          ],
        },
      });
      if (payout) {
        await this.notificationService
          .withdrawalFailed(payout.userId)
          .catch(() => undefined);
      }
    } catch (error) {
      this.logger.error('Failed disbursement notification error', error);
    }
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
            'Deposit - Bank Transfer',

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

          title: 'Deposit - Bank Transfer',

          description: 'Deposit - Bank Transfer',

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

  /**
   * Verifies Clerk webhook signature using svix headers and CLERK_WEBHOOK_SECRET.
   */
  async verifyClerkWebhook(
    rawBody: string,
    headers: {
      'svix-id'?: string;
      'svix-timestamp'?: string;
      'svix-signature'?: string;
    },
  ): Promise<any> {
    const webhookSecret =
      this.configService.get<string>('CLERK_WEBHOOK_SECRET') ||
      process.env.CLERK_WEBHOOK_SECRET;

    if (!webhookSecret) {
      this.logger.error('CLERK_WEBHOOK_SECRET is not configured in server environment');
      throw new UnauthorizedException('CLERK_WEBHOOK_SECRET is not configured');
    }

    const svixId = headers['svix-id'];
    const svixTimestamp = headers['svix-timestamp'];
    const svixSignature = headers['svix-signature'];

    if (!svixId || !svixTimestamp || !svixSignature) {
      this.logger.warn('Missing required Svix headers in Clerk webhook');
      throw new UnauthorizedException('Missing Svix signature headers');
    }

    try {
      // @ts-ignore
      const { Webhook } = await import('svix');
      const wh = new Webhook(webhookSecret);
      wh.verify(rawBody, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
      ////////////////dsdsds
      const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      return parsed;
    } catch (err: any) {
      this.logger.warn('Clerk webhook signature verification failed: ' + err.message);
      throw new UnauthorizedException('Invalid Clerk webhook signature: ' + err.message);
    }
  }

  /**
   * Handles verified Clerk webhook events (e.g. emails.created).
   */
  async handleClerkWebhookEvent(event: any): Promise<any> {
    const eventType = event?.type;
    this.logger.log(`[Clerk Webhook] Processing event: "${eventType}"`);

    if (eventType === 'email.created' || eventType === 'emails.created') {
      const emailData = event.data || {};
      const toEmail =
        emailData.to_email_address ||
        emailData.email_address ||
        emailData.to ||
        emailData.data?.to_email_address ||
        emailData.data?.email_address;

      if (!toEmail) {
        this.logger.warn(`[Clerk Webhook] "${eventType}" received but no to_email_address found in payload: ${JSON.stringify(emailData)}`);
        return { received: true, handled: false, reason: 'missing_email' };
      }

      // Extract 6-digit OTP code from data object, subject, or text body
      let otpCode: string | undefined =
        emailData.data?.otp_code ||
        emailData.data?.otp ||
        emailData.data?.code ||
        emailData.otp ||
        emailData.code;

      if (!otpCode && typeof emailData.body_plain === 'string') {
        const match = emailData.body_plain.match(/\b\d{6}\b/);
        if (match) otpCode = match[0];
      }

      if (!otpCode && typeof emailData.subject === 'string') {
        const match = emailData.subject.match(/\b\d{6}\b/);
        if (match) otpCode = match[0];
      }

      if (!otpCode && typeof emailData.body === 'string') {
        const match = emailData.body.match(/\b\d{6}\b/);
        if (match) otpCode = match[0];
      }

      if (!otpCode) {
        this.logger.warn(
          `[Clerk Webhook] "${eventType}" for ${toEmail} could not extract OTP code. Payload: ${JSON.stringify(emailData)}`,
        );
        return { received: true, handled: false, reason: 'otp_not_found' };
      }

      // Determine recipient's first name
      let firstName: string =
        emailData.data?.first_name ||
        emailData.data?.firstName ||
        '';

      if (!firstName) {
        try {
          const user = await prisma.user.findFirst({
            where: { email: { equals: toEmail, mode: 'insensitive' } },
            select: { firstName: true },
          });
          if (user?.firstName) {
            firstName = user.firstName;
          }
        } catch {
          // ignore lookup error
        }
      }

      if (!firstName) {
        firstName = toEmail.split('@')[0] || 'Superfan';
      }

      this.logger.log(
        `[Clerk Webhook] Extracted toEmail="${toEmail}", OTP="${otpCode}", firstName="${firstName}". Queueing email via mailService...`,
      );

      const job = await this.mailService.verifyEmail(toEmail, otpCode, firstName);

      this.logger.log(`[Clerk Webhook] mailService.verifyEmail completed. BullMQ Job ID: ${job?.id || 'queued'}`);

      return { received: true, handled: true, event: eventType, to: toEmail, otp: otpCode, jobId: job?.id };
    }

    if (eventType === 'user.created' || eventType === 'user.updated') {
      const userData = event.data || {};
      const clerkUserId = userData.id;
      const emailAddresses: any[] = userData.email_addresses || [];
      const primaryEmailId = userData.primary_email_address_id;

      const primaryObj = emailAddresses.find((e: any) => e.id === primaryEmailId) || emailAddresses[0];
      const verifiedObj = emailAddresses.find((e: any) => e.verification?.status === 'verified');
      const targetEmailObj = verifiedObj || primaryObj;
      const toEmail = targetEmailObj?.email_address;
      const isEmailVerified = Boolean(
        targetEmailObj?.verification?.status === 'verified' ||
        emailAddresses.some((e: any) => e.verification?.status === 'verified')
      );

      this.logger.log(
        `[Clerk Webhook] ${eventType} for clerkUserId="${clerkUserId}", email="${toEmail}", isEmailVerified=${isEmailVerified}`,
      );

      if (!toEmail || !isEmailVerified) {
        this.logger.log(`[Clerk Webhook] Skipping welcome email: email missing or not yet verified`);
        return { received: true, handled: false, reason: 'not_verified_or_no_email' };
      }

      const publicMetadata = userData.public_metadata || {};
      if (publicMetadata.welcomeEmailSent) {
        this.logger.log(`[Clerk Webhook] Welcome email already sent for clerkUserId="${clerkUserId}"`);
        return { received: true, handled: false, reason: 'already_sent' };
      }

      let firstName =
        userData.first_name ||
        userData.firstName ||
        '';

      if (!firstName && toEmail) {
        try {
          const dbUser = await prisma.user.findFirst({
            where: { email: { equals: toEmail, mode: 'insensitive' } },
            select: { firstName: true },
          });
          if (dbUser?.firstName) firstName = dbUser.firstName;
        } catch {
          // ignore lookup error
        }
      }

      if (!firstName && toEmail) {
        firstName = toEmail.split('@')[0] || 'Superfan';
      }

      const frontendUrl = process.env.FRONTEND_URL || 'https://superfan.ng';
      const loginUrl = `${frontendUrl.replace(/\/+$/, '')}/sign-in`;

      this.logger.log(`[Clerk Webhook] Queueing welcome email for ${toEmail}...`);
      const job = await this.mailService.welcomeUserEmail(toEmail, firstName, loginUrl);

      if (clerkUserId && this.clerkService) {
        try {
          await this.clerkService.getClient().users.updateUser(clerkUserId, {
            publicMetadata: {
              ...publicMetadata,
              welcomeEmailSent: true,
            },
          });
          this.logger.log(`[Clerk Webhook] Marked welcomeEmailSent=true in Clerk publicMetadata for ${clerkUserId}`);
        } catch (err: any) {
          this.logger.warn(`[Clerk Webhook] Failed to update Clerk publicMetadata: ${err?.message}`);
        }
      }

      return { received: true, handled: true, event: eventType, to: toEmail, jobId: job?.id };
    }

    this.logger.warn(`[Clerk Webhook] Ignored unhandled event type: "${eventType}"`);
    return { received: true, handled: false, event: eventType };
  }

  /**
   * Processes Bachs webhook events (bank transfer collections, virtual account credits)
   */
  async handleBachsWebhookEvent(
    payload: any,
    signature?: string,
    rawBody?: string,
  ): Promise<void> {
    // 1. Primary source: PaymentProcessor record configured via superfan.admin
    const dbProcessor = await prisma.paymentProcessor.findFirst({
      where: { name: { equals: 'bachs', mode: 'insensitive' } },
    });
    const bachsSecret =
      dbProcessor?.secretKey ||
      process.env.BACHS_WEBHOOK_SECRET ||
      process.env.BACHS_SECRET_KEY;
    if (bachsSecret && signature && rawBody) {
      const crypto = require('crypto');
      const hash = crypto
        .createHmac('sha256', bachsSecret)
        .update(rawBody)
        .digest('hex');
      const cleanSig = signature.toLowerCase().replace(/^sha256=/, '');
      if (hash.toLowerCase() !== cleanSig) {
        this.logger.warn(
          `Bachs webhook signature mismatch. Expected: ${hash}, Received: ${signature}`,
        );
        throw new UnauthorizedException('Invalid Bachs webhook signature');
      }
    }

    const event = (
      payload?.event ||
      payload?.type ||
      payload?.action ||
      ''
    ).toLowerCase();
    const data = payload?.data || payload;
    const ref =
      data?.reference ||
      data?.payment_reference ||
      data?.paymentReference ||
      data?.transaction_reference ||
      data?.transactionReference ||
      data?.txRef ||
      data?.tx_ref;
    const accountNumber =
      data?.account_number ||
      data?.accountNumber ||
      data?.virtual_account_number ||
      data?.destination_account_number;
    const amount = Number(
      data?.amount ||
        data?.amount_paid ||
        data?.amountPaid ||
        data?.totalPayable ||
        0,
    );
    const currency = data?.currency || 'NGN';
    const status = (
      data?.status ||
      data?.payment_status ||
      data?.paymentStatus ||
      ''
    ).toLowerCase();

    this.logger.log(
      `Processing Bachs webhook: event=${event}, ref=${ref}, account=${accountNumber}, amount=${amount}, status=${status}`,
    );

    if (
      event.includes('fail') ||
      status.includes('fail') ||
      status.includes('cancel')
    ) {
      this.logger.warn(`Bachs transaction failed: ${ref}`);

      // Check if this failure belongs to a withdrawal
      if (ref) {
        const withdrawalTx = await prisma.walletTransaction.findFirst({
          where: {
            OR: [{ trx_ref: ref }, { reference: ref }],
            AND: [
              {
                OR: [
                  { type: { in: ['debit', 'DEBIT'] } },
                  { transactionType: { in: ['withdrawal', 'WITHDRAWAL', 'Withdrawal'] } },
                ],
              },
            ],
          },
        });

        if (withdrawalTx) {
          this.logger.warn(
            `Bachs withdrawal failed for ref=${ref} (userId=${withdrawalTx.userId}, amount=${withdrawalTx.amount}): refunding user wallet`,
          );
          await prisma.$transaction([
            prisma.walletTransaction.update({
              where: { id: withdrawalTx.id },
              data: { status: 'FAILED' },
            }),
            prisma.activityWallet.updateMany({
              where: { reference: ref },
              data: { status: 'FAILED' },
            }),
            prisma.wallet.update({
              where: { userId: withdrawalTx.userId },
              data: {
                checkingBalance: { increment: withdrawalTx.amount },
                balance: { increment: withdrawalTx.amount },
              },
            }),
          ]);

          try {
            await this.notificationService.createNotification(
              withdrawalTx.userId,
              'Withdrawal Failed',
              `Your withdrawal of ${withdrawalTx.currency || 'NGN'} ${withdrawalTx.amount} failed and has been refunded to your wallet.`,
              'wallet_withdrawal_failed',
            );
          } catch {}
          return;
        }
      }

      if (ref || accountNumber) {
        await prisma.bankTransfer.updateMany({
          where: {
            OR: [
              ...(ref
                ? [{ paymentReference: ref }, { transactionReference: ref }]
                : []),
              ...(accountNumber ? [{ accountNumber }] : []),
            ],
            status: 'PENDING',
          },
          data: { status: 'FAILED' },
        });
      }
      return;
    }

    const isSuccess =
      event.includes('success') ||
      event.includes('succeeded') ||
      event.includes('credited') ||
      event.includes('paid') ||
      [
        'succeeded',
        'success',
        'paid',
        'completed',
        'successful',
      ].includes(status);

    if (!isSuccess) {
      this.logger.log(
        `Bachs non-success event ignored: event=${event}, status=${status}`,
      );
      return;
    }

    // Check if this reference corresponds to a successful WalletTransaction withdrawal
    if (ref) {
      const withdrawalTx = await prisma.walletTransaction.findFirst({
        where: {
          OR: [{ trx_ref: ref }, { reference: ref }],
          AND: [
            {
              OR: [
                { type: { in: ['debit', 'DEBIT'] } },
                { transactionType: { in: ['withdrawal', 'WITHDRAWAL', 'Withdrawal'] } },
              ],
            },
          ],
        },
      });

      if (withdrawalTx) {
        this.logger.log(
          `Bachs withdrawal succeeded for ref=${ref} (userId=${withdrawalTx.userId}, amount=${withdrawalTx.amount})`,
        );
        await prisma.$transaction([
          prisma.walletTransaction.update({
            where: { id: withdrawalTx.id },
            data: { status: 'Completed' },
          }),
          prisma.activityWallet.updateMany({
            where: { reference: ref },
            data: { status: 'SUCCESS' },
          }),
        ]);

        try {
          await this.notificationService.createNotification(
            withdrawalTx.userId,
            'Withdrawal Successful',
            `Your withdrawal of ${withdrawalTx.currency || 'NGN'} ${withdrawalTx.amount} was completed successfully.`,
            'wallet_withdrawal_success',
          );
        } catch {}
        return;
      }
    }

    // 1. First: Try matching BankTransfer record
    let bankTransfer = null;
    if (accountNumber && ref) {
      bankTransfer = await prisma.bankTransfer.findFirst({
        where: {
          accountNumber,
          OR: [{ paymentReference: ref }, { transactionReference: ref }],
        },
      });
    }

    if (!bankTransfer && ref) {
      bankTransfer = await prisma.bankTransfer.findFirst({
        where: {
          OR: [{ paymentReference: ref }, { transactionReference: ref }],
        },
      });
    }

    if (!bankTransfer && accountNumber) {
      bankTransfer = await prisma.bankTransfer.findFirst({
        where: { accountNumber },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (bankTransfer) {
      if (bankTransfer.status === 'PAID') {
        this.logger.warn(
          `Duplicate Bachs webhook ignored: BankTransfer ID=${bankTransfer.id} already PAID`,
        );
        return;
      }

      const creditAmount =
        amount > 0 ? amount : Number(bankTransfer.amount);
      const txRef =
        bankTransfer.transactionReference ||
        bankTransfer.paymentReference ||
        ref ||
        `BACHS-${Date.now()}`;

      await prisma.$transaction([
        prisma.bankTransfer.update({
          where: { id: bankTransfer.id },
          data: {
            status: 'PAID',
            paidAt: data?.paid_at ? new Date(data.paid_at) : new Date(),
            completedAt: new Date(),
          },
        }),
        prisma.wallet.update({
          where: { userId: bankTransfer.userId },
          data: {
            balance: { increment: creditAmount },
            checkingBalance: { increment: creditAmount },
          },
        }),
        prisma.walletTransaction.create({
          data: {
            userId: bankTransfer.userId,
            amount: creditAmount,
            type: 'credit',
            transactionType: 'FUNDING',
            status: 'SUCCESS',
            reference: txRef,
            payment_method: 'bankTransfer',
            account_name: bankTransfer.accountName,
            bank_name: bankTransfer.bankName,
            account_no: bankTransfer.accountNumber,
            account_type: 'checking',
            trx_ref: `${generateFiveUniqueRandomNumbers()}`,
            description: 'Deposit - Bank Transfer (Bachs)',
          },
        }),
        prisma.activityWallet.create({
          data: {
            userId: bankTransfer.userId,
            type: 'credit',
            title: 'Deposit - Bank Transfer',
            description: 'Deposit - Bank Transfer (Bachs)',
            amount: creditAmount,
            currency: currency,
            reference: txRef,
            status: 'SUCCESS',
            metadata: {
              processor: 'bachs',
              bankName: bankTransfer.bankName,
              accountNumber: bankTransfer.accountNumber,
            },
          },
        }),
      ]);

      await this.notificationService.createNotification(
        bankTransfer.userId,
        'Wallet Credited',
        `Your wallet has been credited with ${currency} ${creditAmount} via Bachs bank transfer`,
        'wallet_credited',
      );
      this.logger.log(
        `Bachs BankTransfer processed & credited: userId=${bankTransfer.userId}, amount=${creditAmount}`,
      );
      return;
    }

    // 2. Fallback to direct user account match
    if (accountNumber) {
      const user = await prisma.user.findFirst({
        where: { accountNumber },
      });
      if (user && amount > 0) {
        const txRef = ref || `BACHS-${Date.now()}`;
        await prisma.$transaction([
          prisma.wallet.update({
            where: { userId: user.id },
            data: {
              balance: { increment: amount },
              checkingBalance: { increment: amount },
            },
          }),
          prisma.walletTransaction.create({
            data: {
              userId: user.id,
              amount,
              type: 'credit',
              transactionType: 'FUNDING',
              status: 'SUCCESS',
              reference: txRef,
              payment_method: 'bankTransfer',
              account_no: accountNumber,
              account_type: 'checking',
              trx_ref: `${generateFiveUniqueRandomNumbers()}`,
              description: 'Deposit - Bank Transfer (Bachs)',
            },
          }),
        ]);
        await this.notificationService.createNotification(
          user.id,
          'Wallet Credited',
          `Your wallet has been credited with ${currency} ${amount} via Bachs bank transfer`,
          'wallet_credited',
        );
        return;
      }
    }

    this.logger.warn(
      `No BankTransfer or User found for Bachs webhook: ref=${ref}, account=${accountNumber}`,
    );
  }
}

///ssssssssssssssssss