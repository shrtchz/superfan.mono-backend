import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiPaginatedResponse, Public, Roles } from '../common/decorators';
import { RealIp } from '../common/decorators/RealIp.decorator';
import { PaginatedOutputDto } from '../common/dto/paginated-output.dto';
import { Role } from '../common/enums/role.enum';
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
  SyncUserDto,
  VerifyBvnDto,
  VerifyNinDto,
  VerifyIdDocumentDto,
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

  private isAdmin(req: any): boolean {
    return (
      req.user?.roleName === Role.superadmin ||
      req.user?.roleName === Role.subadmin
    );
  }

  private assertOwnerOrAdmin(req: any, targetUserId: number): void {
    if (!this.isAdmin(req) && Number(req.user?.id) !== Number(targetUserId)) {
      throw new ForbiddenException('You can only access your own resources');
    }
  }

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
  async signupUser(
    @Body() dto: AuthDto,
    @RealIp() ip: string,
  ): Promise<{ message: string }> {
    return this.userService.signupUser(dto, ip);
  }

  // Debug endpoint to list all users with referral codes
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/debug/referral-codes')
  async getAllReferralCodes() {
    const users = await this.userService.findAllUsersWithReferralCodes();
    return users;
  }

  @Public()
  @Post('/auth/login')
  @HttpCode(HttpStatus.OK)
  async loginUser(@Body() dto: LoginDto) {
    return this.userService.signinUser(dto);
  }

  @Public()
  @Post('/sync')
  @HttpCode(HttpStatus.OK)
  async syncUser(
    @Req() req: any,
    @Body() dto: SyncUserDto,
    @RealIp() ip: string,
  ) {
    const user = await this.userService.syncFromClerkToken(
      req.headers.authorization,
      dto,
      req.headers['user-agent'] as string | undefined,
      ip,
    );
    return successResponse('User synced successfully', user);
  }

  /** @deprecated Use POST /user/sync */
  @Public()
  @Post('/clerk-login')
  @HttpCode(HttpStatus.OK)
  async clerkLogin(
    @Req() req: any,
    @Body() dto: SyncUserDto,
    @RealIp() ip: string,
  ) {
    return this.syncUser(req, dto, ip);
  }
  @Get(':id/login-method')
  async getLoginMethod(@Req() req: any, @Param('id', ParseIntPipe) userId: number) {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.getUserLoginMethod(effectiveUserId);
  }

  @Post('/logout/:userId')
  async logout(@Req() req: any, @Param('userId', ParseIntPipe) userId: number) {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.logout(effectiveUserId);
  }

  @Post('/fund-wallet/:userId/:transactionReference')
  async fundUserWalletCard(
    @Req() req: any,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('transactionReference') transactionReference: string,
  ) {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.walletService.fundWalletWithCard(effectiveUserId, transactionReference);
  }

  @Roles(Role.superadmin, Role.subadmin)
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

  @Post('/kyc/verify-bvn')
  async verifyBvn(@Req() req: any, @Body() dto: VerifyBvnDto) {
    return this.userService.verifyBvnWithDidit(req.user.id, dto);
  }

  @Post('/kyc/verify-nin')
  async verifyNin(@Req() req: any, @Body() dto: VerifyNinDto) {
    return this.userService.verifyNinWithDidit(req.user.id, dto);
  }

  @Post('/kyc/verify-id')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'front_image', maxCount: 1 },
      { name: 'back_image', maxCount: 1 },
    ]),
  )
  async verifyIdDocument(
    @Req() req: any,
    @Body() dto: VerifyIdDocumentDto,
    @UploadedFiles()
    files?: {
      front_image?: Express.Multer.File[];
      back_image?: Express.Multer.File[];
    },
  ) {
    const frontImage = files?.front_image?.[0] || dto.frontImageBase64;
    const backImage = files?.back_image?.[0] || dto.backImageBase64;
    return this.userService.verifyIdWithDidit(
      req.user.id,
      frontImage as any,
      backImage as any,
    );
  }

  @Post('/kyc/initiate-didit')
  async initiateDiditKyc(@Req() req: any, @Body() dto?: { callbackUrl?: string; workflowId?: string }) {
    return this.userService.initiateDiditHostedSession(req.user.id, dto);
  }

  @Post('/kyc/initiate-session')
  async initiateDiditSession(@Req() req: any, @Body() dto?: { callbackUrl?: string; workflowId?: string }) {
    return this.userService.initiateDiditHostedSession(req.user.id, dto);
  }

  @Get('/kyc/session-decision/:sessionId')
  async getDiditSessionDecision(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
  ) {
    return this.userService.syncDiditSessionDecision(req.user.id, sessionId);
  }

  @Get('/kyc/sync-session')
  async syncDiditSession(@Req() req: any) {
    return this.userService.syncDiditSessionDecision(req.user.id);
  }

  @Get('kyc-status')
  async checkKycStatus(@Req() req: any) {
    const userId = req.user.id; // assuming auth middleware

    return this.userService.checkKycStatus(userId);
  }

  @Post('/create-subscription')
  createSubscription(@Req() req: any, @Body() dto: any) {
    return this.userService.createSubscription(req.user.id, dto);
  }

  @Post('/create-subscription-with-card')
  createSubscriptionWithCard(
    @Req() req: any,
    @Body() dto: any
    ) {
    return this.userService.createSubscriptionWithCard(req.user.id, dto);
  }

  @Post('/create-card')
  createUserCard(@Req() req: any, @Body() dto: any) {
    return this.userService.createCard(req.user.id, dto);
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
    @Req() req: any,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('mandateCode') mandateCode: string,
  ): Promise<any> {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.checkSubscriptionStatus(effectiveUserId, mandateCode);
  }

    @Get('/subscription/:userId/')
  getSubscriptionbyUserId(
    @Req() req: any,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<any> {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.checkSubscriptionStatusbyUserId(effectiveUserId);
  }

  @Patch('/update-profile')
  async updateProfile(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.userService.updateUserDetails(req.user.id, dto);
  }

  @Roles(Role.superadmin, Role.subadmin)
  @Get('/clients')
  @ApiPaginatedResponse(UserDto)
  getClients(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('search') search?: string,
  ): Promise<any> {
    return this.userService.fetchClients({
      page: Number(page) || 1,
      perPage: Number(perPage) || 10,
      status,
      plan,
      search,
    });
  }

  @Roles(Role.superadmin, Role.subadmin)
  @Get('/list-clients')
  @ApiPaginatedResponse(UserDto)
  listClients(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('search') search?: string,
  ): Promise<any> {
    return this.userService.fetchClients({
      page: Number(page) || 1,
      perPage: Number(perPage) || 10,
      status,
      plan,
      search,
    });
  }

  @Get('/user-details/:userId')
  getUserById(@Req() req: any, @Param('userId', ParseIntPipe) userId: number): Promise<any> {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.findUserById(effectiveUserId);
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

  @Get('/tier-statistics')
  getUserTierStatistics(@Req() req: any): Promise<any> {
    return this.userService.getUserTierStatistics(Number(req.user?.id));
  }

      @Get('/user-badge/:userId')
  getUserBadge(@Param('userId', ParseIntPipe) userId: number): Promise<any> {
    return this.userService.getUserBadge(userId);
  }

  @Get('/quiz-earnings/:userId')
  getQuizEarnings(@Req() req: any, @Param('userId', ParseIntPipe) userId: number): Promise<any> {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.getQuizEarnings(effectiveUserId);
  }

  @Get('/top-earners')
  getTopEarners(
    @Query('limit', ParseIntPipe) limit: number = 10,
  ): Promise<any> {
    return this.userService.getTopEarners(limit);
  }

  @Roles(Role.superadmin, Role.subadmin)
  @Get('/all-users')
  getAllUser(): Promise<any> {
    return this.userService.findAllUsers();
  }

  @Get('/user-accounts/:userId')
  getUserAccounts(@Req() req: any, @Param('userId', ParseIntPipe) userId: number): Promise<any> {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.findUserAccount(effectiveUserId);
  }

  @Get('/user-cards/:userId')
  getUserCards(@Req() req: any, @Param('userId', ParseIntPipe) userId: number) {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.findUserCards(effectiveUserId);
  }

    @Patch(':userId/set-default/:cardId')
  async setDefaultCard(
    @Req() req: any,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('cardId', ParseIntPipe) cardId: number,
  ) {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.setDefaultCard(effectiveUserId, cardId);
  }

  @Get('/onboarding-details/:userId')
  getOnboardingDetails(
    @Req() req: any,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<any> {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.fetchOnboardingdetails(effectiveUserId);
  }

  @Roles(Role.superadmin, Role.subadmin)
  @Get('/subadmins')
  @ApiPaginatedResponse(UserDto)
  getAdmins(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
    @Query('status') status?: string,
  ): Promise<PaginatedOutputDto<UserDto>> {
    return this.userService.fetchSubadmin({
      page: Number(page) || 1,
      perPage: Number(perPage) || 10,
      status,
    });
  }

  @Roles(Role.superadmin, Role.subadmin)
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

  @Roles(Role.superadmin, Role.subadmin)
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

  @Patch('onboarding/:id')
  async updateOnboarding(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingDto,
  ) {
    const userId = parseInt(id);
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.updateOnboarding(effectiveUserId, dto);
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

  @Delete('/delete/:userId')
  async deleteUser(
    @Req() req: any,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body?: { password?: string },
  ) {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.deleteUser(effectiveUserId, body?.password);
  }

  @Get('/payment-methods')
  getPaymentMethods(@Req() req: any) {
    return this.userService.getPaymentMethods(req.user.id);
  }

    @Delete('delete/:userId/:cardId')
  async deleteCard(
    @Req() req: any,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('cardId', ParseIntPipe) cardId: number,
  ) {
    this.assertOwnerOrAdmin(req, userId);
    const effectiveUserId = this.isAdmin(req) ? userId : req.user.id;
    return this.userService.deleteCard(effectiveUserId, cardId);
  }
}
