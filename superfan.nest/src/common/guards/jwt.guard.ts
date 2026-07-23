import { verifyToken } from '@clerk/backend';

import {

  CanActivate,

  ExecutionContext,

  Injectable,

  UnauthorizedException,

} from '@nestjs/common';

import { Reflector } from '@nestjs/core';

import { ClerkService } from '../clerk/clerk.service';

import { UserService } from '../../user/user.service';



@Injectable()

export class JwtGuard implements CanActivate {

  constructor(

    private readonly reflector: Reflector,

    private readonly userService: UserService,

    private readonly clerkService: ClerkService,

  ) {}



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



    if (token.startsWith('sit_') || token.startsWith('sint_')) {

      throw new UnauthorizedException(

        'Invalid token type: Clerk sign-in ticket cannot be used for protected routes. Use a Clerk session JWT.',

      );

    }



    try {

      const payload = await verifyToken(token, {

        secretKey: process.env.CLERK_SECRET_KEY,

        clockSkewInMs: 300000,

      });



      let user = await this.userService.findUserByClerkId(payload.sub);



      if (!user) {

        let email =

          typeof payload.email === 'string' ? payload.email : undefined;



        if (!email) {

          try {

            const clerkUser = await this.clerkService

              .getClient()

              .users.getUser(payload.sub);

            email = clerkUser.emailAddresses?.[0]?.emailAddress;

          } catch {

            // fall through

          }

        }



        if (email) {

          user = await this.userService.findUserByEmail(email);

        }

      }



      if (!user) {

        throw new UnauthorizedException({

          message: 'User not provisioned. Call POST /user/sync first.',

          code: 'USER_NOT_PROVISIONED',

        });

      }



      request.user = user;

      return true;

    } catch (error: any) {

      if (error?.reason === 'token-expired') {

        throw new UnauthorizedException('Token expired');

      }



      if (error instanceof UnauthorizedException) {

        throw error;

      }



      throw new UnauthorizedException(

        'Invalid token. Use a Clerk session JWT.',

      );

    }

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


