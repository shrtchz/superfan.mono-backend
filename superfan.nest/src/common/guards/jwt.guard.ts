import { createClerkClient, verifyToken } from '@clerk/backend';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.split(' ')[1];
    let user: any = null;

    try {
      // 1. Verify token using Clerk's public keys (JWKS)
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY || 'sk_test_TDksIODSXIqyFJlTThO6q7E6fxwCk68q9MXHjIp9sN',
        clockSkewInMs: 60000, // 60 seconds tolerance to prevent clock drift issues on Render
      });

      // 2. Fetch full user details from Clerk using the 'sub' ID
      const clerkUser = await this.clerkClient.users.getUser(payload.sub);
      const email = clerkUser.emailAddresses[0]?.emailAddress;

      if (!email) {
        throw new UnauthorizedException('Clerk user has no email address');
      }

      // 3. Find or automatically register user in our local Postgres DB
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
    } catch (clerkError) {
      try {
        // Try to verify as NestJS token
        const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env.AT_SECRET || 'superfan_secret_key',
        });

        // Find user by ID from the payload
        user = await this.userService.findUserById(payload.id);
      } catch (jwtError) {
        console.error('Clerk auth guard error:', clerkError);
        console.error('NestJS JWT verification failed:', jwtError);
        throw new UnauthorizedException('Session expired! Please sign in');
      }
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    request.user = user;
    return true;
  }
}
