import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFloatPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { EarningStatus } from '../common/enums/task.enum';
import { JwtGuard } from '../common/guards';
import { BushaSyncInterceptor } from '../common/interceptors/busha-service.interceptor';
import { FlutterwaveSyncInterceptor } from '../common/interceptors/flutterwave-service.interceptor';
import { MonnifySyncInterceptor } from '../common/interceptors/monnify-service.interceptor';
import { WalletService } from '../wallet/wallet.service';
import { BitnobService } from './bitnob.service';
import { BushaService } from './busha.service';
import { FlutterwaveSuperfanService } from './flutterwave.service';
import { MonnifyService } from './monnify.service';
import {
  Authorize3DSecureCardDto,
  AuthorizeOtpDto,
  BankTransferDto,
  BvnAccountMatchDto,
  BvnMatchDto,
  CancelMandateDto,
  ChargeCardDto,
  ChargeCardTokenDto,
  CreateBalanceDto,
  CreateBeneficiaryDto,
  CreateBitnobCustomerDto,
  CreateBushaCustomerDto,
  CreateBushaQuoteDto,
  CreateBushaTransferDto,
  CreatePaymentMethodDto,
  CreatePaymentPlanDto,
  CreatePayoutQuoteDto,
  CreateRecipientDto,
  CreateReservedAccountDto,
  CreateTransferDto,
  CreateUserWithdrawalBankDto,
  CreateUserWithdrawalWalletDto,
  CreateVirtualAccountDto,
  CreateWalletDto,
  CreateWithdrawalDto,
  DebitPaymentDto,
  DisburseDto,
  FlwChargeCardDto,
  FundPayoutSubaccountDto,
  GenerateAddressDto,
  GetBalanceDto,
  GetTransactionsDto,
  InitializePayoutDto,
  InitPaymentDto,
  InitTransactionDto,
  PaymentDto,
  PaymentProcessorDto,
  ResendOtpDto,
  RewardCreditDto,
  StandardPaymentDto,
  TokenizedChargeDto,
  TransferWalletDto,
  UpdateBitnobCustomerDto,
  ValidateAddressDto,
  ValidateChargeDto,
  ValidateOtpDto,
  VerifyNinDto
} from './payment.dto';
import { PaymentService } from './payment.service';

@UseInterceptors(BushaSyncInterceptor, FlutterwaveSyncInterceptor, MonnifySyncInterceptor)
@Controller(ApiRoutes.PAYMENT)
@UseGuards(JwtGuard)
export class PaymentController {
  constructor(
    private paymentService: PaymentService,
    private monnifyService: MonnifyService,
    private flutterwaveService: FlutterwaveSuperfanService,
    private bushaService: BushaService,
    private walletService: WalletService,
    private bitnobService: BitnobService,
  ) {}

  @Post('/create-mandate')
  @HttpCode(HttpStatus.OK)
  async createMandate(@Body() dto: PaymentDto) {
    return this.monnifyService.createMandate(dto);
  }

  @Post('/debit')
  async debitMandate(@Body() dto: DebitPaymentDto) {
    return this.monnifyService.debitMandate(dto);
  }

    @Post('bitnob-customer')
  async createCustomer(@Body() dto: CreateBitnobCustomerDto) {
    return this.bitnobService.createCustomer(dto);
  }

  @Post('generate-address')
  async generateAddress(
    @Body() dto: GenerateAddressDto,
  ) {
    return this.bitnobService.generateAddress(
      dto,
    );
  }

    @Post('simulate-payment')
  async simulatePayment(
    @Body('address') address: string,
    @Body('amount') amount: string,

  ) {
    return this.bitnobService.simulatePayment(
      address,
      amount
    );
  }

      @Post('crypto-withdrawal')
  async createBitnobWithdrawal(
    @Body() dto: CreateWithdrawalDto, @Req() req: any

  ) {
    return this.bitnobService.createWithdrawal(
      dto, req.user.id
    );
  }

    @Post('validate-address')
  async validateAddress(
    @Body() dto: ValidateAddressDto,
  ) {
    return this.bitnobService.validateAddress(
      dto,
    );
  }

    @Get('bitnob-customers')
  async getCustomers(
    @Query('customer_type') customerType?: string,

    @Query('email') email?: string,

    @Query('is_active') isActive?: string,
  ) {
    return this.bitnobService.getCustomers({
      customer_type: customerType,
      email,
      is_active:
        isActive !== undefined
          ? isActive === 'true'
          : undefined,
    });
  }

