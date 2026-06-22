import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiPaginatedResponse, Public } from '../common/decorators';
import { RealIp } from '../common/decorators/RealIp.decorator';
import { PaginatedOutputDto } from '../common/dto/paginated-output.dto';
import { ApiRoutes } from '../common/enums/routes.enum';
import { JwtGuard } from '../common/guards';
import { RoleGuard } from '../common/guards/roles.guard';
import { BushaSyncInterceptor } from '../common/interceptors/busha-service.interceptor';
import { FlutterwaveSyncInterceptor } from '../common/interceptors/flutterwave-service.interceptor';
import { MonnifySyncInterceptor } from '../common/interceptors/monnify-service.interceptor';
import {
  failureResponse,
  successResponse,
} from '../common/interceptors/response.interceptor';
import { PaymentDto, SubscriptionCardPaymentDto } from '../payment/payment.dto';
import { WalletService } from '../wallet/wallet.service';
import {
  AuthDto,
  KycDto,
  LoginDto,
  ResendVerificationDto,
  ResetPasswordDto,
  RewardPaymentDto,
  SocialLoginDto,
  UpdateOnboardingDto,
  UpdateUserDto,
  UserDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { PresenceGateway } from './gateway/presence.gateway';
import { UserService } from './user.service';


@UseInterceptors(BushaSyncInterceptor, FlutterwaveSyncInterceptor, MonnifySyncInterceptor)
@Controller(ApiRoutes.USER)
@UseGuards(JwtGuard, RoleGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly walletService: WalletService,
    private presenceGateway: PresenceGateway,
  ) {}

  @Public()
  @Get('my-ip')
  get(@RealIp() ip: string): string {
    return `Real IP: ${ip}`;
  }

  @Get('me')
  getMe(@Req() req: any) {
    return successResponse('User profile retrieved successfully', req.user);
  }

  @Public()
  @Post('/auth/signup')
  @HttpCode(HttpStatus.OK)
  async signupUser(@Body() dto: AuthDto): Promise<{ message: string }> {
    return this.userService.signupUser(dto);
  }

  @Get(':id/login-method')
  async getLoginMethod(@Param('id', ParseIntPipe) userId: number) {
    return this.userService.getUserLoginMethod(userId);
  }

  @Post('/logout/:userId')
  async logout(@Param('userId') userId: number) {
    return this.userService.logout(userId);
  }

  @Post('/fund-wallet/:userId/:transactionReference')
  async fundUserWalletCard(
    @Param('userId') userId: number,
    @Param('transactionReference') transactionReference: string,
  ) {
    return this.walletService.fundWalletWithCard(userId, transactionReference);
  }

  @Post(':userId/reward-wallet')
  async creditRewardToWallet(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: RewardPaymentDto,
  ) {
    return this.walletService.creditWallet(userId, dto.amount, dto.title, dto.description);
  }

  @Patch(':id/sub-account')
  async updateSubAccount(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.userService.updateUserSubAccountCode(req.user.id, dto);
  }

  @Patch('/kyc')
  updateKyc(@Body() dto: KycDto, @Req() req: any) {
    return this.userService.updateKycDetails(req.user.id, dto);
  }

  @Get('kyc-status')
  async checkKycStatus(@Req() req: any) {
    const userId = req.user.id; // assuming auth middleware

    return this.userService.checkKycStatus(userId);
  }

  @Post('/create-subscription')
  createSubscription(@Body() dto: PaymentDto, @Req() req: any) {
    return this.userService.createSubscription(req.user.id, dto);
  }

  @Post('/create-subscription-with-card')
  createSubscriptionWithCard(
    @Req() req: any,
    @Body() dto: SubscriptionCardPaymentDto,
  ) {
    return this.userService.createSubscriptionWithCard(req.user.id, dto);
  }

  @Post('/create-card')
  createUserCard(@Req() req: any, @Body() cardNumber: number) {
    return this.userService.createCard(req.user.id, cardNumber);
  }

  @Get('/get-card')
  getUserCard(@Req() req: any) {
    return this.userService.getCard(req.user.id);
  }

  
  @Get('/card/:cardId')
  getCardById(
    @Query('cardId', ParseIntPipe) cardId: number,
  ): Promise<any> {
    return this.userService.getCardById(cardId);
  }

  @Get('/subscription/:userId/:mandateCode')
  getSUbscriptionAcct(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('mandateCode') mandateCode: string,
  ): Promise<any> {
    return this.userService.checkSubscriptionStatus(userId, mandateCode);
  }

    @Get('/subscription/:userId/')
  getSubscriptionbyUserId(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<any> {
    return this.userService.checkSubscriptionStatusbyUserId(userId);
  }

  @Patch('/update-profile')
  async updateProfile(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.userService.updateUserDetails(req.user.id, dto);
  }

  @Get('/clients')
  @ApiPaginatedResponse(UserDto)
  getClients(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
  ): Promise<PaginatedOutputDto<UserDto>> {
    return this.userService.fetchClients({
      page,
      perPage,
    });
  }

  @Get('/user-details/:userId')
  getUserById(@Param('userId', ParseIntPipe) userId: number): Promise<any> {
    return this.userService.findUserById(userId);
  }

    @Get('search-username')
  async search(
    @Query('q') query: string,
    @Query('limit', ParseIntPipe) limit: number,
  ) {
    return this.userService.searchUsersByUsername(query, limit);
  }

    @Get('/user-streak/:userId')
  getUserStreak(@Param('userId', ParseIntPipe) userId: number): Promise<any> {
    return this.userService.getUserStreak(userId);
  }

      @Get('/user-badge/:userId')
  getUserBadge(@Param('userId', ParseIntPipe) userId: number): Promise<any> {
    return this.userService.getUserBadge(userId);
  }

  @Get('/all-users')
  getAllUser(): Promise<any> {
    return this.userService.findAllUsers();
  }

  @Get('/user-accounts/:userId')
  getUserAccounts(@Param('userId', ParseIntPipe) userId: number): Promise<any> {
    return this.userService.findUserAccount(userId);
  }

  @Get('/user-cards/:userId')
  getUserCards(@Param('userId', ParseIntPipe) userId: number) {
    return this.userService.findUserCards(userId);
  }

    @Patch(':userId/set-default/:cardId')
  async setDefaultCard(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('cardId', ParseIntPipe) cardId: number,
  ) {
    return this.userService.setDefaultCard(userId, cardId);
  }

  @Get('/onboarding-details/:userId')
  getOnboardingDetails(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<any> {
    return this.userService.fetchOnboardingdetails(userId);
  }

  @Get('/subadmins')
  @ApiPaginatedResponse(UserDto)
  getAdmins(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
  ): Promise<PaginatedOutputDto<UserDto>> {
    return this.userService.fetchSubadmin({
      page,
      perPage,
    });
  }

  @Patch('ban/:id')
  async banClient(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { banReason: string; banCategory: string },
    @Req() req,
  ) {
    return this.userService.banClient(
      id,
      dto.banReason,
      dto.banCategory,
      req.user.id,
    );
  }

  @Patch('unban/:id')
  async unbanClient(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { unbanReason: string; banCategory: string },
    @Req() req,
  ) {
    return this.userService.unbanClient(
      id,
      dto.unbanReason,
      dto.banCategory,
      req.user.id,
    );
  }

  @Public()
  @Patch('onboarding/:id')
  async updateOnboarding(
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingDto,
  ) {
    const userId = parseInt(id);
    return this.userService.updateOnboarding(userId, dto);
  }

  @Get('referral-link/:userId')
  getReferralLink(@Param('userId') userId: string) {
    return this.userService.getReferralLink(Number(userId));
  }

  @Get('status/:userId')
  getUserStatus(@Param('userId') userId: number) {
    const isOnline = this.presenceGateway.isUserOnline(userId);
    return { userId, online: isOnline };
  }

  @Public()
  @Get(':id/ban-status')
  getBanStatus(@Param('id') id: string) {
    return this.userService.getBanStatus(Number(id));
  }

  @Public()
  @Delete('/delete/:userId')
  async deleteAdmin(@Param('userId') userId: number) {
    return this.userService.deleteUser(userId);
  }

  @Get('/payment-methods')
  getPaymentMethods(@Req() req: any) {
    return this.userService.getPaymentMethods(req.user.id);
  }

    @Delete('delete/:userId/:cardId')
  async deleteCard(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('cardId', ParseIntPipe) cardId: number,
  ) {
    return this.userService.deleteCard(userId, cardId);
  }
}
