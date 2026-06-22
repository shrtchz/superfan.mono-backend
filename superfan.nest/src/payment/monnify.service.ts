import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { prisma } from '../prisma/prisma';
import { BushaService } from './busha.service';
import {
  Authorize3DSecureCardDto,
  AuthorizeOtpDto,
  BvnAccountMatchDto,
  BvnMatchDto,
  CancelMandateDto,
  ChargeCardDto,
  ChargeCardTokenDto,
  CreateReservedAccountDto,
  CreateWalletDto,
  DebitPaymentDto,
  DisburseDto,
  InitPaymentDto,
  InitTransactionDto,
  PaymentDto,
  ResendOtpDto,
  SubAccountDto,
  ValidateOtpDto,
} from './payment.dto';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';

@Injectable()
export class MonnifyService {
  constructor(private readonly httpService: HttpService, private readonly bushaService: BushaService) {}

  async getAccessToken(): Promise<string> {
    const auth = Buffer.from(
      `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`,
    ).toString('base64');

    const res = await axios.post(
      `${process.env.MONNIFY_URI}/api/v1/auth/login`,
      {},
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    return res.data.responseBody.accessToken;
  }

  async createSubAccount(dto: SubAccountDto): Promise<string | null> {
    try {
      const token = await this.getAccessToken();

      const payload = [
        {
          currencyCode: dto.customerCurrency,
          accountNumber: dto.customerAccountNumber,
          bankCode: dto.customerAccountBankCode,
          email: dto.customerEmailAddress,
          defaultSplitPercentage: dto.defaultSplitPercentage,
          // customerAccountName: dto.customerAccountName,
        },
      ];

      const res = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/sub-accounts`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return res.data.responseBody?.[0]?.subAccountCode || null;
    } catch (error: any) {
      console.error('Monnify Error:', error?.response?.data || error.message);

      // ✅ Return null instead of error object
      return null;
    }
  }

  async createMandate(dto: PaymentDto): Promise<any> {
    const url = `${process.env.MONNIFY_URI}/api/v1/direct-debit/mandate/create`;

    const token = await this.getAccessToken();
    const payload = {
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      mandateReference: `unique_ref_${Date.now()}`, // dynamic reference
      mandateAmount: dto.mandateAmount,
      autoRenew: true,
      customerCancellation: true,
      customerName: dto.customerName,
      customerPhoneNumber: dto.customerPhoneNumber,
      customerEmailAddress: dto.customerEmailAddress,
      customerAddress: dto.customerAddress,
      customerAccountNumber: dto.customerAccountNumber,
      customerAccountBankCode: dto.customerAccountBankCode,
      mandateDescription: dto.mandateDescription,
      mandateStartDate: dto.mandateStartDate,
      mandateEndDate: dto.mandateEndDate,
      redirectUrl: dto.redirectUrl,
      debitAmount: dto.debitAmount,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data;

      } catch (error: any) {
  console.error('Monnify FULL ERROR:', {
    status: error.response?.status,
    data: error.response?.data,
    message: error.message,
  });

  throw new InternalServerErrorException(
    error.response?.data?.responseMessage || 'Monnify request failed',
  );
}
  }
    // } catch (error: any) {
    //   console.error('Monnify Error:', error.response?.data.responseMessage);
    //   throw new InternalServerErrorException(
    //     error.response?.data.responseMessage,
    //   );
    // }


  async debitMandate(dto: DebitPaymentDto) {
    const url = `${process.env.MONNIFY_URI}/api/v1/direct-debit/mandate/debit`;
    const token = await this.getAccessToken();

    // 1. Find subscription first
    const subscription = await prisma.subscription.findFirst({
      where: {
        mandateCode: dto.mandateCode,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found for mandate');
    }

    // 2. Create debit record (PENDING first)
    const debitRecord = await prisma.subscriptionDebit.create({
      data: {
        subscriptionId: subscription.id,
        amount: dto.debitAmount,
        debitDate: new Date(),
        paymentReference: dto.paymentReference,
        transactionRef: null,
        status: 'PENDING',
        narration: dto.narration ?? 'Monthly subscription debit',
      },
    });

    try {
      // 3. Call Monnify
      const response = await firstValueFrom(
        this.httpService.post(url, dto, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      const data = response.data;

      const paymentReference = data?.responseBody?.paymentReference;
      const transactionRef = data?.responseBody?.transactionReference;

      // 4. Update debit record → SUCCESS
      await prisma.subscriptionDebit.update({
        where: {
          id: debitRecord.id,
        },
        data: {
          status: data?.responseBody?.transactionStatus,
          paymentReference: paymentReference ?? dto.paymentReference,
          transactionRef: transactionRef,
        },
      });

      // call getMandateDebitStatus to confirm status and update subscription status accordingly
      const debitStatus = await this.getMandateDebitStatus(
        dto.paymentReference,
      );

      await prisma.subscriptionDebit.update({
        where: {
          id: debitRecord.id,
        },
        data: {
          status: debitStatus.responseBody?.transactionStatus,
        },
      });

      return data;
    } catch (error: any) {
      console.error('Monnify Error:', error?.response?.data || error);

      // 6. Update debit record → FAILED
      await prisma.subscriptionDebit.update({
        where: {
          id: debitRecord.id,
        },
        data: {
          status: 'FAILED',
        },
      });

      throw new InternalServerErrorException(
        error.response?.data?.responseMessage || 'Debit failed',
      );
    }
  }

  async getMandates(mandateReference?: string): Promise<any> {
    const url = `${process.env.MONNIFY_URI}/api/v1/direct-debit/mandate/`;

    const token = await this.getAccessToken();

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            mandateReferences: mandateReference,
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      console.error(error.response?.data.responseMessage);
      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
      );
    }
  }

  async getMandateDebitStatus(paymentReference: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const url = `${process.env.MONNIFY_URI}/api/v1/direct-debit/mandate/debit-status`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          paymentReference, // ✅ query param
        },
      });

      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error.response?.data.responseMessage || 'Failed to fetch debit status',
        error.response?.data.responseCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async chargeCard(dto: ChargeCardDto) {
    try {
      const token = await this.getAccessToken(); // 👈 implement this

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/merchant/cards/charge`,
        {
          transactionReference: dto.transactionReference,
          collectionChannel: 'API_NOTIFICATION',
          card: dto.card,
          deviceInformation: {
            httpBrowserLanguage: 'en-US',
            httpBrowserJavaEnabled: false,
            httpBrowserJavaScriptEnabled: true,
            httpBrowserColorDepth: 24,
            httpBrowserScreenHeight: 1203,
            httpBrowserScreenWidth: 2138,
            httpBrowserTimeDifference: '',
            userAgentBrowserValue: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(error.response?.data.responseMessage);
      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
      );
    }
  }

  async initTransaction(dto: InitTransactionDto) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/merchant/transactions/init-transaction`,
        {
          amount: dto.amount,
          customerEmail: dto.customerEmail,
          paymentReference: dto.paymentReference,
          paymentDescription: dto.paymentDescription,
          currencyCode: dto.currencyCode,
          contractCode: process.env.MONNIFY_CONTRACT_CODE,
          redirectUrl: dto.redirectUrl,
          paymentMethods: dto.paymentMethods,
          metadata: dto.metadata,
          incomeSplitConfig: dto.incomeSplitConfig,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(error.response?.data.responseMessage);
      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
      );
    }
  }

  async getBanks() {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(
        `${process.env.MONNIFY_URI}/api/v1/banks`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(error.response?.data.responseMessage);
      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
      );
    }
  }

  async validateAccount(accountNumber: string, bankCode: string) {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(
        `${process.env.MONNIFY_URI}/api/v1/disbursements/account/validate`,
        {
          params: {
            accountNumber,
            bankCode,
          },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(error.response?.data.responseMessage);
      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
      );
    }
  }

  async createReservedAccount(dto: CreateReservedAccountDto) {
    const payload = {
      accountReference: dto.accountReference,
      accountName: dto.accountName,
      currencyCode: dto.currencyCode,
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      customerEmail: dto.customerEmail,
      customerName: dto.customerName,
      bvn: dto.bvn,
      getAllAvailableBanks: dto.getAllAvailableBanks ?? true,
      preferredBanks: dto.preferredBanks ?? [],
    };

    try {
      const token = await this.getAccessToken();

      if (dto.accountReference) {
        try {
          const existingAccount = await axios.get(
            `${process.env.MONNIFY_URI}/api/v2/bank-transfer/reserved-accounts/${dto.accountReference}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );

          return existingAccount.data;
        } catch (error: any) {
          const status = error.response?.status;
          const responseMessage = error.response?.data?.responseMessage;
          const accountNotFound =
            status === 404 ||
            (typeof responseMessage === 'string' &&
              /not found|does not exist/i.test(responseMessage));

          if (!accountNotFound) {
            throw error;
          }
        }
      }

      const { data } = await axios.post(
        `${process.env.MONNIFY_URI}/api/v2/bank-transfer/reserved-accounts`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return data;
    } catch (error: any) {
      const responseMessage = error.response?.data?.responseMessage;
      const responseCode = error.response?.data?.responseCode;

      if (
        dto.accountReference &&
        responseCode === '99' &&
        typeof responseMessage === 'string' &&
        responseMessage.includes('same reference')
      ) {
        return this.getReservedAccount(dto.accountReference);
      }

      console.error(
        'Monnify API Error:',
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  async getReservedAccount(accountReference: string) {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(
        `${process.env.MONNIFY_URI}/api/v2/bank-transfer/reserved-accounts/${accountReference}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      return response.data;
    } catch (error: any) {
      console.error(
        'Monnify API Error:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        error.response?.data.responseMessage,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async verifyBvnMatch(dto: BvnMatchDto): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/vas/bvn-details-match`,
        {
          bvn: dto.bvn,
          name: dto.name,
          dateOfBirth: dto.dateOfBirth,
          mobileNo: dto.mobileNo,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('BVN Match Error:', error.response?.data.responseMessage);

      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
      );
    }
  }

  async verifyBvnAccountMatch(dto: BvnAccountMatchDto): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/vas/bvn-account-match`,
        {
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
          bvn: dto.bvn,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(
        'BVN Account Match Error:',
        error.response?.data.responseMessage,
      );

      throw new BadRequestException(error.response?.data.responseMessage);
    }
  }

  async verifyNin(nin: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/vas/nin-details`,
        { nin },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(
        'NIN Verification Error:',
        error.response?.data.responseMessage,
      );

      throw new HttpException(
        error.response?.data.responseMessage,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async initPaymentByTransfer(dto: InitPaymentDto, userId: any) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/merchant/bank-transfer/init-payment`,
        {
          transactionReference: dto.transactionReference,
          bankCode: dto.bankCode,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const result = response.data.responseBody;

let saved_bank_transfer = await prisma.bankTransfer.create({
  data: {
    userId: userId,

    transactionReference: result.transactionReference,
    paymentReference: result.paymentReference,

    accountNumber: result.accountNumber,
    accountName: result.accountName,
    bankName: result.bankName,
    bankCode: result.bankCode,

    amount: result.amount,
    fee: result.fee,
    totalPayable: result.totalPayable,

    ussdPayment: result.ussdPayment,
    collectionChannel: result.collectionChannel,
    productInformation: result.productInformation,

    requestTime: new Date(result.requestTime),
    expiresOn: new Date(result.expiresOn),
    accountDurationSeconds: result.accountDurationSeconds,

    status: 'PENDING',
  },
});
      return response.data;
    } catch (error: any) {
      console.error(
        'Init Payment Error:',
        error.response?.data.responseMessage,
      );

      throw new HttpException(
        error.response?.data.responseMessage,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async authorizeOtp(dto: AuthorizeOtpDto) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/merchant/cards/otp/authorize`,
        // {
        //   transactionReference: dto.transactionReference,
        //   collectionChannel: dto.collectionChannel,
        //   tokenId: dto.tokenId,
        //   token: dto.token,
        // },

        dto,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(
        'Monnify OTP Authorize Error:',
        error.response?.data.responseMessage,
      );

      throw new HttpException(
        error.response?.data.responseMessage,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async authorize3DSecure(dto: Authorize3DSecureCardDto) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.post(
        `${process.env.MONNIFY_URI}/api/v1/sdk/cards/secure-3d/authorize`,
        {
          transactionReference: dto.transactionReference,
          apiKey: process.env.MONNIFY_API_KEY as string,
          collectionChannel: dto.collectionChannel,
          card: dto.card,
        },
        // dto,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Monnify 3DS Error:', error.response?.data.responseMessage);

      throw new InternalServerErrorException(
        error.response?.data.responseMessage ||
          '3D Secure Authorization Failed',
        error.response?.data.responseMessage || HttpStatus.BAD_REQUEST,
      );
    }
  }



  async getTransactionByReference(transactionReference: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const url = `${process.env.MONNIFY_URI}/api/v1/transactions/${encodeURIComponent(
        transactionReference,
      )}`;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error(
        'Monnify Transaction Fetch Error:',
        error.response?.data.responseMessage,
      );

      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
        error.response?.data.responseMessage ||
          HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async queryTransaction(
    transactionReference?: string,
    paymentReference?: string,
  ) {
    try {
      const token = await this.getAccessToken();
      const url = `${process.env.MONNIFY_URI}/api/v2/merchant/transactions/query`;

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            transactionReference,
            paymentReference,
          },
        }),
      );

      // Update user card details if available
      const responseBody = response.data.responseBody;
      if (responseBody?.cardDetails && responseBody?.customer?.email) {
  const {
    cardToken,
    maskedPan,
    cardType,
    expiryMonth,
    expiryYear,
    issuer,
    country,
  } = responseBody.cardDetails;

  const userEmail = responseBody.customer.email;


  if (cardToken || maskedPan) {
    try {
      const existingUser = await prisma.user.findUnique({
        where: { email: userEmail },
        select: { id: true },
      });

      if (!existingUser) {
        throw new Error('User not found');
      }

      // Check if card already exists
      const existingCard = await prisma.userCard.findFirst({
        where: {
          userId: existingUser.id,
          cardToken,
        },
      });

      // Create card only if it doesn't already exist
      if (!existingCard) {
        await prisma.userCard.create({
          data: {
            userId: existingUser.id,
            cardToken,
            maskedPan: maskedPan || null,
            cardNumber: maskedPan || null,
            cardType: cardType || null,
            expiry:
              expiryMonth && expiryYear
                ? `${expiryMonth}/${expiryYear}`
                : null,
            issuer: issuer || null,
            country: country || null,
            isDefault: false,
          },
        });
      }
    } catch (dbError: any) {
      console.error(
        'Failed to save user card details:',
        dbError.message,
      );
    }
  }
}

      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error.response?.data.responseMessage,
        error.response?.data.responseMessage ||
          HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // async createWallet(dto: CreateWalletDto) {
  //   try {
  //     const token = await this.getAccessToken();
  //     const { data } = await axios.post(
  //       `${process.env.MONNIFY_URI}/api/v1/disbursements/wallet`,
  //       dto,
  //       {
  //         headers: {
  //           Authorization: `Bearer ${token}`,
  //           'Content-Type': 'application/json',
  //         },
  //       },
  //     );

  //     return data;
  //   } catch (error: any) {
  //     throw new InternalServerErrorException(
  //       error.response?.data.responseMessage,
  //       error.response?.data.responseMessage ||
  //         HttpStatus.INTERNAL_SERVER_ERROR,
  //     );
  //   }
  // }

  async createWallet(dto: CreateWalletDto) {
  try {
    const token = await this.getAccessToken();


const payload = {
  ...dto,
  bvnDetails: {
    bvn: dto?.bvnDetails?.bvn,
    bvnDateOfBirth: dto?.bvnDetails?.bvnDateOfBirth,
  },
};


    const { data } = await axios.post(
      `${process.env.PROD_MONNIFY_URI}/api/v1/disbursements/wallet`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return data;
  } catch (error: any) {
    console.error(error.response?.data, 'error');

    throw new BadRequestException(
      error.response?.data?.responseMessage || 'Wallet creation failed',
    );
  }
}

  async getWallets(
    walletReference?: string,
    pageSize?: number,
    pageNo?: number,
  ): Promise<any> {
    try {
      const params: any = {};
      if (walletReference) params.walletReference = walletReference;
      if (pageSize) params.pageSize = pageSize;
      if (pageNo) params.pageNo = pageNo;

      const token = await this.getAccessToken();

      const { data } = await axios.get(
        `${process.env.MONNIFY_URI}/api/v1/disbursements/wallet`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params,
        },
      );

      return data;
    } catch (error: any) {
      console.error(error.response?.data || error.message);
      throw new InternalServerErrorException(
        error.response?.data.responseMessage || 'Error fetching wallets',
        error.response?.data.responseMessage ||
          HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getWalletBalance(accountNumber: string) {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(
        `${process.env.MONNIFY_URI}/api/v2/disbursements/wallet-balance`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            accountNumber, // query parameter
          },
        },
      );
      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error.response?.data.responseMessage ||
          'Failed to fetch wallet balance',
        error.response?.data.responseMessage || 500,
      );
    }
  }

  //   async getUserWalletBalance(userId: number) {
  //   try {
  //     const user_wallet = await prisma.wallet.findFirst({
  //       where: {userId}

  //     })

  //     return {balance: user_wallet.balance}
  //   } catch (error: any) {
  //     throw new InternalServerErrorException(
  //       error.response?.data.responseMessage ||
  //         'Failed to fetch wallet balance',
  //       error.response?.data.responseMessage || 500,
  //     );
  //   }
  // }

  async getUserWalletBalance(userId: number) {
  try {
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId },
    });

    let personalCredit = 0;
    let goldCredit = 0;
    let totalDebit = 0;

    for (const tx of transactions) {
  const amount = Number(tx.amount);

  if (tx.type === 'credit') {
    if (tx.account_type === 'Gold') {
      goldCredit += amount;
    } else {
      personalCredit += amount;
    }
  } else if (tx.type === 'debit') {
    totalDebit += amount;
  }
}

    // for (const tx of transactions) {
    //   if (tx.type === 'CREDIT') {
    //     if (tx.account_type === 'Gold') {
    //       goldCredit += tx.amount;
    //     } else {
    //       personalCredit += tx.amount;
    //     }
    //   }

    //   // if (tx.transactionType === 'DEBIT') {
    //   //   totalDebit += tx.amount;
    //   // }

    //         if (tx.type === 'DEBIT') {
    //     totalDebit += tx.amount;
    //   }
    // }

    // const totalBalance = personalCredit + goldCredit - totalDebit;
    const wallet = await prisma.wallet.findUnique({
  where: { userId },
  select: { balance: true },
});