    @Put('update-bitnob-customer/:customerId')
  async updateCustomer(
    @Param('customerId') customerId: string,
    @Body() body: UpdateBitnobCustomerDto,
  ) {
    return this.bitnobService.updateCustomer(
      customerId,
      body,
    );
  }

  @Get('/mandates')
  async getMandates(@Query('mandateReference') mandateReference: string) {
    return this.monnifyService.getMandates(mandateReference);
  }

  @Get('/banks')
  async getBanks(@Query('country') country?: string) {
    if (country) {
      return this.flutterwaveService.getBanks(country);
    }
    return this.monnifyService.getBanks();
  }

  @Post('/charge-card')
  async chargeCard(@Body() body: ChargeCardDto) {
    return this.monnifyService.chargeCard(body);
  }

  @Post('/flw-create-virtual-account')
  async createVirtualAccount(@Body() dto: CreateVirtualAccountDto) {
    return this.flutterwaveService.createVirtualAccount(dto);
  }

    @Post('/initialize-payout')
  async initializePayout(@Body() dto: InitializePayoutDto) {
    return this.bitnobService.initializePayout(dto);
  }

  @Post('/initialize-transaction')
  async initializeTransaction(@Body() body: InitTransactionDto) {
    return this.monnifyService.initTransaction(body);
  }

  @Post('/create-reserved-account')
  async createReservedAccount(@Body() body: CreateReservedAccountDto) {
    return this.monnifyService.createReservedAccount(body);
  }

  @Get('/validate-account')
  async validateAccount(
    @Query('accountNumber') accountNumber: string,
    @Query('bankCode') bankCode: string,
  ) {
    return await this.monnifyService.validateAccount(accountNumber, bankCode);
  }

  @Get('/debit-status')
  async getDebitStatus(@Query('paymentReference') paymentReference: string) {
    return this.monnifyService.getMandateDebitStatus(paymentReference);
  }

  @Get('/convert')
  async convert(@Query('amount', ParseFloatPipe) amount: number) {
    return this.paymentService.convertNgnToUsd(amount);
  }

    @Get('/rates')
  async getExchangeRate(
    @Query('currency') currency: string,
  ) {
    return await this.paymentService.getExchangeRate(currency);
  }

  @Get('/reserved-account/:accountReference')
  async getReservedAccount(
    @Param('accountReference') accountReference: string,
  ) {
    return this.monnifyService.getReservedAccount(accountReference);
  }

  @Post('/bvn-match')
  async verifyBvn(@Body() dto: BvnMatchDto) {
    return this.monnifyService.verifyBvnMatch(dto);
  }

  @Post('/bvn-account-match')
  async verifyBvnAccount(@Body() dto: BvnAccountMatchDto) {
    return this.monnifyService.verifyBvnAccountMatch(dto);
  }

  @Post('/verify-nin')
  async verifyNin(@Body() dto: VerifyNinDto) {
    return this.monnifyService.verifyNin(dto.nin);
  }

  @Post('/init-payment-by-transfer')
  async initPayment(@Body() dto: InitPaymentDto, @Req() req: any) {
    const userId = req.user.id;
    return this.monnifyService.initPaymentByTransfer(dto, userId);
  }

  @Post('authorize-otp')
  async authorizeOtp(@Body() dto: AuthorizeOtpDto) {
    return this.monnifyService.authorizeOtp(dto);
  }

  @Post('authorize-3ds')
  async authorize3DS(@Body() dto: Authorize3DSecureCardDto) {
    return this.monnifyService.authorize3DSecure(dto);
  }

    @Get('query-transaction-fees')
  async getTransferFee(
    @Query('amount') amount: number,
    @Query('currency') currency: string,

  ) {
    return this.flutterwaveService.getTransferFee(
      amount,
      currency,
    );
  }

  @Get('transactions/:transactionReference')
  async getTransaction(
    @Param('transactionReference') transactionReference: string,
  ) {
    return this.monnifyService.getTransactionByReference(transactionReference);
  }

  @Get('query-transaction')
  async queryTransaction(
    @Query('transactionReference') transactionReference?: string,
    @Query('paymentReference') paymentReference?: string,
  ) {
    return this.monnifyService.queryTransaction(
      transactionReference,
      paymentReference,
    );
  }

  @Get('processors')
  async getPaymentProcessors() {
    return this.paymentService.getPaymentProcessors();
  }

@Get('transactions')
async getWalletTransactions(
  @Query('userId') userId?: string,
  @Query('accountType') accountType?: string,
) {
  return this.walletService.getUserWalletTransactions(
    userId ? Number(userId) : undefined,
    accountType,
  );
}

