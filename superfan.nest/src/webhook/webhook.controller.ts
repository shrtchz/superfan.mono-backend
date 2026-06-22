import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiRoutes } from '../common/enums/routes.enum';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';
import { validateHmacChecksum } from '../common/utils/validateHmacChecksum';
import { NotificationService } from '../notification/notification.service';
import { BushaService } from '../payment/busha.service';
import { FlutterwaveSuperfanService } from '../payment/flutterwave.service';
import { prisma } from '../prisma/prisma';
import { MonnifyWebhookService } from './webhook.service';

@Controller(ApiRoutes.WEBHOOK)
export class MonnifyWebhookController {
  private readonly logger = new Logger(MonnifyWebhookController.name);
  private readonly hmacSecret = process.env.BUSHA_WEBHOOK_SECRET;

  constructor(
    private readonly webhookService: MonnifyWebhookService,
    private readonly bushaService: BushaService,
    private readonly flutterwaveService: FlutterwaveSuperfanService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * POST /webhooks/monnify
   *
   * Receives Monnify payment webhook events, verifies the HMAC-SHA512
   * signature from the `monnify-signature` header, then processes the event.
   *
   * Monnify sends the computed hash in the `monnify-signature` header.
   * We recompute it from the raw request body and compare.
   */
  @Post('monnify')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('monnify-signature') monnifySignature: string,
    @Body() payload: any,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ status: string }> {
    console.log(payload, 'webhook payload item');
    // 1. Ensure the signature header is present
    if (!monnifySignature) {
      this.logger.warn('Missing monnify-signature header');
      throw new BadRequestException('Missing monnify-signature header');
    }

    // 2. Use the raw body buffer for accurate hash verification.
    //    Requires `rawBody: true` in NestJS bootstrap (see main.ts note below).
    const rawBody = req.rawBody?.toString('utf-8');

    if (!rawBody) {
      this.logger.warn(
        'Raw body is unavailable. Ensure rawBody is enabled in main.ts.',
      );
      throw new BadRequestException(
        'Raw body unavailable for hash verification',
      );
    }

    // 3. Verify the signature — throws UnauthorizedException on mismatch
    this.webhookService.verifySignature(rawBody, monnifySignature);
    console.log('Signature verified successfully', payload);

    // 4. Process the event asynchronously
    await this.webhookService.handleWebhookEvent(payload);

    return { status: 'success' };
  }

  @Post('busha')
  @HttpCode(HttpStatus.OK)
  async handleBushaWebhook(
    @Headers('x-bu-signature') signature: string,
    @Req() req: Request & { rawBody: Buffer },
  ): Promise<any> {
    console.log('busha-webhook');
    console.log('Received Busha webhook with signature:', signature);
    if (!signature) {
      throw new BadRequestException('Missing busha-signature header');
    }

    const isValid = validateHmacChecksum(
      req.rawBody,
      signature,
      this.hmacSecret,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid signature');
    }

    const payload = JSON.parse(req.rawBody.toString());

  console.log('✅ Valid Busha webhook:', payload);

  // 🚀 Just pass everything to service
  await this.bushaService.processBushaWebhook(payload);

    return { received: true };
  }

@Post('bitnob')
@HttpCode(HttpStatus.OK)
async handleBitnobWebhook(
  @Headers('x-bitnob-signature') signature: string,
  @Body() payload: any,
  @Req() req: Request & { rawBody: Buffer },
): Promise<{ status: string }> {
  this.logger.log('Received Bitnob webhook');

  if (!signature) {
    throw new BadRequestException('Missing x-bitnob-signature header');
  }

  const webhookSecret = process.env.BITNOB_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new BadRequestException('Webhook secret not configured');
  }

  const crypto = require('crypto');

  const rawBody =
    req.rawBody?.toString('utf-8') || JSON.stringify(payload);

