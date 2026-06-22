import { BadRequestException, HttpException, HttpStatus, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import axios from "axios";
import { prisma } from "../prisma/prisma";
import { createBeneficiary, CreateBitnobCustomerDto, CreatePayoutQuoteDto, CreateWithdrawalDto, GenerateAddressDto, InitializePayoutDto, UpdateBitnobCustomerDto, ValidateAddressDto } from "./payment.dto";
const crypto = require("crypto");

@Injectable()

export class BitnobService {
     private readonly baseUrl = 'https://api.bitnob.com';

    async getAuthHeaders(body = null) {
        let clientId = process.env.BITNOB_CLIENT_KEY;
        let clientSecret = process.env.BITNOB_SECRET_KEY;
  if (!clientId || !clientSecret) {
    throw new Error("CLIENT_ID or CLIENT_SECRET is not provided");
  }

  // Timestamp in seconds
  const timestamp = Math.floor(Date.now() / 1000);

  // 16-byte random nonce, hex-encoded
  const nonce = crypto.randomBytes(16).toString("hex");

  // Payload: stringify body if provided
  let payload = "";
  if (body) {
    payload = typeof body === "string"
      ? body
      : JSON.stringify(body);
  }

  // Build string to sign
  const stringToSign = `${clientId}:${timestamp}:${nonce}:${payload}`;

  // Generate HMAC-SHA256 signature
  const signature = crypto
    .createHmac("sha256", clientSecret)
    .update(stringToSign)
    .digest("hex");

  return {
    "X-Auth-Client": clientId,
    "X-Auth-Timestamp": timestamp.toString(),
    "X-Auth-Nonce": nonce,
    "X-Auth-Signature": signature,
  };
}

async createCustomer(dto: CreateBitnobCustomerDto) {
    const path = '/api/customers';
    
    const customerData = {
      email: dto.email,
      first_name: dto.first_name,
      last_name: dto.last_name,
      phone_number: dto.phone,
      country_code: dto.country_code,
      customer_type: 'individual',
      reference: `superfan-ref-${Date.now()}`,
    };
    const body = JSON.stringify(customerData);
    const authHeaders = await this.getAuthHeaders(body);
    try {
      const response = await axios.post(
        `${this.baseUrl}${path}`,
        body,
        {
          headers:{
                 'Content-Type': 'application/json',
      ...authHeaders,
          }
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Bitnob request failed',
        error.response?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  async initializePayout(dto: InitializePayoutDto) {
    const path = `/api/payouts/${dto.quote_id}/initialize`;
    
    // const customerData = {
    //   email: dto.email,
    //   first_name: dto.first_name,
    //   last_name: dto.last_name,
    //   phone_number: dto.phone,
    //   country_code: dto.country_code,
    //   customer_type: 'individual',
    //   reference: `superfan-ref-${Date.now()}`,
    // };
    // const body = JSON.stringify(customerData);
    const authHeaders = await this.getAuthHeaders(dto);
    try {
      const response = await axios.post(
        `${this.baseUrl}${path}`,
        dto,
        {
            headers:{
                  'Content-Type': 'application/json',
        ...authHeaders,
            }
        },
      );

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || 'Bitnob request failed',
        error.response?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  async createPayoutQuote(dto: CreatePayoutQuoteDto) {
  const path = '/api/payouts/quotes';
  const authHeaders = await this.getAuthHeaders(dto);

  try {
    const response = await axios.post(
      `${this.baseUrl}${path}`,
      dto,
      {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      },
    );

    const payout = response.data.data.payout;

    await prisma.exchangeRate.upsert({
      where: {
        fromCurrency_toCurrency: {
          fromCurrency: payout.from_asset,
          toCurrency: payout.to_currency,
        },
      },
      update: {
        rate: Number(payout.exchange_rate.rate),
        updatedAt: new Date(),
      },
      create: {
        fromCurrency: payout.from_asset,
        toCurrency: payout.to_currency,
        rate: Number(payout.exchange_rate.rate),
      },
    });

    return response.data;
  } catch (error) {
    throw new HttpException(
      error?.response?.data || 'Failed to create payout quote',
      error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

    async updateCustomer(
    customerId: string,
    body: UpdateBitnobCustomerDto
  ) {
    try {
      const path = `/api/customers/${customerId}`;

    const authHeaders = await this.getAuthHeaders(body);

      const response = await axios.put(
        `${this.baseUrl}${path}`,
        body,
        {headers:{
                 'Content-Type': 'application/json',
      ...authHeaders,
          }
        }
      );

      return response.data;
    } catch (error: any) {

      throw new HttpException(
        error.response?.data || 'Failed to update customer',
        error.response?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  async generateAddress(
    dto: GenerateAddressDto,
  ) {
    try {
      const path = '/api/addresses';

    const authHeaders = await this.getAuthHeaders(dto);

      const response = await axios.post(
        `${this.baseUrl}${path}`,
        dto,
        {
          headers: {
            'Content-Type':
              'application/json',
            ...authHeaders,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.log(error.response?.data);

      throw new HttpException(
        error.response?.data ||
          'Failed to generate address',
        error.response?.status ||
          HttpStatus.BAD_REQUEST,
      );
    }
  }

  async validateAddress(
    dto: ValidateAddressDto,
  ) {
    try {
      const path = '/api/addresses/validate';

    const authHeaders = await this.getAuthHeaders(dto);

      const response = await axios.post(
        `${this.baseUrl}${path}`,
        dto,
        {
          headers: {
            'Content-Type':
              'application/json',
            ...authHeaders,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.log(error.response?.data);

      throw new HttpException(
        error.response?.data ||
          'Failed to generate address',
        error.response?.status ||
          HttpStatus.BAD_REQUEST,
      );
    }
  }

// async createWithdrawal(
//   dto: CreateWithdrawalDto,
//   userId: number,
// ) {
//   try {
//     const wallet = await prisma.wallet.findFirst({
//       where: { userId },
//     });

//     if (!wallet) {
//       throw new NotFoundException('Wallet not found');
//     }

//     // const amount = Number(dto.amount);
//     const amount = Number(dto.amount);

// const amountInSmallestUnit = Math.round(amount * 1_000_000);


//     let availableBalance = 0;

//     switch (dto.currency.toUpperCase()) {
//       case 'USDT':
//         availableBalance = Number(wallet.usdtBalance);
//         break;

//       case 'USDC':
//         availableBalance = Number(wallet.usdcBalance);
//         break;

//       default:
//         throw new BadRequestException(
//           `Unsupported currency: ${dto.currency}`,
//         );
//     }

//     if (availableBalance < amount) {
//       throw new BadRequestException(
//         `Insufficient ${dto.currency} balance. Available: ${availableBalance}`,
//       );
//     }

//     const payload = {
//       ...dto,
//       type: 'debit',
//       reference:
//         dto.reference ??
//         `withdraw-${Date.now()}`,
//     };

//     const authHeaders =
//       await this.getAuthHeaders(
//         JSON.stringify(payload),
//       );

//     const response = await axios.post(
//       `${this.baseUrl}/api/withdrawals`,
//       payload,
//       {
//         headers: {
//           'Content-Type':
//             'application/json',
//           ...authHeaders,
//         },
//       },
//     );

//     await prisma.bitnobWithdrawal.create({
//       data: {
//         userId,
//         transactionId:
//           response.data.transaction_id,
//         status: response.data.status,
//         address: response.data.address,
//         amount: response.data.amount,
//         currency: response.data.currency,
//         chain: response.data.chain,
//         reference: response.data.reference,
//         memo: response.data.memo,
//         created_at: response.data.created_at,
//         description:
//           response.data.description,
//       },
//     });

//     return response.data;
//   } catch (error: any) {
//     console.error(
//       'Bitnob Withdrawal Error:',
//       error?.response?.data || error,
//     );

//     throw new InternalServerErrorException(
//       error?.response?.data ||
//         'Withdrawal failed',
//     );
//   }
// }

async createWithdrawal(
  dto: CreateWithdrawalDto,
  userId: number,
) {
  try {
    const wallet = await prisma.wallet.findFirst({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    // User enters 2 USDC/USDT
    const amount = Number(dto.amount);

    // Convert to smallest unit
    // 2 => 2000000
    // 0.1 => 100000
    const amountInSmallestUnit = Math.round(
      amount * 1_000_000,
    );

    let availableBalance = 0;

    switch (dto.currency.toUpperCase()) {
      case 'USDT':
        availableBalance = Number(wallet.usdtBalance);
        break;

      case 'USDC':
        availableBalance = Number(wallet.usdcBalance);
        break;

      default:
        throw new BadRequestException(
          `Unsupported currency: ${dto.currency}`,
        );
    }

    // Validate using normal balance
    if (availableBalance < amount) {
      throw new BadRequestException(
        `Insufficient ${dto.currency} balance. Available: ${availableBalance}`,
      );
    }

    const payload = {
      ...dto,
      amount: amountInSmallestUnit.toString(), // <-- send 2000000
      type: 'debit',
      reference:
        dto.reference ??
        `withdraw-${Date.now()}`,
    };

    console.log('Withdrawal Payload:', payload);

    const authHeaders =
      await this.getAuthHeaders(
        JSON.stringify(payload),
      );

    const response = await axios.post(
      `${this.baseUrl}/api/withdrawals`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      },
    );
    console.log(response, 'response is out')

    await prisma.bitnobWithdrawal.create({
      data: {
        userId,
        transactionId:
          response.data.data.transaction_id,
        status: response.data.data.status,
        address: response.data.data.address,
        amount: response.data.data.amount,
        currency: response.data.data.currency,
        chain: response.data.data.chain,
        reference: response.data.data.reference,
        memo: response.data.data.memo,
        created_at: response.data.data.created_at,
        description:
          response.data.data.description,
      },
    });

    return response.data;
  } catch (error: any) {
    console.error(
      'Withdrawal Error:',
      error.response.data.detail,
    );

    throw new InternalServerErrorException(
      error.response.data.detail ||
        'Withdrawal failed',
    );
  }
}

    async getQuotePrices() {
  try {
    const path = '/api/trading/prices'
    const authHeaders = await this.getAuthHeaders();
    const response = await axios.get(
      `${this.baseUrl}${path}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      },
    );

    return response.data;
  } catch (error: any) {
    console.log(error.response?.data);

    throw new HttpException(
      error.response?.data || 'Failed to fetch customers',
      error.response?.status || HttpStatus.BAD_REQUEST,
    );
  }
}


  async getSupportedChains() {
  try {
    const path = '/api/stablecoins/supported-chains'
    const authHeaders = await this.getAuthHeaders();
    const response = await axios.get(
      `${this.baseUrl}${path}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      },
    );

    return response.data;
  } catch (error: any) {
    console.log(error.response?.data);

    throw new HttpException(
      error.response?.data || 'Failed to fetch customers',
      error.response?.status || HttpStatus.BAD_REQUEST,
    );
  }
}

  async createBeneficiary(
    dto: createBeneficiary,
  ) {
    try {
      const path = '/api/beneficiaries';

    const authHeaders = await this.getAuthHeaders(dto);

      const response = await axios.post(
        `${this.baseUrl}${path}`,
        dto,
        {
          headers: {
            'Content-Type':
              'application/json',
            ...authHeaders,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.log(error.response?.data);

      throw new HttpException(
        error.response?.data ||
          'Failed to generate address',
        error.response?.status ||
          HttpStatus.BAD_REQUEST,
      );
    }
  }


async getCustomers(query: {
  customer_type?: string;
  email?: string;
  is_active?: boolean;
}) {
  try {
    const params = new URLSearchParams();

    if (query.customer_type) {
      params.append(
        'customer_type',
        query.customer_type,
      );
    }

    if (query.email) {
      params.append('email', query.email);
    }

    if (query.is_active !== undefined) {
      params.append(
        'is_active',
        String(query.is_active),
      );
    }

    const queryString = params.toString();

    // FULL PATH INCLUDING QUERY
    const path = queryString
      ? `/api/customers?${queryString}`
      : '/api/customers';

    // IMPORTANT:
    // Pass method + full path + empty body
    const authHeaders = await this.getAuthHeaders(
      query
    );


    const response = await axios.get(
      `${this.baseUrl}${path}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      },
    );

    return response.data;
  } catch (error: any) {
    console.log(error.response?.data);

    throw new HttpException(
      error.response?.data || 'Failed to fetch customers',
      error.response?.status || HttpStatus.BAD_REQUEST,
    );
  }
}

async getBalance() {
  try {
    const path = '/api/balances';
    const authHeaders = await this.getAuthHeaders();
    
    const response = await axios.get(
      `${this.baseUrl}${path}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      },
    );

    return response.data;
  } catch (error: any) {
    console.log(error.response?.data);

    throw new HttpException(
      error.response?.data || 'Failed to fetch balance',
      error.response?.status || HttpStatus.BAD_REQUEST,
    );
  }
}

async processPayout() {
  
}

async simulatePayment(address: string, amount: string) {
  // POST /api/payouts/simulate-address-deposit
    try {
    const path = '/api/addresses/simulate-deposit';
    const authHeaders = await this.getAuthHeaders({address, amount});
    
    const response = await axios.post(
      `${this.baseUrl}${path}`,
      {address, amount},
      {
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      },
    );

    return response.data;
  } catch (error: any) {
    console.log(error.response?.data);

    throw new HttpException(
      error.response?.data || 'Failed to fetch balance',
      error.response?.status || HttpStatus.BAD_REQUEST,
    );
  }
}
}