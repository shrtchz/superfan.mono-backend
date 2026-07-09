import { createClerkClient, verifyToken } from '@clerk/backend';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserService } from '../../user/user.service';

@Injectable()
export class JwtGuard implements CanActivate {
  private clerkClient;

  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
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

    if (token.startsWith('sit_')) {
      throw new UnauthorizedException(
        'Invalid token type: Clerk sign-in token cannot be used for protected routes. Use a Clerk session JWT.',
      );
    }

    let user: any = null;

    // Verify as Clerk session JWT.
    try {
      // Verify token using Clerk's public keys (JWKS)
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        clockSkewInMs: 300000, // 5 minutes tolerance to prevent clock drift issues on Render
      });

      // Fetch full user details from Clerk using the 'sub' ID
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
    } catch (clerkError: any) {
      console.error('Clerk auth verification failed:', clerkError);

      if (clerkError?.reason === 'token-expired') {
        throw new UnauthorizedException('Token expired');
      }

      throw new UnauthorizedException(`Invalid token: ${clerkError?.message || clerkError}`);
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
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
