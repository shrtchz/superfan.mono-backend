import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiRoutes } from '../../common/enums/routes.enum';
import { JwtGuard } from '../../common/guards';
import {
  SendPhoneOtpDto,
  SetupTotpDto,
  VerifyPhoneOtpDto,
  VerifyTotpDto,
} from './dto/two-factor.dto';
import { TwoFactorService } from './two-factor.service';

interface AuthenticatedRequest extends Request {
  user: { id: number };
}

@Controller(`${ApiRoutes.USER}/2fa`)
@UseGuards(JwtGuard)
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Get('status')
  async status(@Req() req: AuthenticatedRequest) {
    return this.twoFactorService.getStatus(req.user.id);
  }

  @Post('totp/setup')
  async setupTotp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SetupTotpDto,
  ) {
    return this.twoFactorService.setupTotp(req.user.id, dto.account);
  }

  @Post('totp/verify')
  async verifyTotp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyTotpDto,
  ) {
    return this.twoFactorService.enableTotp(req.user.id, dto.code, dto.secret);
  }

  @Post('phone/send-otp')
  async sendPhoneOtp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendPhoneOtpDto,
  ) {
    return this.twoFactorService.sendPhoneOtp(
      req.user.id,
      dto.phone,
      dto.channel,
    );
  }

  @Post('phone/verify-otp')
  async verifyPhoneOtp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyPhoneOtpDto,
  ) {
    return this.twoFactorService.enablePhoneOtp(
      req.user.id,
      dto.phone,
      dto.code,
    );
  }

  @Post('disable')
  async disable(@Req() req: AuthenticatedRequest) {
    return this.twoFactorService.disable(req.user.id);
  }
}