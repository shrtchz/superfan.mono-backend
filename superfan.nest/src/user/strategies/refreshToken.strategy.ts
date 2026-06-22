import { ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Request } from 'express';
import { ExtractJwt, Strategy } from "passport-jwt";
import { JwtPayload } from "../types/jwtPayload.type";
import { UserWithJwtPayload } from "../types/userWithRefreshToken.type";
import { UserService } from "../user.service";

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(
  Strategy,
  "jwt-refresh"
) {
  constructor(
    config: ConfigService,
    private readonly userService: UserService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>("JWT_REFRESH_SECRET"),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<UserWithJwtPayload> {
    const refreshToken = (req as any).headers?.authorization
    ?.replace('Bearer', '')
    .trim();

    if (!refreshToken) {
      throw new ForbiddenException("Refresh token malformed");
    }

    const user = await this.userService.findUserById(payload.id);

    return { ...user, refreshToken, role: payload.role };
  }
}