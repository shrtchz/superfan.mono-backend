import { HttpService } from '@nestjs/axios';
import { BadRequestException, HttpException, HttpStatus, Injectable, InternalServerErrorException } from '@nestjs/common';
import { FlutterwaveService } from '@scwar/nestjs-flutterwave';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { encrypt3DES } from '../common/helpers/encrypt-3des.helper';
import { encryptAES } from '../common/helpers/encrypt-aes.helper';
import { prisma } from '../prisma/prisma';
import {
  BankTransferDto,
  CreateBeneficiaryDto,
  CreateCustomerDto,
  CreatePaymentMethodDto,
  CreatePaymentPlanDto,
  CreatePayoutSubaccountDto,
  CreateTransferDto,
  CreateVirtualAccountDto,
  FlwChargeCardDto,
  FundPayoutSubaccountDto,
  GetTransactionsDto,
  StandardPaymentDto,
  TokenizedChargeDto,
  ValidateChargeDto,
} from './payment.dto';

@Injectable()
export class FlutterwaveSuperfanService {
  private flutterwaveAccessToken: string | null = null;
  private flutterwaveTokenExpiresIn = 0;
  private flutterwaveLastTokenRefreshTime = 0;
  constructor(
    private readonly httpService: HttpService,
    private flutterwave: FlutterwaveService,
  ) {}