const totalBalance = Number(wallet?.balance || 0);

    // Debit personal first, then gold
    let personalBalance = personalCredit;
    let goldBalance = goldCredit;

    if (totalDebit <= personalBalance) {
      personalBalance -= totalDebit;
    } else {
      const remainingDebit = totalDebit - personalBalance;
      personalBalance = 0;
      goldBalance -= remainingDebit;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { busha_customer_id: true },
    });

    let cryptoBalances = null;

    if (user?.busha_customer_id) {
      const customerId = user.busha_customer_id;

      const [usdc, usdt, cngn] = await Promise.all([
        this.bushaService.getBalanceDetails('USDC', customerId),
        this.bushaService.getBalanceDetails('USDT', customerId),
        this.bushaService.getBalanceDetails('CNGN', customerId),
      ]);

      cryptoBalances = {
        USDC: usdc,
        USDT: usdt,
        CNGN: cngn,
      };
    }

    return {
      personalBalance,
      goldBalance,
      totalBalance,
      cryptoBalances,
    };
  } catch (error: any) {
    throw new InternalServerErrorException(
      error.response?.data?.responseMessage ||
        'Failed to fetch wallet balance',
    );
  }
}

    async getWalletTransactions(
    accountNumber?: string,
    pageSize?: number,
    pageNo?: number,
  ) {
    try {
      const params: any = {};
      const token = await this.getAccessToken();

      if (accountNumber) params.accountNumber = accountNumber;
      if (pageSize) params.pageSize = pageSize;
      if (pageNo) params.pageNo = pageNo;

      const response = await axios.get(
        `${process.env.MONNIFY_URI}/api/v1/disbursements/wallet/transactions`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params,
        },
      );

      return response.data;
    } catch (error: any) {
      console.error(error?.response?.data || error.message);

      throw new HttpException(
        error?.response?.data || 'Failed to fetch wallet transactions',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async chargeCardToken(dto: ChargeCardTokenDto) {
    try {
      const token = await this.getAccessToken();

      const payload = {
        ...dto,
        apiKey: process.env.MONNIFY_API_KEY, // inject here
        contractCode: process.env.MONNIFY_CONTRACT_CODE,
      };

      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.MONNIFY_URI}/api/v1/merchant/cards/charge-card-token`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error.response?.data?.responseMessage || 'Charge failed',
        error.response?.status || 500,
      );
    }
  }

  async disburseSingle(dto: DisburseDto, userId: number) {
    const url = `${process.env.MONNIFY_URI}/api/v2/disbursements/single`;
    const token = await this.getAccessToken();

    const payload = {
      amount: dto.amount,
      reference: dto.reference,
      narration: dto.narration,
      destinationBankCode: dto.destinationBankCode,
      destinationAccountNumber: dto.destinationAccountNumber,
      destinationAccountName: dto.destinationAccountName,
      currency: dto.currency,
      sourceAccountNumber: dto.sourceAccountNumber,
      senderInfo: {
        sourceAccountNumber: dto.sourceAccountNumber,
        sourceAccountName: dto.sourceAccountName,
        sourceAccountBvn: dto.sourceAccountBvn,
        senderBankCode: dto.senderBankCode,
      },
      async: false,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      const result = response.data.responseBody;

      await prisma.$transaction([
        prisma.walletTransaction.create({
          data: {
            userId: userId,
            amount: dto.amount,
            reference: result.reference,
            status: 'PENDING',
            type: 'debit',
            account_name: result.destinationAccountName,
            account_no: result.destinationAccountNumber,
            bank_name: result.destinationBankName,
            description: dto.narration,
            trx_ref: `${generateFiveUniqueRandomNumbers()}`
          },
        }),

        prisma.activityWallet.create({
          data: {
            userId,
            type: 'debit',
            title: 'Money Sent',
            description: `₦${dto.amount} sent to ${result.destinationAccountName}`,
            amount: dto.amount,
            currency: dto.currency,
            reference: result.reference,
            status: 'PENDING',
            metadata: {
              bankName: result.destinationBankName,
              accountNumber: result.destinationAccountNumber,
            },
          },
        }),
      ]);

      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error.response?.data.responseMessage || 'Disbursement failed',
        error.response?.data.responseMessage || 500,
      );
    }
  }

  async walletWithdrawal(dto: DisburseDto, userId: number) {
  const url = `${process.env.MONNIFY_URI}/api/v2/disbursements/single`;
  const token = await this.getAccessToken();

  return await prisma.$transaction(async (tx) => {
    // 1. Get wallet
    const wallet = await tx.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

        // ✅ Enforce max withdrawal limit
    if (dto.amount > 9999) {
      throw new BadRequestException('Maximum withdrawal amount is ₦9,999');
    }

    // 2. Check balance ONLY (no deduction here)
    if (wallet.balance < dto.amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const payload = {
      amount: dto.amount,
      reference: dto.reference,
      narration: dto.narration,
      destinationBankCode: dto.destinationBankCode,
      destinationAccountNumber: dto.destinationAccountNumber,
      destinationAccountName: dto.destinationAccountName,
      currency: dto.currency,
      sourceAccountNumber: dto.sourceAccountNumber,
      senderInfo: {
        sourceAccountNumber: dto.sourceAccountNumber,
        sourceAccountName: dto.sourceAccountName,
        sourceAccountBvn: dto.sourceAccountBvn,
        senderBankCode: dto.senderBankCode,
      },
      async: false,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      const result = response.data.responseBody;

      // 3. Save records (still PENDING)
      await tx.walletTransaction.create({
        data: {
          userId,
          amount: dto.amount,
          reference: result.reference,
          status: 'PENDING',
          type: 'debit',
          account_name: result.destinationAccountName,
          account_no: result.destinationAccountNumber,
          bank_name: result.destinationBankName,
          description: dto.narration,
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      });

      await tx.activityWallet.create({
        data: {
          userId,
          type: 'debit',
          title: 'Money Sent',
          description: `₦${dto.amount} sent to ${result.destinationAccountName}`,
          amount: dto.amount,
          currency: dto.currency,
          reference: result.reference,
          status: 'PENDING',
          metadata: {
            bankName: result.destinationBankName,
            accountNumber: result.destinationAccountNumber,
          },
        },
      });

      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error.response?.data?.responseMessage || 'Disbursement failed',
      );
    }
  });
}

  async resendOtp(dto: ResendOtpDto): Promise<any> {
    try {
      const url = `${process.env.MONNIFY_URI}/api/v2/disbursements/single/resend-otp`;
      const token = await this.getAccessToken();
      const response = await axios.post(
        url,
        { reference: dto.reference },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      const message =
        error.response?.data?.responseMessage || 'Failed to resend OTP';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  async validateOtp(dto: ValidateOtpDto): Promise<any> {
  try {
    const token = await this.getAccessToken();

    const url = `${process.env.MONNIFY_URI}/api/v2/disbursements/single/validate-otp`;

    const response = await axios.post(
      url,
      {
        reference: dto.reference,
        authorizationCode: dto.authorizationCode,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const result = response.data.responseBody;

    // 🔍 Find transaction
    const transaction = await prisma.walletTransaction.findFirst({
      where: { reference: dto.reference },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // 🚀 SUCCESS FLOW
    if (result.status === 'SUCCESS') {
      await prisma.$transaction(async (tx) => {
        // 1. Get wallet
        const wallet = await tx.wallet.findUnique({
          where: { userId: transaction.userId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        // 2. Check balance AGAIN (important safety)
        if (wallet.balance < transaction.amount) {
          throw new BadRequestException('Insufficient balance at confirmation');
        }

        // 3. Deduct balance
        await tx.wallet.update({
          where: { userId: transaction.userId },
          data: {
            balance: {
              decrement: transaction.amount,
            },
          },
        });

        // 4. Update transaction
        await tx.walletTransaction.updateMany({
          where: { reference: dto.reference },
          data: { status: 'SUCCESS' },
        });

        // 5. Update activity
        await tx.activityWallet.updateMany({
          where: { reference: dto.reference },
          data: {
            status: 'SUCCESS',
            description: 'Transfer successful',
          },
        });
      });
    }

    // ❌ FAILED FLOW
    if (result.status !== 'SUCCESS') {
      await prisma.$transaction([
        prisma.walletTransaction.updateMany({
          where: { reference: dto.reference },
          data: { status: 'FAILED' },
        }),

        prisma.activityWallet.updateMany({
          where: { reference: dto.reference },
          data: {
            status: 'FAILED',
            description: 'Transfer failed',
          },
        }),
      ]);
    }

    return response.data;
  } catch (error: any) {
    const message =
      error.response?.data?.responseMessage || 'Failed to validate OTP';

    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
}

  async cancelMandate(dto: CancelMandateDto): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const url = `${process.env.MONNIFY_URI}/api/v1/direct-debit/mandate/cancel-mandate`;

      const response = await axios.patch(
        url,
        {
          mandateReference: dto.mandateReference,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      // ✅ delete subscription
      const subscription = await prisma.subscription.findFirst({
        where: { mandateReference: dto.mandateReference },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      await prisma.subscription.delete({
        where: { id: subscription.id },
      });

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.responseMessage || 'Failed to cancel mandate',
        error.response?.data?.responseCode || HttpStatus.BAD_REQUEST,
      );
    }
  }
}