  const hash = crypto
    .createHmac('sha512', webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (hash !== signature) {
    throw new BadRequestException('Invalid signature');
  }

  console.log(payload.event)
  this.logger.log(
    `Bitnob webhook verified: ${payload.event}`,
  );

  switch (payload?.event) {
    case 'transfer.success':
      await this.handleBitnobTransferSuccess(payload);
      break;

    case 'deposit.success':
      await this.handleBitnobDepositSuccess(payload);
      break;
  }

  return { status: 'success' };
}


private async handleBitnobTransferSuccess(payload: any) {
  try {
    const data = payload?.data;
    const reference = data?.reference;
    const amount = Number(data?.amount) / 1000000;
    const currency = data?.currency?.toUpperCase();

    if (!reference) return;

    const transaction = await prisma.bitnobWithdrawal.findFirst({
      where: { reference },
    });

    if (!transaction) return;

    if (transaction.status === 'SUCCESS') {
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Mark withdrawal as successful
      await tx.bitnobWithdrawal.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
      });

      // Decrement wallet balance
      const walletUpdateData: any = {};

      switch (currency) {
        case 'USDC':
          walletUpdateData.usdcBalance = {
            decrement: amount,
          };
          break;

        case 'USDT':
          walletUpdateData.usdtBalance = {
            decrement: amount,
          };
          break;

        default:
          throw new Error(`Unsupported currency: ${currency}`);
      }

      await tx.wallet.update({
        where: {
          userId: transaction.userId,
        },
        data: walletUpdateData,
      });

      // Activity log
      await tx.activityWallet.create({
        data: {
          userId: transaction.userId,
          type: 'debit',
          title: 'Transfer Completed',
          description: 'transfer completed successfully',
          amount,
          currency,
          reference,
          status: 'SUCCESS',
        },
      });

      // Wallet transaction
      await tx.walletTransaction.create({
        data: {
          user: {
            connect: {
              id: transaction.userId,
            },
          },
          amount,
          type: 'debit',
          wallet_address: transaction.address,
          account_type: 'crypto_wallet',
          status: 'SUCCESS',
          reference,
          trx_ref: `${generateFiveUniqueRandomNumbers()}`,
        },
      });
    });

    // Notification
    await this.notificationService.createNotification(
      transaction.userId,
      'token withdrawal',
      `Successfully withdrew ${amount} ${currency}`,
      'TOKEN_WITHDRAWAL',
    );

    console.log(
      '[BITNOB TRANSFER SUCCESS] ✅ Transfer completed successfully',
    );
  } catch (error) {
    console.error('[BITNOB TRANSFER SUCCESS] ERROR:', error);
    this.logger.error('Bitnob transfer success handler error:', error);
    throw error;
  }
}


private async handleBitnobDepositSuccess(payload: any) {
  const deposit = payload?.data;

  if (!deposit?.address) {
    this.logger.warn('Deposit address missing');
    return;
  }

const user = await prisma.$queryRaw`
  SELECT *
  FROM "User"
  WHERE accounts::jsonb @> ${JSON.stringify([
    { address: deposit.address },
  ])}::jsonb
`;

  if (!user) {
    this.logger.warn(
      `No user found for wallet address ${deposit.address}`,
    );
    return;
  }

  const amount = Number(deposit.amount) / 1_000_000; // USDC 6 decimals

  await prisma.$transaction(async (tx) => {
    await tx.walletTransaction.create({
      data: {
        userId: user[0].id,
        amount,
        type: 'credit',
        transactionType: 'crypto_deposit',
        payment_method: 'crypto',
        wallet_address: deposit.address,
        reference: deposit.reference,
        trx_ref: deposit.transaction_id,
        status: 'SUCCESS',
        description: `${amount} ${deposit.currency} deposit received`,
      },
    });

    await tx.activityWallet.create({
      data: {
        userId: user[0].id,
        type: 'credit',
        title: 'Crypto Deposit',
        description: `${amount} ${deposit.currency} deposited to your wallet`,
        amount,
        currency: deposit.currency,
        reference: deposit.reference,
        status: 'SUCCESS',
        metadata: {
          chain: deposit.chain,
          txHash: deposit.hash,
          walletAddress: deposit.address,
          transactionId: deposit.transaction_id,
        },
      },
    });

    const currency = deposit.currency?.toUpperCase();

const data: any = {};

switch (currency) {
  case 'USDC':
    data.usdcBalance = {
      increment: amount,
    };
    break;

  case 'USDT':
    data.usdtBalance = {
      increment: amount,
    };
    break;
}

await tx.wallet.update({
  where: {
    userId: user[0].id,
  },
  data,
});
  });

  await this.notificationService.createNotification(user[0].id, 'crypto deposited', `your wallet has been funded with ${amount}`, 'CRYPTO_DEPOSIT')

  this.logger.log(
    `Deposit processed for user ${user[0].id}: ${amount} ${deposit.currency}`,
  );
}

