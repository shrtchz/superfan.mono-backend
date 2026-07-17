import { createClerkClient, type User } from '@clerk/backend';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User as LocalUser } from '@prisma/client';

@Injectable()
export class ClerkService implements OnModuleInit {
  private client!: ReturnType<typeof createClerkClient>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
    if (!secretKey?.startsWith('sk_')) {
      throw new Error(
        'CLERK_SECRET_KEY must be set to a valid Clerk secret key (sk_...).',
      );
    }
    this.client = createClerkClient({ secretKey });
  }

  getClient() {
    return this.client;
  }

  async findByEmail(email: string): Promise<User | null> {
    const response = await this.client.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    return response?.data?.[0] ?? null;
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    if (identifier.includes('@')) {
      return this.findByEmail(identifier);
    }

    if (identifier.startsWith('+')) {
      const response = await this.client.users.getUserList({
        phoneNumber: [identifier],
        limit: 1,
      });
      return response?.data?.[0] ?? null;
    }

    const response = await this.client.users.getUserList({
      username: [identifier],
      limit: 1,
    });
    return response?.data?.[0] ?? null;
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    try {
      const verification = await this.client.users.verifyPassword({
        userId,
        password,
      });
      return Boolean(verification?.verified);
    } catch {
      return false;
    }
  }

  /** Backend-issued one-time ticket for Clerk ticket sign-in. */
  async createSignInTicket(userId: string): Promise<string> {
    try {
      const signInToken = await this.client.signInTokens.createSignInToken({
        userId,
        expiresInSeconds: 300,
      });

      const ticket = this.resolveSignInTicketValue(signInToken);
      if (!ticket) {
        throw new InternalServerErrorException(
          'Clerk did not return a sign-in ticket.',
        );
      }

      return ticket;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      console.error('[ClerkService] createSignInTicket failed:', error);
      throw new InternalServerErrorException(
        'Could not create Clerk sign-in session. Ensure CLERK_SECRET_KEY matches the Clerk app used by the frontend.',
      );
    }
  }

  /** Clerk may return ticket as `token` (JWT or sint_*) or embedded in `url`. */
  private resolveSignInTicketValue(signInToken: {
    token?: string | null;
    url?: string | null;
  }): string | null {
    const { token, url } = signInToken;

    if (typeof token === 'string' && token.length >= 20) {
      if (
        token.startsWith('sint_') ||
        token.startsWith('sit_') ||
        token.startsWith('eyJ')
      ) {
        return token;
      }
    }

    if (typeof url === 'string' && url.length > 0) {
      try {
        const parsed = new URL(url);
        const fromQuery = parsed.searchParams.get('token');
        if (fromQuery && fromQuery.length >= 20) {
          return fromQuery;
        }
      } catch {
        // ignore malformed url
      }
    }

    return null;
  }

  /**
   * Create a Clerk user for a legacy Postgres account verified by local password.
   * On conflict, resolve the existing Clerk user instead of failing open.
   */
  async migrateLocalUser(localUser: LocalUser, password: string): Promise<User> {
    try {
      const clerkUser = await this.client.users.createUser({
        emailAddress: [localUser.email],
        password,
        username: localUser.username,
        firstName: localUser.firstName,
        lastName: localUser.lastName || '',
        skipPasswordChecks: true,
        skipPasswordRequirement: false,
        ...(localUser.phone ? { phoneNumber: [localUser.phone] } : {}),
      });

      const emailId = clerkUser.emailAddresses?.[0]?.id;
      if (emailId) {
        await this.client.emailAddresses
          .updateEmailAddress(emailId, { verified: true })
          .catch(() => undefined);
      }

      return clerkUser;
    } catch (error) {
      console.error('[ClerkService] migrateLocalUser failed:', error);

      const existing = await this.findByEmail(localUser.email);
      if (existing?.id) {
        const verified = await this.verifyPassword(existing.id, password);
        if (verified) {
          return existing;
        }
      }

      throw new ForbiddenException(
        'Could not link your account to Clerk. Try Google sign-in or contact support.',
      );
    }
  }
}
