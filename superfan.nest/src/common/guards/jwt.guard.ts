import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createClerkClient } from '@clerk/backend';
import { UserService } from '../../user/user.service';

@Injectable()
export class JwtGuard implements CanActivate {
  private clerkClient;

  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
  ) {
    this.clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY || 'sk_test_TDksIODSXIqyFJlTThO6q7E6fxwCk68q9MXHjIp9sN',
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

    try {
      // 1. Verify token using Clerk's public keys (JWKS)
      const payload = await this.clerkClient.verifyToken(token);

      // 2. Fetch full user details from Clerk using the 'sub' ID
      const clerkUser = await this.clerkClient.users.getUser(payload.sub);
      const email = clerkUser.emailAddresses[0]?.emailAddress;

      if (!email) {
        throw new UnauthorizedException('Clerk user has no email address');
      }

      // 3. Find or automatically register user in our local Postgres DB
      let user = await this.userService.findUserByEmail(email);

      if (!user) {
        const phone = (clerkUser.unsafeMetadata?.phone as string) || clerkUser.phoneNumbers[0]?.phoneNumber || '';
        const referralCode = clerkUser.unsafeMetadata?.referralCode as string | undefined;

        user = await this.userService.registerClerkUser({
          email,
          firstName: clerkUser.firstName || 'User',
          lastName: clerkUser.lastName || '',
          username: clerkUser.username || clerkUser.firstName?.toLowerCase() || `user_${payload.sub.slice(-6)}`,
          phone,
          login_method: 'clerk',
          referralCode,
        });
      }

      // 4. Attach user to request object so downstream controllers can use it
      request.user = user;
      return true;
    } catch (error) {
      console.error('Clerk auth guard error:', error);
      throw new UnauthorizedException('Session expired! Please sign in');
    }
  }
}