@Post('flw')
async handleFlutterwaveWebhook(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
  @Headers('verif-hash') signature: string,
) {
  console.log('Received Flutterwave webhook');

  if (signature !== process.env.FLW_SECRET_HASH) {
    return res.status(401).end();
  }

  const payload = req.body;

  console.log('[FLW WEBHOOK]', payload);

  if (payload?.event === 'charge.completed') {
    await this.handleCardCharge(payload);
  }

  return res.status(HttpStatus.OK).end();
}

private async handleCardCharge(payload: any) {
  try {
    console.log('[HANDLE CARD CHARGE] Starting with payload:', payload);
    
    const data = payload?.data;

    if (data?.status !== 'successful') {
      console.log('[HANDLE CARD CHARGE] Status not successful:', data?.status);
      return;
    }

    const reference = data?.flw_ref;
    const txRef = data?.tx_ref;
    const amount = Number(data?.amount);

    console.log('[HANDLE CARD CHARGE] Reference:', reference, 'TxRef:', txRef, 'Amount:', amount);

    if (!reference || !txRef) {
      console.log('[HANDLE CARD CHARGE] Missing reference or txRef');
      return;
    }

    const cardFunding = await prisma.cardFunding.findFirst({
      where: { flwRef: reference },
    });

    console.log('[HANDLE CARD CHARGE] Card funding record:', cardFunding);

    if (!cardFunding) {
      console.log('[HANDLE CARD CHARGE] No card funding found');
      return;
    }

    if (cardFunding.status === 'SUCCESS') {
      console.log('[HANDLE CARD CHARGE] Card funding already processed with status SUCCESS');
      return;
    }

    console.log('[HANDLE CARD CHARGE] Verifying transaction with txRef:', txRef);
    const verifyResponse = await this.flutterwaveService.verifyTransactionByReference(txRef);
    console.log('[HANDLE CARD CHARGE] Verify response:', verifyResponse);
    
    const verifiedData = verifyResponse?.data;

    if (!verifiedData || verifiedData?.status !== 'successful') {
      console.log('[HANDLE CARD CHARGE] Verification failed or not successful:', verifiedData?.status);
      return;
    }

    const card = verifiedData?.card;
    console.log('[HANDLE CARD CHARGE] Card from verification:', card);

    if (card?.token) {
  const existing = await prisma.userCard.findFirst({
    where: {
      userId: cardFunding.userId,
      cardToken: card.token,
    },
  });

  if (!existing) {
    await prisma.userCard.create({
      data: {
        userId: cardFunding.userId,
        cardToken: card.token, // assuming Json column
      },
    });

    console.log(
      '[HANDLE CARD CHARGE] Card saved to userCard for user:',
      cardFunding.userId,
    );
  }
}

    // 💰 update wallet
    console.log('[HANDLE CARD CHARGE] Updating wallet balance by:', amount);
    await prisma.wallet.update({
      where: { userId: cardFunding.userId },
      data: {
        balance: {
          increment: amount,
        },
      },
    });

    // 🧾 transaction log
    console.log('[HANDLE CARD CHARGE] Creating wallet transaction');
    await prisma.walletTransaction.create({
      data: {
        userId: cardFunding.userId,
        amount,
        type: 'credit',
        status: 'SUCCESS',
        reference,
        payment_method: 'CARD',
        account_type: 'Personal',
        description: 'Wallet funded with card',
        trx_ref: `${generateFiveUniqueRandomNumbers()}`
      },
    });

    // 📊 activity log
    console.log('[HANDLE CARD CHARGE] Creating activity wallet');
    const saved_activity_wallet = await prisma.activityWallet.create({
      data: {
        userId: cardFunding.userId,
        type: 'credit',
        title: 'Money Added',
        description: `Money added to wallet`,
        amount,
        currency: 'NGN',
        reference,
        status: 'SUCCESS',
      },
    });

    console.log('[HANDLE CARD CHARGE] Activity wallet created:', saved_activity_wallet);

    // ✅ mark funded
    console.log('[HANDLE CARD CHARGE] Marking card funding as SUCCESS');
    await prisma.cardFunding.updateMany({
      where: { flwRef: reference },
      data: { status: 'SUCCESS' },
    });

    console.log('[HANDLE CARD CHARGE] ✅ Card charge completed successfully');
  } catch (error) {
    console.error('[HANDLE CARD CHARGE] ERROR:', error);
    this.logger.error('Card charge handler error:', error);
    throw error;
  }
}
}
