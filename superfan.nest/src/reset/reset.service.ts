import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { execSync } from 'child_process';
import { BushaService } from '../payment/busha.service';
import { prisma } from '../prisma/prisma';
// import { PrismaService } from '../prisma/prisma.service'; // adjust path as needed

interface DeallocateResult {
  success: { userId: number; ref: string }[];
  failed: { userId: number; ref: string; reason: string }[];
}

@Injectable()
export class ResetService {
  private readonly logger = new Logger(ResetService.name);

  constructor(
    // private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly bushaService: BushaService,
  ) {}

  // ─── Public entry point ─────────────────────────────────────────────────────

  async deallocateAndWipe(): Promise<{
    message: string;
    deallocated: number;
    failed: number;
    failedDetails: DeallocateResult['failed'];
  }> {
    // Step 1 — Fetch users with a reserved account
    const users = await this.fetchUsersWithReference();
    this.logger.log(`Found ${users.length} user(s) with an accountReference.`);

    const results: DeallocateResult = { success: [], failed: [] };

    if (users.length > 0) {
      // Step 2 — Authenticate with Monnify
      const token = await this.getMonnifyToken();
      this.logger.log('Monnify token obtained.');

      for (const user of users) {
  try {
    // ─── Monnify deallocation ───
    await this.deallocateAccount(token, user.accountReference);

    this.logger.log(
      `✅ Deallocated — User ${user.id} | ref: ${user.accountReference}`,
    );

    // ─── Busha deletion (NEW) ───
    // if (user.busha_customer_id) {
    //   try {
    //     await this.deleteBushaCustomer(user.email);

    //     this.logger.log(
    //       `🗑️ Busha customer deleted — User ${user.id} | email: ${user.email}`,
    //     );
    //   } catch (err: any) {
    //     const reason =
    //       err?.response?.data?.message ||
    //       err?.response?.data?.error ||
    //       err.message;

    //     this.logger.warn(
    //       `❌ Busha delete failed — User ${user.id} | email: ${user.email} → ${reason}`,
    //     );

    //     results.failed.push({
    //       userId: user.id,
    //       ref: user.accountReference,
    //       reason: `Busha delete failed: ${reason}`,
    //     });

    //     continue; // optional: skip pushing success if Busha fails
    //   }
    // }

    // ─── Flutterwave wallet deletion (NEW) ───
if (user.accounts && Array.isArray(user.accounts)) {
  const flutterwaveAccounts = user.accounts.filter(
    (acc: any) =>
      acc.accountType === 'Flutterwave' && acc.accountReference,
  );

  for (const acc of flutterwaveAccounts) {
    try {
      await this.deleteFlutterwaveSubaccount(acc.accountReference);

      this.logger.log(
        `🗑️ Flutterwave wallet deleted — User ${user.id} | ref: ${acc.accountReference}`,
      );
    } catch (err: any) {
      const reason =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err.message;

      this.logger.warn(
        `❌ Flutterwave delete failed — User ${user.id} | ref: ${acc.accountReference} → ${reason}`,
      );

      results.failed.push({
        userId: user.id,
        ref: acc.accountReference,
        reason: `Flutterwave delete failed: ${reason}`,
      });
    }
  }
}

    results.success.push({
      userId: user.id,
      ref: user.accountReference,
    });
  } catch (err: any) {
    const reason =
      err?.response?.data?.responseMessage ||
      err?.response?.data?.message ||
      err.message;

    this.logger.warn(
      `❌ Failed — User ${user.id} | ref: ${user.accountReference} → ${reason}`,
    );

    results.failed.push({
      userId: user.id,
      ref: user.accountReference,
      reason,
    });
  }
}
    }

    // Step 4 — Disconnect Prisma before reset
    await prisma.$disconnect();
    this.logger.log('Prisma client disconnected.');

    // Step 5 — Wipe the database
    this.runPrismaReset();

    return {
      message: 'Deallocations complete. Database has been wiped and re-migrated.',
      deallocated: results.success.length,
      failed: results.failed.length,
      failedDetails: results.failed,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async fetchUsersWithReference() {
  return prisma.user.findMany({
    where: {
      OR: [
        { accountReference: { not: null } },
        { accounts: { not: null } },
      ],
    },
    select: {
      id: true,
      email: true,
      accountReference: true,
      busha_customer_id: true,
      accounts: true,
    },
  }) as Promise<{
    id: number;
    email: string;
    accountReference: string | null;
    busha_customer_id: string | null;
    accounts: any; // JSON field
  }[]>;
}

  private async getMonnifyToken(): Promise<string> {
    const apiKey = this.config.getOrThrow<string>('MONNIFY_API_KEY');
    const secretKey = this.config.getOrThrow<string>('MONNIFY_SECRET_KEY');
    const baseUrl = this.config.getOrThrow<string>('MONNIFY_URI');

    const credentials = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

    const { data } = await axios.post(
      `${baseUrl}/api/v1/auth/login`,
      {},
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    const token: string | undefined = data?.responseBody?.accessToken;
    if (!token) {
      throw new InternalServerErrorException('Could not retrieve Monnify access token.');
    }

    return token;
  }

  private async deallocateAccount(token: string, accountReference: string) {
    const baseUrl = this.config.getOrThrow<string>('MONNIFY_URI');

    const url = `${baseUrl}/api/v1/bank-transfer/reserved-accounts/reference/${encodeURIComponent(accountReference)}`;

    return axios.delete(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  private async deleteFlutterwaveSubaccount(accountReference: string) {
  const baseUrl = 'https://api.flutterwave.com/v3';
  const secretKey = this.config.getOrThrow<string>('FLW_SECRET_KEY');

  const url = `${baseUrl}/payout-subaccounts/${accountReference}`;

  return axios.delete(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
  });
}

  private async deleteBushaCustomer(email: string) {
    const customersResponse = await this.bushaService.getCustomers();
    const customers = customersResponse.data || [];
    const customer = customers.find(c => c.email === email);

    if (!customer) {
      throw new Error(`Busha customer not found for email: ${email}`);
    }

    const baseUrl = this.config.getOrThrow<string>('BUSHA_BASE_URL');
    const apiKey = this.config.getOrThrow<string>('BUSHA_API_KEY');
    const profileId = this.config.getOrThrow<string>('BUSHA_PROFILE_ID');

    const url = `${baseUrl}/v1/customers/${customer.id}`;

    return axios.delete(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-BU-PROFILE-ID': profileId,
        'Content-Type': 'application/json',
      },
    });
  }

  private runPrismaReset(): void {
    try {
      this.logger.log('Running npx prisma migrate reset --force …');
      execSync('npx prisma migrate reset --force', { stdio: 'inherit' });
      this.logger.log('✅ Database reset complete.');
    } catch (err: any) {
      this.logger.error('Prisma migrate reset failed', err.message);
      throw new InternalServerErrorException('Database reset failed after deallocations.');
    }
  }
}