    @Get('transactions-by-id')
  async getWalletTransactionsById(@Query('id') id: number) {
    return this.walletService.getWalletTransactionsbyId(id);
  }

  @Get('busha-customers')
  async getBushaCustomers() {
    return this.bushaService.getCustomers();
  }

  @Get('busha-customer/:id')
  async getCustomerById(@Param('id') id: string) {
    return this.bushaService.getCustomerById(id);
  }

    @Get(':id/verify')
  async verifyTransaction(@Param('id') id: string) {
    return this.flutterwaveService.verifyTransaction(id);
  }

  @Patch('/edit/processors')
  async updatePaymentProcessors(@Body() dto: PaymentProcessorDto) {
    return this.paymentService.UpdatePaymentProcessors(dto);
  }

  @Post('/create-wallet')
  @HttpCode(HttpStatus.CREATED)
  async createWallet(@Body() createWalletDto: CreateWalletDto) {
    return await this.monnifyService.createWallet(createWalletDto);
  }

  @Post('/create-payment-plan')
  @HttpCode(HttpStatus.CREATED)
  async createPaymentPlan(@Body() createPaymentPlanDto: CreatePaymentPlanDto) {
    return await this.flutterwaveService.createPaymentPlan(
      createPaymentPlanDto,
    );
  }

  @Get('/get-payment-plan')
  @HttpCode(HttpStatus.CREATED)
  async getPaymentPlan() {
    return await this.flutterwaveService.getPaymentPlan();
  }

  @Get('/get-transfer-by/:id')
  @HttpCode(HttpStatus.CREATED)
  async getTransferById(@Param('id') id: string) {
    return await this.flutterwaveService.getTransferById(id);
  }

    @Post('trf-btw-wallets/:userId')
    async transferbtwWallets(@Param('userId') userId: number, @Body() dto: TransferWalletDto) {
    return this.walletService.transferbtwPersonalandGoldAccount(userId, dto.amount, dto.fromAccountType);
  }

    @Post('tokenized-charge')
  async tokenizedCharge(@Body() body: TokenizedChargeDto) {
    return this.flutterwaveService.tokenizedCharge(body);
  }

  @Post('/activate-subscription')
  @HttpCode(HttpStatus.OK)
  async activateSubscription(@Body() body: { subscriptionId: string }) {
    return await this.flutterwaveService.activateSubscription(
      body.subscriptionId,
    );
  }

  @Get('wallets')
  async getWallets(
    @Query('walletReference') walletReference?: string,
    @Query('pageSize') pageSize?: string,
    @Query('pageNo') pageNo?: string,
  ) {
    // Convert query params to numbers if they exist
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : undefined;
    const pageNoNum = pageNo ? parseInt(pageNo, 10) : undefined;

    return this.monnifyService.getWallets(
      walletReference,
      pageSizeNum,
      pageNoNum,
    );
  }

  @Get('user-wallet-balance')
  async getUserWalletBalance(@Query('userId') userId: number) {
    if (!userId) {
      return { error: 'user does not exist' };
    }
    return this.monnifyService.getUserWalletBalance(userId);
  }

  @Get('wallet-balance')
  async getWalletBalance(@Query('accountNumber') accountNumber: string) {
    if (!accountNumber) {
      return { error: 'accountNumber query parameter is required' };
    }
    return this.monnifyService.getWalletBalance(accountNumber);
  }

  @Post('charge-card-token')
  async chargeCardToken(@Body() body: ChargeCardTokenDto) {
    return this.monnifyService.chargeCardToken(body);
  }

  @Post('payment-method')
  async createPaymentMethod(
    @Req() req: any,
    @Body() dto: CreatePaymentMethodDto,
  ) {
    return this.flutterwaveService.createPaymentMethod(req.user.id, dto);
  }

  @Post('/init-transfer')
  async disburse(@Body() body: DisburseDto, @Req() req: any) {
    return this.monnifyService.disburseSingle(body, req.user.id);
  }

  @Post('/wallet-withdrawal')
  async walletWithdrawal(@Body() body: DisburseDto, @Req() req: any) {
    return this.monnifyService.walletWithdrawal(body, req.user.id);
  }

  @Post('/credit-wallet')
  async creditWallet(@Body() userId: number, @Body() amount: number, @Body() title: string, @Body() description: string) {
    return this.walletService.creditWallet(userId, amount, title, description);
  }

  @Post('/wallet/credit/test-quiz-reward')
  async creditTestQuizReward(@Body() dto: RewardCreditDto, @Req() req: any) {
    let points = dto.amount * 1000;
    return this.walletService.createQuizReward(req.user.id ||  dto.userId, dto.amount, 'NGN', dto.subject, EarningStatus.AVAILABLE, points);
  }

