import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import axios from 'axios';
import { decrypt, encrypt } from '../common/helpers/encryption.helper';
import { prisma } from '../prisma/prisma';
import { BushaService } from './busha.service';
import {
  CreateUserWithdrawalBankDto,
  CreateUserWithdrawalWalletDto,
  PaymentProcessorDto,
} from './payment.dto';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PaymentService {
  constructor(
    private readonly httpService: HttpService, private readonly bushaService: BushaService,
    private readonly walletService: WalletService
  ) {}

  private readonly FX_API = 'https://v6.exchangerate-api.com/v6/622e9d300a3d46d600506853/latest/USD';


  async getPaymentProcessors(): Promise<any> {
    try {
      const processors = await prisma.paymentProcessor.findMany();
      return processors;
    } catch (error: any) {
      console.error('Database Error:', error);
      throw new InternalServerErrorException(
        'Failed to fetch payment processors',
      );
    }
  }

  
  // create conversion to USDT, USD
    async convertNgnToUsd(amount: number): Promise<any> {
    try {
      const { data } = await axios.get(this.FX_API);

      const rate = data.conversion_rates.NGN;

      if (!rate) {
        throw new Error('USD rate not found');
      }

      return {value: amount * rate};
    } catch (error) {
      throw new HttpException(
        'Failed to fetch exchange rate',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async UpdatePaymentProcessors(dto: PaymentProcessorDto): Promise<any> {
    try {
       const data: any = {};
        if (dto.publicKey) {
    data.publicKey = dto.publicKey;
  }

  if (dto.secretKey) {
    data.secretKey = encrypt(dto.secretKey);
  }
      const processors = await prisma.paymentProcessor.update({
        where: { id: dto.id },
        data: {
          name: dto.name,
          secretKey: data.secretKey,
          publicKey: data.publicKey,
          isConnected: dto.isConnected,
          lastSync: dto.lastSync,
        },
      });
      return processors;
    } catch (error: any) {
      console.error('Database Error:', error);
      throw new InternalServerErrorException(
        'Failed to fetch payment processors',
      );
    }
  }

  async createWithdrawalBank(userId: number, dto: CreateUserWithdrawalBankDto) {
    return prisma.userWithdrawalBank.create({
      data: {
        accountName: dto.accountName,
        accountNumber: dto.accountNumber,
        bankName: dto.bankName,
        bankCode: dto.bankCode,
        userId: userId,
      },
    });
  }

  async getUserWithdrawalBanks(userId: number) {
    return prisma.userWithdrawalBank.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getExchangeRate(currency: string) {
    try {
      return prisma.exchangeRate.findFirst({
        where: { fromCurrency: currency },
      });
    } catch(error) {
        throw new InternalServerErrorException('Failed to fetch exchange rate');
    }
  }

  async findOneWithdrawalBank(id: number) {
    return prisma.userWithdrawalBank.findUnique({
      where: { id },
    });
  }

  async createWithdrawalWallet(userId: number, dto: CreateUserWithdrawalWalletDto) {


    // saves result to bushaService.createRecipient, 
    let save_busha_recipient = await this.bushaService.createRecipient({
      address: dto.walletAddress,
      currency: dto.symbol,
      currency_id: dto.symbol,
      country_id: dto.country,
      type: 'crypto',
      legal_entity_type: dto.legalEntityType,
      network: dto.network,
      one_time: false
    });

        let result = await prisma.userWithdrawalWallet.create({
      data: {
        walletAddress: dto.walletAddress,
        recipientId: save_busha_recipient.id,
        symbol: dto.symbol,
        network: dto.network,
        userId: userId,
      },
    });

    return result;
  }

  async getUserWithdrawalWallets(userId: number) {
    return prisma.userWithdrawalWallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async fetchWalletTransactions() {
    try {
      const transactions = await prisma.walletTransaction.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return transactions;
    } catch (error: any) {
      console.error('Database Error:', error);
      throw new InternalServerErrorException(
        'Failed to fetch wallet transactions',
      );
    }
  }

  async findOneWithdrawalWallet(id: number) {
    return prisma.userWithdrawalWallet.findUnique({
      where: { id },
    });
  }

  async getWalletActivity(userId: number) {
    return prisma.activityWallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decryptKey(encryptedKey: string): Promise<string> {
    try {
      let decrypt_key = await decrypt(encryptedKey);
      return decrypt_key;
    } catch (error: any) {
      console.error('Decryption Error:', error);
      throw new InternalServerErrorException('Failed to decrypt key');
    }
  }

  }
