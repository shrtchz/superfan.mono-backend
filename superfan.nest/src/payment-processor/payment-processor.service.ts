import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { ConfigurePaymentProcessorDto } from './dto/payment-processor.dto';

const DEFAULT_PROCESSORS = ['monnify', 'flutterwave', 'busha', 'cngn', 'bachs'] as const;
const FIAT_GATEWAYS = ['monnify', 'flutterwave', 'bachs'];

@Injectable()
export class PaymentProcessorService implements OnModuleInit {
  private readonly logger = new Logger(PaymentProcessorService.name);

  async onModuleInit() {
    try {
      await this.ensureDefaultProcessors();
    } catch (err: any) {
      this.logger.warn(`Failed to auto-seed default processors on startup: ${err?.message}`);
    }
  }

  async ensureDefaultProcessors() {
    for (const name of DEFAULT_PROCESSORS) {
      const existing = await prisma.paymentProcessor.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });

      if (!existing) {
        let envPublicKey: string | null = null;
        let envSecretKey: string | null = null;

        if (name === 'monnify') {
          envPublicKey = process.env.PROD_MONNIFY_API_KEY || process.env.MONNIFY_API_KEY || null;
          envSecretKey = process.env.PROD_MONNIFY_SECRET_KEY || process.env.MONNIFY_SECRET_KEY || null;
        } else if (name === 'flutterwave') {
          envPublicKey = process.env.FLW_PUBLIC_KEY || process.env.FLUTTERWAVE_PUBLIC_KEY || null;
          envSecretKey = process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || null;
        } else if (name === 'bachs') {
          envPublicKey = process.env.BACHS_PUBLIC_KEY || null;
          envSecretKey = process.env.BACHS_SECRET_KEY || null;
        } else if (name === 'busha') {
          envPublicKey = process.env.BUSHA_PUBLIC_KEY || null;
          envSecretKey = process.env.BUSHA_SECRET_KEY || null;
        } else if (name === 'cngn') {
          envPublicKey = process.env.CNGN_PUBLIC_KEY || null;
          envSecretKey = process.env.CNGN_SECRET_KEY || null;
        }

        await prisma.paymentProcessor.create({
          data: {
            name,
            publicKey: envPublicKey,
            secretKey: envSecretKey,
            isEnabled: name === 'monnify',
            isConnected: name === 'monnify',
            lastSync: new Date(),
          },
        });
      }
    }
  }

  async getAllProcessors() {
    await this.ensureDefaultProcessors();
    return prisma.paymentProcessor.findMany({
      orderBy: { id: 'asc' },
    });
  }

  async getActiveProcessor(): Promise<{ activeProcessor: string; processor: any }> {
    await this.ensureDefaultProcessors();
    const active = await prisma.paymentProcessor.findFirst({
      where: {
        isEnabled: true,
        name: { in: FIAT_GATEWAYS, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (active) {
      return {
        activeProcessor: active.name.toLowerCase(),
        processor: active,
      };
    }

    return {
      activeProcessor: 'monnify',
      processor: null,
    };
  }

  async toggleProcessor(id: number) {
    const processor = await prisma.paymentProcessor.findUnique({
      where: { id },
    });

    if (!processor) {
      throw new NotFoundException(`Payment processor with id ${id} not found`);
    }

    const nextState = !processor.isEnabled;
    const procNameLower = processor.name.toLowerCase();

    // If enabling a fiat processor, turn off other fiat card/transfer processors
    // so exactly this one processor is used to accept payments for cards & transfers
    if (nextState && FIAT_GATEWAYS.includes(procNameLower)) {
      await prisma.paymentProcessor.updateMany({
        where: {
          id: { not: id },
          name: { in: FIAT_GATEWAYS, mode: 'insensitive' },
        },
        data: {
          isEnabled: false,
          isConnected: false,
        },
      });
    }

    const updated = await prisma.paymentProcessor.update({
      where: { id },
      data: {
        isEnabled: nextState,
        isConnected: nextState,
        lastSync: new Date(),
      },
    });

    this.logger.log(`Toggled processor ${processor.name} (id: ${id}) -> ${nextState ? 'ON' : 'OFF'}`);
    return updated;
  }

  async toggleCngn() {
    let cngn = await prisma.paymentProcessor.findFirst({
      where: { name: { equals: 'cngn', mode: 'insensitive' } },
    });

    if (!cngn) {
      cngn = await prisma.paymentProcessor.create({
        data: {
          name: 'cngn',
          isEnabled: false,
          isConnected: false,
          lastSync: new Date(),
        },
      });
    }

    return this.toggleProcessor(cngn.id);
  }

  async configureProcessor(idOrName: number | string, dto: ConfigurePaymentProcessorDto) {
    let target = null;
    if (typeof idOrName === 'number' || !isNaN(Number(idOrName))) {
      target = await prisma.paymentProcessor.findUnique({
        where: { id: Number(idOrName) },
      });
    } else {
      target = await prisma.paymentProcessor.findFirst({
        where: { name: { equals: String(idOrName), mode: 'insensitive' } },
      });
    }

    const name = dto.name || (target ? target.name : String(idOrName));

    if (!target) {
      return prisma.paymentProcessor.create({
        data: {
          name,
          publicKey: dto.publicKey ?? null,
          secretKey: dto.secretKey ?? null,
          isEnabled: dto.isEnabled ?? false,
          isConnected: dto.isConnected ?? false,
          lastSync: new Date(),
        },
      });
    }

    const dataToUpdate: any = {
      lastSync: new Date(),
    };

    if (dto.publicKey !== undefined) dataToUpdate.publicKey = dto.publicKey;
    if (dto.secretKey !== undefined) dataToUpdate.secretKey = dto.secretKey;
    if (dto.isEnabled !== undefined) dataToUpdate.isEnabled = dto.isEnabled;
    if (dto.isConnected !== undefined) dataToUpdate.isConnected = dto.isConnected;
    if (dto.name !== undefined) dataToUpdate.name = dto.name;

    const updated = await prisma.paymentProcessor.update({
      where: { id: target.id },
      data: dataToUpdate,
    });

    this.logger.log(`Configured processor details for ${name} (id: ${target.id})`);
    return updated;
  }
}
