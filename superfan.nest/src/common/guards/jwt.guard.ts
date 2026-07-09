import { createClerkClient, verifyToken } from '@clerk/backend';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../../user/user.service';

@Injectable()
export class JwtGuard implements CanActivate {
  private clerkClient;

  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const cookieToken = request.cookies?.__session;
    const token = this.extractBearerToken(authHeader) || cookieToken;

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    if (token === 'undefined' || token === 'null') {
      throw new UnauthorizedException(
        'Invalid token value. Expected a Clerk session JWT.',
      );
    }

    if (token.startsWith('sit_')) {
      throw new UnauthorizedException(
        'Invalid token type: Clerk sign-in token cannot be used for protected routes. Use a Clerk session JWT.',
      );
    }

    let user: any = null;
    let clerkError: any = null;

    // 1) Verify as Clerk session JWT.
    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        clockSkewInMs: 300000,
      });

      const clerkUser = await this.clerkClient.users.getUser(payload.sub);
      const email = clerkUser.emailAddresses[0]?.emailAddress;

      if (!email) {
        throw new UnauthorizedException('Clerk user has no email address');
      }

      // Find or automatically register user in our local Postgres DB
      user = await this.userService.findUserByEmail(email);

      if (!user) {
        const phone = (clerkUser.unsafeMetadata?.phone as string) || clerkUser.phoneNumbers[0]?.phoneNumber || '';
        const referralCode = clerkUser.unsafeMetadata?.referralCode as string | undefined;

        const loginMethod = clerkUser.externalAccounts?.[0]?.provider || 'clerk';

        user = await this.userService.registerClerkUser({
          email,
          firstName: clerkUser.firstName || 'User',
          lastName: clerkUser.lastName || '',
          username: clerkUser.username || clerkUser.firstName?.toLowerCase() || `user_${payload.sub.slice(-6)}`,
          phone,
          login_method: loginMethod,
          referralCode,
        });
      }
    } catch (error: any) {
      clerkError = error;
    }

    // 2) Fallback to app access token (returned by /auth/login).
    if (!user) {
      try {
        const appPayload = await this.jwtService.verifyAsync(token, {
          secret:
            this.configService.get<string>('AT_SECRET') ||
            'superfan_secret_key',
        });

        if (appPayload?.id) {
          user = await this.userService.findUserById(Number(appPayload.id));
        }

        if (!user && appPayload?.email) {
          user = await this.userService.findUserByEmail(appPayload.email);
        }
      } catch {
        // If both verifiers fail, final unauthorized is thrown below.
      }
    }

    if (!user) {
      if (clerkError?.reason === 'token-expired') {
        throw new UnauthorizedException('Token expired');
      }

      throw new UnauthorizedException(
        'Invalid token. Use a Clerk session JWT or the token returned by /auth/login.',
      );
    }

    request.user = user;
    return true;
  }

  private extractBearerToken(authorizationHeader?: string): string | null {
    if (!authorizationHeader) {
      return null;
    }

    const [scheme, token] = authorizationHeader.trim().split(/\s+/);
    if (!scheme || !token) {
      return null;
    }

    if (scheme.toLowerCase() !== 'bearer') {
      return null;
    }

    return token;
  }
}
