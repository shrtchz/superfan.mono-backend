import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { prisma } from '../prisma/prisma';
import {
  CreateBalanceDto,
  CreateBushaCustomerDto,
  CreateBushaQuoteDto,
  CreateBushaTransferDto,
  CreateRecipientDto,
  GetBalanceDto,
  PaymentOptionsDto,
} from './payment.dto';
import { generateFiveUniqueRandomNumbers } from '../common/utils/utils';

@Injectable()
export class BushaService {
  constructor(private httpService: HttpService) {}
 

  async createBalance(dto: CreateBalanceDto): Promise<any> {
    try {
      const response = await axios.post(
        `${process.env.BUSHA_BASE_URL}/v1/balances`,
        {
          currency: dto.currency,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            'Content-Type': 'application/json',
            'X-BU-PROFILE-ID': dto.profileId,
          },
        },
      );

      const bushaData = response.data?.data;

      if (!bushaData?.id || !bushaData?.currency) {
        throw new HttpException(
          'Invalid response from Busha',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const savedBalance = await prisma.bushaBalance.create({
        data: {
          balance_id: bushaData.id,
          currency: bushaData.currency,
        },
      });

      return {
        busha: response.data,
        saved: savedBalance,
      };
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to create balance',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getBalances(dto: GetBalanceDto): Promise<any> {
    try {
      const token = process.env.BUSHA_API_KEY;

      const response = await firstValueFrom(
        this.httpService.get(`${process.env.BUSHA_BASE_URL}/v1/balances`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-BU-PROFILE-ID': dto.customerId,
          },
          params: dto.currency,
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error || 'Failed to fetch balances',
        error || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getBalanceDetails(
  idOrCode: string,
  customerId: string,
): Promise<any> {
  try {
    const url = `${process.env.BUSHA_BASE_URL}/v1/balances/${idOrCode}`;

    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
          'X-BU-PROFILE-ID': customerId,
          Accept: 'application/json',
        },
      }),
    );

    return response.data;
  } catch (error: any) {

    throw new HttpException(
      error?.response?.data || 'Failed to fetch balance details',
      error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

  // creat a script to update lastSync when last call was made to any function in BushaService

   // creat a script to update lastSync when last call was made to any function in BushaService

  async getSupportedCurrencies(): Promise<any> {
    try {
      const token = process.env.BUSHA_API_KEY;

      const response = await firstValueFrom(
        this.httpService.get(`${process.env.BUSHA_BASE_URL}/v1/currencies`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error || 'Failed to fetch currencies',
        error.message || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getCurrencyByCode(code: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${process.env.BUSHA_BASE_URL}/currencies/${code}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error || 'Failed to fetch currency details',
        error.message || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createCustomer(dto: CreateBushaCustomerDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.BUSHA_BASE_URL}/v1/customers`,
          dto,
          {
            headers: {
              Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
              'Content-Type': 'application/json',
              'X-BU-PROFILE-ID': process.env.BUSHA_PROFILE_ID,
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      console.error('BUSHA ERROR FULL CREATECUSTOMER:', {
        message: error.message,
        response: error?.response?.data,
        status: error?.response?.status,
      });

      throw new InternalServerErrorException(
        error?.response?.data?.message || 'Failed to create Busha customer',
      );
    }
  }

  async getCustomers(): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${process.env.BUSHA_BASE_URL}/v1/customers`, {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            'Content-Type': 'application/json',
            'X-BU-PROFILE-ID': process.env.BUSHA_PROFILE_ID,
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new InternalServerErrorException(
        error?.response?.data || 'Failed to fetch customers from Busha',
      );
    }
  }

  async getCustomerById(customerId: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${process.env.BUSHA_BASE_URL}/v1/customers/${customerId}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
              'X-BU-PROFILE-ID': process.env.BUSHA_PROFILE_ID,
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Busha API error',
        error.response?.status || 500,
      );
    }
  }

  

  async verifyCustomer(id: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.BUSHA_BASE_URL}/v1/customers/${id}/verify`,
          {},
          {
            headers: {
              Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
              'X-BU-PROFILE-ID': process.env.BUSHA_PROFILE_ID,
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      console.error('BUSHA ERROR FULL VERIFYCUSTOMER:', {
        message: error.message,
        response: error?.response?.data,
        status: error?.response?.status,
      });

      throw new InternalServerErrorException(
        error?.response?.data?.message || 'Failed to verify Busha customer',
      );
    }
  }

  async createQuote(dto: CreateBushaQuoteDto, userId: number): Promise<any> {
    try {
      const response = await axios.post(
        `${process.env.BUSHA_BASE_URL}/v1/quotes`,
        dto,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            'Content-Type': 'application/json',
            'X-BU-PROFILE-ID': dto.customer_id,
            // dto.customer_id
          },
        },
      );

      const quote = response.data;

      const savedQuotes = prisma.bushaQuotes.create({
        data: {
          quote_id: quote.data.id,
          user_id: userId,
          customer_id: dto.customer_id,
          source_currency: quote.data.source_currency,
          target_currency: quote.data.target_currency,
          source_amount: quote.data.source_amount,
          target_amount: quote.data.target_amount,
        },
      });
      return savedQuotes;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Busha API error',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getBushaQuotes(): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${process.env.BUSHA_BASE_URL}/v1/quotes`, {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Failed to fetch Busha quotes',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getQuoteById(id: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${process.env.BUSHA_BASE_URL}/quotes/${id}`, {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Failed to fetch quote',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTransactionById(id: string) {
    try {
      const response = await axios.get(
        `${process.env.BUSHA_BASE_URL}/v1/transactions/${id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to fetch transaction',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTransactions(id: string) {
    try {
      const response = await axios.get(
        `${process.env.BUSHA_BASE_URL}/v1/transactions/`,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to fetch transactions',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createTransfer(dto: CreateBushaTransferDto): Promise<any> {
    try {
      const response = await axios.post(
        `${process.env.BUSHA_BASE_URL}/v1/transfers`,
        dto,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            'Content-Type': 'application/json',
            'X-BU-PROFILE-ID': dto.customerId
          },
        },
      );

      const transfer = response.data.data;

      await prisma.bushaTransfer.create({
        data: {
          trf_id: transfer.id,
          status: transfer.status,
          pay_in: transfer.pay_in,
          fees: transfer.fees,

          // optional mappings
          quote_id: transfer.quote_id,
          profile_id: transfer.profile_id,
          source_currency: transfer.source_currency,
          target_currency: transfer.target_currency,
          source_amount: transfer.source_amount,
          target_amount: transfer.target_amount,
        },
      });

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Transfer failed',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTransferById(id: string, customerId: string) {
    try {
      const response = await axios.get(
        `${process.env.BUSHA_BASE_URL}/v1/transfers/${id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            'X-BU-PROFILE-ID': customerId
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to fetch transaction',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTransfers() {
    try {
      const response = await axios.get(
        `${process.env.BUSHA_BASE_URL}/v1/transfers`,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            // 'X-BU-PROFILE-ID': customerId,
            //  'X-BU-PROFILE-ID': process.env.BUSHA_PROFILE_ID
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to fetch transactions',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getPaymentOptions(
    dto: PaymentOptionsDto,
    token: string,
    profileId: string,
  ) {
    try {
      const response = await axios.get(
        `${process.env.BUSHA_BASE_URL}/quote/payment_options`,
        {
          params: {
            support_conversion: dto.support_conversion,
            type: dto.type,
            purpose: dto.purpose,
            currency: dto.currency,
            amount: dto.amount,
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'X-BU-PROFILE-ID': profileId,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Busha API error',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createRecipient(dto: CreateRecipientDto) {
    try {
      const response = await axios.post(
        `${process.env.BUSHA_BASE_URL}/v1/recipients`,
        dto,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
            'Content-Type': 'application/json',
            'X-BU-Version': '2025-07-11',

            'X-BU-PROFILE-ID': dto.customerId,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Busha API error',
        error?.response?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

    async getRecipientById(id: string) {
    const url = `${process.env.BUSHA_BASE_URL}/v1/recipients/${id}`;

    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
          'X-BU-Version': '2025-07-11',
        },
      }),
    );

    return response.data;
  }

  async getPairs() {
    try {
      const response = await axios.get(
        `${process.env.BUSHA_BASE_URL}/v1/pairs`,
        {
          headers: {
            Authorization: `Bearer ${process.env.BUSHA_API_KEY}`,
          },
          timeout: 10000, // optional but recommended
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Failed to fetch pairs',
        error?.response?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  async processBushaWebhook(payload: any) {
  const trfId = payload?.data?.id;
  if (!trfId) return;

  // 1. Find transfer
  const transfer = await prisma.bushaTransfer.findUnique({
    where: { trf_id: trfId },
  });

  if (!transfer) return;

  // 2. Find quote → user
  const quote = await prisma.bushaQuotes.findUnique({
    where: { quote_id: transfer.quote_id },
  });

  if (!quote) return;

  const userId = quote.user_id;

  // 3. Map event
  let status: string;
  switch (payload.event) {
    case 'transfer.pending':
      status = 'PENDING';
      break;
    case 'transfer.funds_received':
      status = 'SUCCESS';
      break;
    case 'transfer.cancelled':
      status = 'FAILED';
      break;
    default:
      return;
  }

  // 🛑 Idempotency
  if (transfer.status === status) return;

  await prisma.$transaction(async (tx) => {
    // 4. Update transfer
    await tx.bushaTransfer.update({
      where: { trf_id: trfId },
      data: {
        status,
        pay_in: payload.data.pay_in,
        fees: payload.data.fees,
      },
    });

    // 5. Only credit on funds_received
    if (payload.event === 'transfer.funds_received') {
      const amount = parseFloat(payload.data.target_amount);

      // Prevent duplicate credit
      const existing = await tx.walletTransaction.findFirst({
        where: { reference: trfId },
      });

      if (existing) return;

      // WalletTransaction
      await tx.walletTransaction.create({
        data: {
          userId,
          amount,
          status: 'SUCCESS',
          transactionType: 'CRYPTO_DEPOSIT',
          reference: trfId,
          description: 'Busha deposit',
          trx_ref: `${generateFiveUniqueRandomNumbers()}`
        },
      });

      // ActivityWallet
      await tx.activityWallet.create({
        data: {
          userId,
          type: 'credit',
          title: 'Crypto Deposit',
          description: `Received ${amount} ${payload.data.target_currency}`,
          amount,
          currency: payload.data.target_currency,
          reference: trfId,
          status: 'SUCCESS',
          metadata: payload.data,
        },
      });
    }
  });
}

}
