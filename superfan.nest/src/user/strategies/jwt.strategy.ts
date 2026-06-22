import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import * as passportJwt from 'passport-jwt';
import { JwtPayload } from "../types/jwtPayload.type";
import { UserWithJwtPayload } from "../types/userWithRefreshToken.type";
import { UserService } from '../user.service';

const {Strategy, ExtractJwt} = passportJwt

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(private readonly config: ConfigService, private readonly UserService: UserService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: config.get('JWT_SECRET'),
        })
    }

    async validate(payload: JwtPayload): Promise<UserWithJwtPayload> {
        const user = await this.UserService.findUserById(payload.id);
        return {...user, role: payload.role};   
    }

}