  async getFlwToken(): Promise<string> {
    const clientId = process.env.FLW_CLIENT_ID;
    const clientSecret = process.env.FLW_CLIENT_SECRET;

    const currentTime = Date.now();
    const elapsedSeconds =
      (currentTime - this.flutterwaveLastTokenRefreshTime) / 1000;
    const timeLeft = this.flutterwaveTokenExpiresIn - elapsedSeconds;

    if (this.flutterwaveAccessToken && timeLeft > 60) {
      return this.flutterwaveAccessToken;
    }

    try {
      const tokenUrl =
        process.env.FLUTTERWAVE_AUTH_URI ??
        'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token';

      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      this.flutterwaveAccessToken = response.data.access_token;
      this.flutterwaveTokenExpiresIn = response.data.expires_in;
      this.flutterwaveLastTokenRefreshTime = currentTime;

      return this.flutterwaveAccessToken;
    } catch (error: any) {
      console.error(
        'Flutterwave Token Error:',
        error.response?.data || error.message,
      );

      throw new HttpException(
        error.response?.data?.message || 'Failed to generate Flutterwave token',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Create a customer in Flutterwave
   * @param dto - Customer creation data
   * @returns Customer data from Flutterwave API
   */

  async createCustomer(dto: CreateCustomerDto): Promise<any> {
    try {
      const url = `${process.env.FLUTTERWAVE_URI}/customers`;
      const token = await this.getFlwToken();

      const response = await axios.post(
        url,
        {
          email: dto.email,
          name: {
            first: dto.firstName,
            last: dto.lastName,
          },
          phone: {
            country_code: dto.country_code,
            number: dto.number,
          },
          address: {
            city: dto.city,
            country: dto.country,
            line1: dto.line1,
            postal_code: dto.postal_code,
            state: dto.state,
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
      const flutterwaveError = error.response?.data;

      // ✅ Handle "Customer already exists"
      if (
        flutterwaveError?.error?.code === '10409' ||
        flutterwaveError?.error?.message?.includes('Customer already exists')
      ) {
        const existingCustomer = await this.findCustomerByEmail(dto.email);

        if (!existingCustomer) {
          throw new Error(
            'Customer exists on Flutterwave but could not be retrieved',
          );
        }

        return {
          status: 'success',
          data: existingCustomer,
        };
      }

      throw new HttpException(
        flutterwaveError ?? { message: error.message },
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createPaymentPlan(dto: CreatePaymentPlanDto) {
    try {
      // 1. Call Flutterwave API
      // const token = await this.getFlwToken();
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.FLUTTERWAVE_V3_URI}/v3/payment-plans`,
          dto,
          {
            headers: {
              Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      const flwData = response.data?.data;

      // 2. Save to DB
      const paymentPlan = await prisma.paymentPlan.create({
        data: {
          name: dto.name, // your plan name
          amount: dto.amount?.toString(),
          interval: dto.interval,
          duration: dto.duration,
          payment_plan_id: flwData.id.toString(), // 👈 IMPORTANT
        },
      });

      // 3. Return both API + DB record (optional)
      return {
        flutterwave: response.data,
        saved: paymentPlan,
      };
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Flutterwave error',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getPaymentPlan() {
    try {
      const get_plan = await prisma.paymentPlan.findMany({});

      return get_plan;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Flutterwave error',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async activateSubscription(subscriptionId: string) {
    try {
      const url = `${process.env.FLUTTERWAVE_V3_URI}/v3/subscriptions/${subscriptionId}/activate`;

      const response = await firstValueFrom(
        this.httpService.put(
          url,
          {}, // PUT body is empty
          {
            headers: {
              Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
              'Content-Type': 'application/json',
              accept: 'application/json',
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to activate subscription',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createBeneficiary(dto: CreateBeneficiaryDto) {
    try {
      const response = await axios.post(
        `${process.env.FLUTTERWAVE_V3_URI}/v3/beneficiaries`,
        dto,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Flutterwave request failed',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getBanks(country: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${process.env.FLUTTERWAVE_V3_URI}/banks`, {
          params: { country },
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            accept: 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Failed to fetch banks',
        error?.response?.status || 500,
      );
    }
  }

  async createPaymentMethod(userId: number, dto: CreatePaymentMethodDto) {
    try {
      const token = await this.getFlwToken();

      const find_user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          flw_customer_id: true,
        },
      });

      if (!find_user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      if (!find_user.flw_customer_id) {
        throw new HttpException(
          'User does not have a Flutterwave customer ID',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 🔐 Encrypt card fields if type = card
      let encryptedCard = dto.card;

      if (dto.type === 'card' && dto.card) {
        const encryptionKey = process.env.FLW_ENCRYPTION_KEY; // base64 encoded key
        const nonce = dto.card.nonce;

        if (!encryptionKey) {
          throw new Error('Missing Flutterwave encryption key');
        }

        encryptedCard = {
          ...dto.card,
          encrypted_card_number: await encryptAES(
            dto.card.encrypted_card_number,
            encryptionKey,
            nonce,
          ),
          encrypted_cvv: await encryptAES(
            dto.card.encrypted_cvv,
            encryptionKey,
            nonce,
          ),
          encrypted_expiry_month: await encryptAES(
            dto.card.encrypted_expiry_month,
            encryptionKey,
            nonce,
          ),
          encrypted_expiry_year: await encryptAES(
            dto.card.encrypted_expiry_year,
            encryptionKey,
            nonce,
          ),
        };
      }

      // ✅ Final payload
      const payload = {
        ...dto,
        card: encryptedCard,
        customer_id: find_user.flw_customer_id,
      };

      const response = await axios.post(
        `${process.env.FLUTTERWAVE_V3_URI}/v3/payment-methods`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || error.message || 'Flutterwave error',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getPaymentMethods(id: string) {
    try {
      const url = `${process.env.FLUTTERWAVE_URI}/payment-methods/${id}`;
      const token = await this.getFlwToken();

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            accept: 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new Error(
        error?.response?.data?.message || 'Failed to fetch payment methods',
      );
    }
  }

   async resendTransactionHook(
    transactionId: string,
  ): Promise<any> {
    // const params = wait !== undefined ? `?wait=${wait}` : '';
    const url = `${process.env.FLUTTERWAVE_V3_URI}/v3/transactions/${transactionId}/resend-hook?wait=1`;
 
    try {
      const response = await firstValueFrom(
        this.httpService.post(url, {}, {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          }
        }),
      );
 
      return response.data;
    } catch (error) {
      const axiosError = error as any;
 
      if (axiosError.response) {
        throw new HttpException(
          axiosError.response.data?.message || 'Flutterwave API error',
          axiosError.response.status,
        );
      }
 
      throw new HttpException(
        'Failed to connect to Flutterwave API',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // async chargeCard(dto: FlwChargeCardDto) {
  //   const cleanCardNumber = dto.card_number.replace(/\s+/g, '');

  //   const bin = cleanCardNumber.slice(0, 6);
  //   const payload = {
  //     card_number: dto.card_number,
  //     cvv: dto.cvv,
  //     expiry_month: dto.expiry_month,
  //     expiry_year: dto.expiry_year,
  //     currency: dto.currency,
  //     amount: dto.amount,
  //     email: dto.email,
  //     tx_ref: dto.tx_ref,
  //   };

  //   const encryptionKey = process.env.FLW_ENCRYPTION_KEY;
  //   if (!encryptionKey) {
  //     throw new Error('Missing Flutterwave encryption key');
  //   }

  //   const encrypted = encrypt3DES(encryptionKey, payload);
  //   console.log(encrypted, 'log encrypted payload');

  //   const response = await firstValueFrom(
  //     this.httpService.post(
  //       'https://api.flutterwave.com/v3/charges?type=card',
  //       {
  //         client: encrypted,
  //       },
  //       {
  //         headers: {
  //           Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
  //         },
  //       },
  //     ),
  //   );
  //   // console.log(payload, 'log original payload');

  //   // return cardCharge;

  //   return response.data;
  // }

  async chargeCard(dto: FlwChargeCardDto, userId: number) {
  const reference = `CARD_${Date.now()}_${userId}`;

  const url = 'https://api.flutterwave.com/v3/charges?type=card';

      const payload = {
      card_number: dto.card_number,
      cvv: dto.cvv,
      expiry_month: dto.expiry_month,
      expiry_year: dto.expiry_year,
      currency: dto.currency,
      amount: dto.amount,
      email: dto.email,
      tx_ref: dto.tx_ref,
    };

      const encryptionKey = process.env.FLW_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('Missing Flutterwave encryption key');
    }

    const encrypted = encrypt3DES(encryptionKey, payload);

  const response = await firstValueFrom(
    this.httpService.post(url, {client: encrypted}, {
      headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }),
  );

  const flwData = response.data;

  // 🔥 create tracking record
  await prisma.cardFunding.create({
    data: {
      userId,
      amount: dto.amount,
      currency: dto.currency,
      reference,
      flwRef: flwData?.data?.flw_ref,
      status: 'PENDING',
      cardLast4: dto.card_number.slice(-4),
    },
  });

  return {
    reference,
    flwResponse: flwData,
  };
}

async validateCharge(dto: ValidateChargeDto) {
  try {
    const url = 'https://api.flutterwave.com/v3/validate-charge';

    const response = await firstValueFrom(
      this.httpService.post(url, dto, {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }),
    );

    const flw = response.data;

    // 🔥 update card funding record
    await prisma.cardFunding.updateMany({
      where: { flwRef: dto.flw_ref },
      data: {
        status: flw.status,
      },
    });

    // Get tx_ref from response and verify transaction to save card token
    const tx_ref = flw.data?.tx_ref;
    if (tx_ref) {
  const verifyResponse = await this.verifyTransactionByReference(tx_ref);

  const card = verifyResponse.data?.card;

  if (card && card.token) {
    // Find userId from cardFunding
    const cardFunding = await prisma.cardFunding.findFirst({
      where: { flwRef: dto.flw_ref },
      select: { userId: true },
    });

    if (cardFunding) {
      // Check if card already exists
      const existingCard = await prisma.userCard.findFirst({
        where: {
          userId: cardFunding.userId,
          cardToken: card.token,
        },
      });

      // Save card only if it does not already exist
      if (!existingCard) {
        await prisma.userCard.create({
          data: {
            userId: cardFunding.userId,
            cardToken: card.token,
            cardNumber: card.first_6digits && card.last_4digits
              ? `${card.first_6digits}******${card.last_4digits}`
              : null,
            maskedPan: card.mask || null,
            cardType: card.type || null,
            expiry:
              card.expiry_month && card.expiry_year
                ? `${card.expiry_month}/${card.expiry_year}`
                : null,
            issuer: card.issuer || null,
            country: card.country || null,
            isDefault: false,
          },
        });
      }
    }
  }
}

    return {
      status: flw.status,
      message: flw.message,
      data: flw.data,
    };
  } catch (error: any) {
    throw new HttpException(
      error?.response?.data || 'Flutterwave validation failed',
      error?.response?.status || 500,
    );
  }
}

  async verifyTransactionByReference(tx_ref: string) {
    try {
      const url = `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`;

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data; // return only API response
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Flutterwave verification failed',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // async validateCharge(dto: ValidateChargeDto) {
  //   try {
  //     const url = 'https://api.flutterwave.com/v3/validate-charge';

  //     const response = await firstValueFrom(
  //       this.httpService.post(url, dto, {
  //         headers: {
  //           Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
  //           'Content-Type': 'application/json',
  //         },
  //       }),
  //     );

  //     const { data } = response;
  //     return {
  //       status: data.status,
  //       message: data.message,
  //       data: data.data,
  //     };
  //   } catch (error: any) {
  //     throw new HttpException(
  //       error?.response?.data || 'Flutterwave validation failed',
  //       error?.response?.status || 500,
  //     );
  //   }
  // }

  //   async validateCharge(dto: ValidateChargeDto) {
  //   try {
  //     const url = 'https://api.flutterwave.com/v3/validate-charge';

  //     const response = await firstValueFrom(
  //       this.httpService.post(url, dto, {
  //         headers: {
  //           Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
  //           'Content-Type': 'application/json',
  //         },
  //       }),
  //     );

  //     return JSON.parse(JSON.stringify(response.data));
  //   } catch (error: any) {
  //     throw new HttpException(
  //       error?.response?.data || 'Flutterwave validation failed',
  //       error?.response?.status || 500,
  //     );
  //   }
  // }

  async createflwPayment(payload: StandardPaymentDto) {
    try {
      const url = `${process.env.FLUTTERWAVE_URI}/payments`;

      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Flutterwave payment failed',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createTransfer(dto: CreateTransferDto) {
    try {
      const idempotencyKey = this.generateIdempotencyKey();
      const traceId = this.generateTraceId();
      const url = `${process.env.FLUTTERWAVE_V3_URI}/v3/transfers`;
      const response = await axios.post(
        url,
        {
          ...dto,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
            'X-Trace-Id': traceId,
            'X-Idempotency-Key': idempotencyKey,
            'X-Scenario-Key': 'scenario:successful',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Flutterwave transfer failed',
        error.response?.status || 500,
      );
    }
  }
  

    async getTransferFee(
    amount: number,
    currency: string,
  ) {
    try {
      const response = await axios.get(
        `${process.env.FLUTTERWAVE_V3_URI}/v3/transfers/fee`,
        {
          params: {
            amount,
            currency,
            type: 'crypto',
          },
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          },
        },
      );

      return response.data;
    } catch (error) {
      throw new HttpException(
        error?.response?.data || 'Failed to fetch transfer fee',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTransferById(id: string) {
    try {
      const url = `${process.env.FLUTTERWAVE_V3_URI}/v3`;
      const response = await axios.get(`${url}/transfers/${id}`, {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
      });

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Error fetching transfer',
        error.response?.status || 500,
      );
    }
  }

  async flwBankTransfer(payload: BankTransferDto) {
    try {
      const url = `${process.env.FLUTTERWAVE_URI}/charges?type=bank_transfer`;

      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error?.response?.data || 'Flutterwave bank transfer failed',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async listCustomers(page = 1, size = 50): Promise<any[]> {
    const url = `${process.env.FLUTTERWAVE_URI}/customers?page=${page}&size=${size}`;
    const token = await this.getFlwToken();

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data?.data || [];
  }

    async tokenizedCharge(payload: TokenizedChargeDto) {
    try {
      const baseUrl = 'https://api.flutterwave.com/v3';
      const response = await axios.post(
        `${baseUrl}/tokenized-charges`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error('Flutterwave Tokenized Charge Error:', error);

      if (error.response) {
        throw new BadRequestException(error.response.data);
      }

      throw new InternalServerErrorException(
        'Unable to process tokenized charge',
      );
    }
  }

  async createPayoutSubaccount(dto: CreatePayoutSubaccountDto) {
    const baseUrl = 'https://api.flutterwave.com/v3';

    try {
      // 1. Fetch all payout subaccounts
      const existing = await axios.get(`${baseUrl}/payout-subaccounts`, {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const subaccounts = existing.data?.data || [];

      // 2. Check if email already exists
      const found = subaccounts.find(
        (acc: any) => acc.email?.toLowerCase() === dto.email.toLowerCase(),
      );

      if (found) {
        return {
          message: 'Payout subaccount already exists',
          data: found,
        };
      }

      // 3. Create new subaccount if not found
      const response = await axios.post(`${baseUrl}/payout-subaccounts`, dto, {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Flutterwave request failed',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async fundSubaccount(accountReference: string, dto: FundPayoutSubaccountDto) {
    try {
      const idempotencyKey = this.generateIdempotencyKey();
      const traceId = this.generateTraceId();

      const baseUrl = 'https://api.flutterwave.com/v3';
      const response = await axios.post(
        `${baseUrl}/payout-subaccounts/${accountReference}/fund-account`,
        dto,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
            'X-Trace-Id': traceId,
            'X-Idempotency-Key': idempotencyKey,
            'X-Scenario-Key': 'scenario:successful',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to fund payout subaccount',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async verifyTransaction(transactionId: string) {
    try {
      const baseUrl = 'https://api.flutterwave.com/v3';
      const response = await axios.get(
        `${baseUrl}/transactions/${transactionId}/verify`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Error verifying transaction',
        error.response?.status || 500,
      );
    }
  }

  //     async fetchStaticVirtualAccount(
  //     accountReference: string,
  //     currency: string = 'NGN',
  //     verbose: number = 1,
  //   ) {
  //     try {
  //       // Check if accountReference is attached to a user (inside accounts array)
  //       const user = await prisma.$queryRaw`
  //         SELECT *
  //         FROM "User"
  //         WHERE EXISTS (
  //           SELECT 1
  //           FROM jsonb_array_elements("accounts") elem
  //           WHERE elem->>'accountReference' = ${accountReference}
  //         )
  //         LIMIT 1;
  // `;
  //       console.log(user, 'log static virtual account')

  //       if (!user) {
  //         throw new HttpException('User not found for this account reference', HttpStatus.NOT_FOUND);
  //       }

  //       const baseUrl = 'https://api.flutterwave.com/v3';
  //       const response = await axios.get(
  //         `${baseUrl}/payout-subaccounts/${accountReference}/static-account`,
  //         {
  //           params: {
  //             currency,
  //             verbose,
  //           },
  //           headers: {
  //             Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
  //             'Content-Type': 'application/json'
  //           },
  //         },
  //       );

  //       // Update user's accounts with response.data.data
  //               const existingUser = await prisma.user.findUnique({
  //           where: { id: user[0].id },
  //           select: { accounts: true },
  //         });

  //         const existingAccounts = (existingUser?.accounts as any[]) || [];

  //         const newAccounts = response.data.data;
  //         // console.log(newAccounts, 'log newAccounts');

  //         // If it's a single object, wrap it
  //         const accountsToAdd = Array.isArray(newAccounts)
  //           ? newAccounts
  //           : [newAccounts];

  //         // Optional: prevent duplicates (by accountReference)
  //         const mergedAccounts = [
  //           ...existingAccounts,
  //           ...accountsToAdd.filter(
  //             (newAcc) =>
  //               !existingAccounts.some(
  //                 (acc) => acc.accountReference === newAcc.accountReference
  //               )
  //           ),
  //         ];
  //         console.log(mergedAccounts, 'log merged accounts')

  //         await prisma.user.update({
  //           where: { id: user[0].id },
  //           data: {
  //             accounts: mergedAccounts,
  //           },
  //         });

  //       return response.data;
  //     } catch (error: any) {
  //       throw new HttpException(
  //         error.response?.data || 'Failed to fetch static virtual account',
  //         error.response?.status || 500,
  //       );
  //     }
  //   }
  // async fetchStaticVirtualAccount(
  //   accountReference: string,
  //   currency: string = 'NGN',
  //   verbose: number = 1,
  // ) {
  //   try {
  //     const user = await prisma.$queryRaw`
  //     SELECT *
  //     FROM "User"
  //     WHERE EXISTS (
  //       SELECT 1
  //       FROM jsonb_array_elements("accounts") elem
  //       WHERE elem->>'accountReference' = ${accountReference}
  //     )
  //     LIMIT 1;
  //   `;

  //     // $queryRaw returns [] not null — check length
  //     if (!user || (user as any[]).length === 0) {
  //       throw new HttpException(
  //         'User not found for this account reference',
  //         HttpStatus.NOT_FOUND,
  //       );
  //     }

  //     const baseUrl = 'https://api.flutterwave.com/v3';
  //     const response = await axios.get(
  //       `${baseUrl}/payout-subaccounts/${accountReference}/static-account`,
  //       {
  //         params: { currency, verbose },
  //         headers: {
  //           Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
  //           'Content-Type': 'application/json',
  //         },
  //       },
  //     );

  //     const existingUser = await prisma.user.findUnique({
  //       where: { id: (user as any[])[0].id },
  //       select: { accounts: true },
  //     });

  //     const existingAccounts = (existingUser?.accounts as any[]) || [];
  //     const newAccounts = response.data.data;
  //     const accountsToAdd = Array.isArray(newAccounts)
  //       ? newAccounts
  //       : [newAccounts];

  //     // Use accountNumber as the stable dedup key (works across all account shapes)
  //     const mergedAccounts = [
  //       ...existingAccounts,
  //       ...accountsToAdd.filter(
  //         (newAcc) =>
  //           !existingAccounts.some(
  //             (acc) => acc.accountNumber === newAcc.accountNumber,
  //           ),
  //       ),
  //     ];

  //     await prisma.user.update({
  //       where: { id: (user as any[])[0].id },
  //       data: { accounts: mergedAccounts },
  //     });

  //     return response.data;
  //   } catch (error: any) {
  //     console.log(error, 'log error in fetchStaticVirtualAccount');
  //     throw new HttpException(
  //       error.response?.data || 'Failed to fetch static virtual account',
  //       error.response?.status || 500,
  //     );
  //   }
  // }

  async fetchStaticVirtualAccount(
  accountReference: string,
  currency: string = 'NGN',
  verbose: number = 1,
) {
  try {
    // Use jsonb_each to iterate over object values instead of jsonb_array_elements
    const user = await prisma.$queryRaw`
      SELECT *
      FROM "User"
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_each("accounts") kv
        WHERE kv.value->>'accountReference' = ${accountReference}
      )
      LIMIT 1;
    `;

    if (!user || (user as any[]).length === 0) {
      throw new HttpException(
        'User not found for this account reference',
        HttpStatus.NOT_FOUND,
      );
    }

    const baseUrl = 'https://api.flutterwave.com/v3';
    const response = await axios.get(
      `${baseUrl}/payout-subaccounts/${accountReference}/static-account`,
      {
        params: { currency, verbose },
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const existingUser = await prisma.user.findUnique({
      where: { id: (user as any[])[0].id },
      select: { accounts: true },
    });

    // Convert object shape {"0": {...}, "1": {...}} to a flat array
    const rawAccounts = existingUser?.accounts as any;
    const existingAccounts: any[] = rawAccounts
      ? Array.isArray(rawAccounts)
        ? rawAccounts
        : Object.values(rawAccounts)
      : [];

    const newAccounts = response.data.data;
    const accountsToAdd = Array.isArray(newAccounts)
      ? newAccounts
      : [newAccounts];

    const mergedAccounts = [
      ...existingAccounts,
      ...accountsToAdd.filter(
        (newAcc) =>
          !existingAccounts.some(
            (acc) => acc.accountNumber === newAcc.accountNumber,
          ),
      ),
    ];

    // Save back as a proper array — fixes the shape going forward
    await prisma.user.update({
      where: { id: (user as any[])[0].id },
      data: { accounts: mergedAccounts },
    });

    return response.data;
  } catch (error: any) {
    console.log(error, 'log error in fetchStaticVirtualAccount');
    throw new HttpException(
      error.response?.data || 'Failed to fetch static virtual account',
      error.response?.status || 500,
    );
  }
}

  async getSubaccountBalance(accountReference: string, currency: string) {
    try {
      const baseUrl = 'https://api.flutterwave.com/v3';
      const response = await axios.get(
        `${baseUrl}/payout-subaccounts/${accountReference}/balances`,
        {
          params: { currency },
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Failed to fetch subaccount balance',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getSubaccountTransactions(
    accountReference: string,
    query: GetTransactionsDto,
  ) {
    try {
      const baseUrl = 'https://api.flutterwave.com/v3';
      const response = await axios.get(
        `${baseUrl}/payout-subaccounts/${accountReference}/transactions`,
        {
          params: {
            from: query.from,
            to: query.to,
            currency: query.currency,
          },
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json',
            accept: 'application/json',
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

  async createVirtualAccount(dto: CreateVirtualAccountDto) {
    try {
      // Check if virtual account already exists for this customer
      let existingAccount = null;
      let page = 1;
      let accounts: any[] = [];
      do {
        accounts = await this.listVirtualAccounts(page, 50);
        existingAccount = accounts.find(
          (acc) => acc.customer_id === dto.customer_id,
        );
        if (existingAccount) break;
        page++;
      } while (accounts.length === 50);

      if (existingAccount) {
        return { status: 'success', data: existingAccount };
      }

      const url = 'https://developersandbox-api.flutterwave.com';
      const token = await this.getFlwToken();
      const response = await axios.post(`${url}/virtual-accounts`, dto, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Flutterwave API error',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async listVirtualAccounts(page = 1, size = 50): Promise<any[]> {
    const url = 'https://developersandbox-api.flutterwave.com';
    const token = await this.getFlwToken();

    const response = await axios.get(
      `${url}/virtual-accounts?page=${page}&size=${size}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
      },
    );

    return response.data?.data || [];
  }

  async findCustomerByEmail(email: string): Promise<any | null> {
    let page = 1;
    let customers: any[] = [];

    do {
      customers = await this.listCustomers(page, 50);

      const match = customers.find(
        (cust) => cust.email.toLowerCase() === email.toLowerCase(),
      );

      if (match) return match;

      page++;
    } while (customers.length === 50); // continue if more pages

    return null;
  }

  private generateIdempotencyKey(): string {
    return randomBytes(24) // 24 bytes → 48 hex chars
      .toString('hex') // hex = alphanumeric ✔
      .slice(0, 48); // ensure controlled length
  }

  private generateTraceId(): string {
    return `trace${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }
}
