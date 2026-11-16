import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { ConfigurePaymentProcessorDto } from './dto/payment-processor.dto';

export type PaymentChannel = 'card' | 'bank_transfer' | 'stable_coin';
export const ALL_CHANNELS: PaymentChannel[] = ['card', 'bank_transfer', 'stable_coin'];

export const PROCESSOR_CAPABILITIES: Record<string, PaymentChannel[]> = {
  monnify: ['card', 'bank_transfer'],
  flutterwave: ['card', 'bank_transfer', 'stable_coin'],
  busha: ['stable_coin'],
  cngn: ['stable_coin'],
  bitnob: ['stable_coin'],
  bachs: ['card', 'bank_transfer', 'stable_coin'],
};

const DEFAULT_PROCESSORS = ['monnify', 'flutterwave', 'busha', 'cngn', 'bitnob', 'bachs'] as const;
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
        } else if (name === 'bitnob') {
          envPublicKey = process.env.BITNOB_PUBLIC_KEY || process.env.BITNOB_API_KEY || null;
          envSecretKey = process.env.BITNOB_SECRET_KEY || null;
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

  private async resolveActiveProcessors(lastToggledId?: number, justEnabled?: boolean) {
    const enabled = await prisma.paymentProcessor.findMany({
      where: { isEnabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (enabled.length === 0) return;

    // Prioritize the newly toggled processor if it was just turned ON
    const ordered = [...enabled].sort((a, b) => {
      if (lastToggledId && justEnabled) {
        if (a.id === lastToggledId) return -1;
        if (b.id === lastToggledId) return 1;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const assignedSlots = new Set<PaymentChannel>();
    const keepEnabledIds = new Set<number>();

    for (const proc of ordered) {
      const caps = PROCESSOR_CAPABILITIES[proc.name.toLowerCase()] || [];
      const remainingSlots = caps.filter((slot) => !assignedSlots.has(slot));

      if (remainingSlots.length > 0) {
        keepEnabledIds.add(proc.id);
        remainingSlots.forEach((slot) => assignedSlots.add(slot));
      }
    }

    const toDisable = enabled.filter((proc) => !keepEnabledIds.has(proc.id));
    if (toDisable.length > 0) {
      await prisma.paymentProcessor.updateMany({
        where: { id: { in: toDisable.map((p) => p.id) } },
        data: {
          isEnabled: false,
          isConnected: false,
        },
      });
      this.logger.log(
        `Auto-deactivated processors with no active slots: ${toDisable.map((p) => p.name).join(', ')}`,
      );
    }
  }

  async getActiveProcessor(channel?: string): Promise<{ activeProcessor: string; processor: any; channels?: Record<string, string> }> {
    await this.ensureDefaultProcessors();

    const enabled = await prisma.paymentProcessor.findMany({
      where: { isEnabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    const assignedSlots: Partial<Record<PaymentChannel, { name: string; processor: any }>> = {};
    for (const proc of enabled) {
      const caps = PROCESSOR_CAPABILITIES[proc.name.toLowerCase()] || [];
      for (const cap of caps) {
        if (!assignedSlots[cap]) {
          assignedSlots[cap] = { name: proc.name.toLowerCase(), processor: proc };
        }
      }
    }

    if (channel && (channel === 'card' || channel === 'bank_transfer' || channel === 'stable_coin')) {
      const match = assignedSlots[channel as PaymentChannel];
      if (match) {
        return {
          activeProcessor: match.name,
          processor: match.processor,
        };
      }
    }

    // Default fiat fallback
    const fiatMatch = assignedSlots.card || assignedSlots.bank_transfer || assignedSlots.stable_coin;
    if (fiatMatch) {
      return {
        activeProcessor: fiatMatch.name,
        processor: fiatMatch.processor,
        channels: {
          card: assignedSlots.card?.name || '',
          bank_transfer: assignedSlots.bank_transfer?.name || '',
          stable_coin: assignedSlots.stable_coin?.name || '',
        },
      };
    }

    return {
      activeProcessor: 'monnify',
      processor: null,
      channels: {
        card: 'monnify',
        bank_transfer: 'monnify',
        stable_coin: '',
      },
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

    await prisma.paymentProcessor.update({
      where: { id },
      data: {
        isEnabled: nextState,
        isConnected: nextState,
        lastSync: new Date(),
        updatedAt: new Date(),
      },
    });

    await this.resolveActiveProcessors(id, nextState);

    const updated = await prisma.paymentProcessor.findUnique({
      where: { id },
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
      const created = await prisma.paymentProcessor.create({
        data: {
          name,
          publicKey: dto.publicKey ?? null,
          secretKey: dto.secretKey ?? null,
          isEnabled: dto.isEnabled ?? false,
          isConnected: dto.isConnected ?? false,
          lastSync: new Date(),
        },
      });
      if (dto.isEnabled === true) {
        await this.resolveActiveProcessors(created.id, true);
      }
      return prisma.paymentProcessor.findUnique({ where: { id: created.id } });
    }

    const dataToUpdate: any = {
      lastSync: new Date(),
      updatedAt: new Date(),
    };

    if (dto.publicKey !== undefined) dataToUpdate.publicKey = dto.publicKey;
    if (dto.secretKey !== undefined) dataToUpdate.secretKey = dto.secretKey;
    if (dto.isEnabled !== undefined) {
      dataToUpdate.isEnabled = dto.isEnabled;
      dataToUpdate.isConnected = dto.isConnected ?? dto.isEnabled;
    }
    if (dto.isConnected !== undefined) dataToUpdate.isConnected = dto.isConnected;
    if (dto.name !== undefined) dataToUpdate.name = dto.name;

    const updated = await prisma.paymentProcessor.update({
      where: { id: target.id },
      data: dataToUpdate,
    });

    if (dto.isEnabled === true) {
      await this.resolveActiveProcessors(target.id, true);
    } else if (dto.isEnabled === false) {
      await this.resolveActiveProcessors();
    }

    this.logger.log(`Configured processor details for ${name} (id: ${target.id})`);
    return prisma.paymentProcessor.findUnique({ where: { id: target.id } });
  }
}