  @Post('/wallet/credit/live-quiz-reward')
  async creditLiveQuizReward(@Body() dto: RewardCreditDto, @Req() req: any) {
    return this.walletService.createLiveQuizReward(req.user.id ||  dto.userId, dto.amount, EarningStatus.AVAILABLE);
  }

  @Post('/wallet/credit/ad-reward')
  async creditAdReward(@Body() dto: RewardCreditDto, @Req() req: any) {
    return this.walletService.createReward(req.user.id ||  dto.userId, dto.amount, 'NGN', 'ad', EarningStatus.AVAILABLE);
  }

  @Post('/resend-otp')
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.monnifyService.resendOtp(dto);
  }

  @Post('/validate-otp')
  async validateOtp(@Body() dto: ValidateOtpDto) {
    return this.monnifyService.validateOtp(dto);
  }

  @Post('/create-beneficiary')
  async create(@Body() dto: CreateBeneficiaryDto) {
    return this.flutterwaveService.createBeneficiary(dto);
  }

  @Get('/payment-method')
  async getPaymentMethods(@Query('id') id: string) {
    return this.flutterwaveService.getPaymentMethods(id);
  }

  @Post('/charge-card-flw')
  async chargeCardFlw(@Body() body: FlwChargeCardDto, @Req() req: any) {
    return this.flutterwaveService.chargeCard(body, req.user.id);
  }

  @UseInterceptors(ClassSerializerInterceptor)
    @Post('flw-validate-charge')
  async validateCharge(@Body() dto: ValidateChargeDto) {
    return this.flutterwaveService.validateCharge(dto);
  }

  @Post('/charge-standard-payement')
  async chargeStandardPayment(@Body() body: StandardPaymentDto) {
    return this.flutterwaveService.createflwPayment(body);
  }



  @Patch('/cancel-mandate')
  async cancelMandate(@Body() dto: CancelMandateDto) {
    return this.monnifyService.cancelMandate(dto);
  }

  @Post('flw-bank-transfer')
  async bankTransfer(@Body() body: BankTransferDto) {
    return this.flutterwaveService.flwBankTransfer(body);
  }

  @Post('balances')
  async createBushaBalance(@Body() dto: CreateBalanceDto) {
    return this.bushaService.createBalance(dto);
  }

  @Get('balances')
  async getBalances(@Query() dto: GetBalanceDto) {
    return this.bushaService.getBalances(dto);
  }


  @Get('currencies')
  async getBushaCurrencies() {
    return this.bushaService.getSupportedCurrencies();
  }

    @Get('bitnob-chains')
  async getSupportedChains() {
    return this.bitnobService.getSupportedChains();
  }

    @Get('/quote-prices')
  async getQuotePrices() {
    return this.bitnobService.getQuotePrices();
  }

    @Get('/get-bitnob-bal')
  async getBitnobBalance() {
    return this.bitnobService.getBalance();
  }

  @Get('currencies/:code')
  async getBushaCurrency(@Param('code') code: string) {
    return this.bushaService.getCurrencyByCode(code.toUpperCase());
  }

  @Post('customers')
  async createBushaCustomer(@Body() dto: CreateBushaCustomerDto) {
    return this.bushaService.createCustomer(dto);
  }

  @Post('/customer/verify')
  async verifyCustomer(@Query('id') id: string) {
    return this.bushaService.verifyCustomer(id);
  }

  @Post('/create-withdrawal-bank')
  async createWithdrawalBank(
    @Req() req: any,
    @Body() dto: CreateUserWithdrawalBankDto,
  ) {
    return this.paymentService.createWithdrawalBank(req.user.id, dto);
  }

  // Get all banks for a user
  @Get('user-withdrawal-banks/:userId')
  async getUserWithdrawalBanks(@Param('userId', ParseIntPipe) userId: number) {
    return this.paymentService.getUserWithdrawalBanks(userId);
  }

  @Post('create-flw-transfer')
  async createTransfer(@Body() dto: CreateTransferDto) {
    return this.flutterwaveService.createTransfer(dto);
  }

  @Post('/create-withdrawal-wallet')
  async createWithdrawalWallet(
    @Req() req: any,
    @Body() dto: CreateUserWithdrawalWalletDto,
  ) {
    return this.paymentService.createWithdrawalWallet(req.user.id, dto);
  }

    @Post('transactions/:transactionId/resend-hook')
  @HttpCode(HttpStatus.OK)
  async resendHook(
    @Param('transactionId') transactionId: string,
  ): Promise<any> {
 
    return this.flutterwaveService.resendTransactionHook(transactionId);
  }

  // Get all banks for a user
  @Get('user-withdrawal-wallet/:userId')
  async getUserWithdrawalWallets(
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.paymentService.getUserWithdrawalWallets(userId);
  }

  @Get('/wallet-activity/:userId')
  async getUserWalletActivity(@Param('userId', ParseIntPipe) userId: number) {
    return this.paymentService.getWalletActivity(userId);
  }

  @Post('/busha-quote')
  createQuote(@Body() dto: CreateBushaQuoteDto, @Req() req: any) {
    return this.bushaService.createQuote(dto, req.user.id);
  }

    @Post('payouts-quotes')
  async createPayoutQuote(
    @Body() dto: CreatePayoutQuoteDto,
  ) {
    return this.bitnobService.createPayoutQuote(dto);
  }

  @Post(':account_reference/fund-account')
  fundSubaccount(
    @Param('account_reference') accountReference: string,
    @Body() dto: FundPayoutSubaccountDto,
  ) {
    return this.flutterwaveService.fundSubaccount(accountReference, dto);
  }

  @Get('payout-subaccounts/:accountReference/static-account')
  async getStaticVirtualAccount(
    @Param('accountReference') accountReference: string,
    @Query('currency') currency: string,
    @Query('verbose') verbose: number,
  ) {
    return this.flutterwaveService.fetchStaticVirtualAccount(
      accountReference,
      currency,
      verbose,
    );
  }

  @Post('/recipients')
  @HttpCode(HttpStatus.CREATED)
  async createRecipient(@Body() dto: CreateRecipientDto) {
    return this.bushaService.createRecipient(dto);
  }

  @Get('/wallet-transactions')
  getAdminWalletTransactions() {
    return this.paymentService.fetchWalletTransactions();
  }

  @Get('/busha-quote')
  getBushaQuotes() {
    return this.bushaService.getBushaQuotes();
  }

  @Get('pairs')
  @HttpCode(HttpStatus.OK)
  async getPairs() {
    return this.bushaService.getPairs();
  }

  @Get('/busha-quote/:id')
  async getQuote(@Param('id') id: string) {
    return this.bushaService.getQuoteById(id);
  }

  @Get('/busha-transaction/:id')
  async getBushaTransaction(@Param('id') id: string) {
    return this.bushaService.getTransactionById(id);
  }

  @Get('/busha-transactions')
  async getBushaTransactions(@Query('id') id: string) {
    return this.bushaService.getTransactions(id);
  }

  @Post('/busha-transfer')
  createBushaTransfer(@Body() dto: CreateBushaTransferDto) {
    return this.bushaService.createTransfer(dto);
  }

  @Get('/get-busha-transfers')
  async getBushaTransfers() {
    return this.bushaService.getTransfers();
  }

  @Get('/busha-transfer/:id/:customerId')
  async getBushaTransfer(
    @Param('id') id: string,
    @Param('customerId') customerId: string,
  ) {
    return this.bushaService.getTransferById(id, customerId);
  }

  @Get(':accountReference/balance')
  async getBalance(
    @Param('accountReference') accountReference: string,
    @Query('currency') currency: string,
  ) {
    return this.flutterwaveService.getSubaccountBalance(
      accountReference,
      currency,
    );
  }

  @Get(':accountReference/transactions')
  async getTransactions(
    @Param('accountReference') accountReference: string,
    @Query() query: GetTransactionsDto,
  ) {
    return this.flutterwaveService.getSubaccountTransactions(
      accountReference,
      query,
    );
  }

  // Get single bank by id
  @Get(':id')
  async getOneWIthdrawalBank(@Param('id', ParseIntPipe) id: number) {
    return this.paymentService.findOneWithdrawalBank(id);
  }

  // Get single wallet by id
  @Get(':id')
  async getOneWIthdrawalWallet(@Param('id', ParseIntPipe) id: number) {
    return this.paymentService.findOneWithdrawalWallet(id);
  }

    @Get('/transaction/:tx_ref')
  async getWalletTransactionByReference(@Param('tx_ref') tx_ref: string) {
    return this.walletService.getWalletTransactionByReference(tx_ref);
  }

    @Get('single-balances/:idOrCode/:customerId')
  async getBalanceDetails(
    @Param('idOrCode') idOrCode: string,
    @Param('customerId') customerId: string,
  ) {
    return this.bushaService.getBalanceDetails(idOrCode, customerId);
  }

}
