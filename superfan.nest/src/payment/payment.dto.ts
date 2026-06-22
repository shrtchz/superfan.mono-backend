import { SubscriptionPlan } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  ValidateNested
} from 'class-validator';
import {
  PayInType,
  PayOutType,
  ReversalPolicy,
} from '../common/enums/busha.enum';
// import { SubscriptionPlan } from '../generated/prisma/enums';

export enum PaymentMethodType {
  CARD = 'card',
  BANK_ACCOUNT = 'bank_account',
  OPAY = 'opay',
}

enum AuthorizationMode {
  PIN = 'pin',
}

export class AuthorizationDto {
  @IsEnum(AuthorizationMode)
  mode: AuthorizationMode;

  @IsString()
  @Matches(/^\d+$/, { message: 'pin must contain only digits' })
  @Length(3, 4, { message: 'pin must be between 3 and 4 digits' })
  pin: string;
}

export class PaymentDto {
  @IsOptional()
  @IsInt()
  mandateAmount: number;

  @IsOptional()
  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  customerPhoneNumber: string;

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  subscriptionPlan?: SubscriptionPlan;

  @IsOptional()
  @IsString()
  customerEmailAddress: string;

  @IsOptional()
  @IsString()
  customerAddress: string;

  @IsOptional()
  @IsString()
  customerAccountNumber: string;

  @IsOptional()
  @IsString()
  customerAccountBankCode: string;

  @IsOptional()
  @IsString()
  mandateDescription: string;

  @IsOptional()
  @IsString()
  mandateStartDate: string;

  @IsOptional()
  @IsString()
  mandateEndDate: string;

  @IsOptional()
  @IsString()
  redirectUrl: string;

  @IsOptional()
  @IsInt()
  debitAmount: number;
}

export class GenerateAddressDto {
  @IsString()
  @IsNotEmpty()
  chain: string;

  @IsEmail()
  customer_email: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  reference: string;
}

export class createBeneficiary {
  @IsString()
  @IsNotEmpty()
  type: string;

    @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  customer_email: string;

      @IsString()
  @IsNotEmpty()
  account_number: string;

        @IsString()
  @IsNotEmpty()
  bank_code: string;

  
        @IsString()
  @IsNotEmpty()
  account_name: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  reference: string;
}

export class ValidateAddressDto {
  @IsString()
  @IsNotEmpty()
  chain: string;

    @IsString()
  @IsNotEmpty()
  address: string;
}

export class PayWithBankTransferDto {
  @IsString()
  transactionReference: string;

  @IsString()
  bankCode: string;
}

export class ValidateChargeDto {
  @IsString()
  otp: string;

  @IsString()
  flw_ref: string;

  @IsString()
  type: string; // usually "card"
}

export class TransferWalletDto {
  @IsNumber()
  amount: number;

  @IsString()
  fromAccountType: 'Personal' | 'Gold';
}

export class CreateVirtualAccountDto {
    @IsOptional()
  @IsInt()
  amount?: number;

  @IsString()
  reference: string;

  @IsString()
  customer_id: string;

  @IsString()
  @IsIn(['NGN'])
  currency: string;

  @IsString()
  @IsIn(['static', 'dynamic'])
  account_type: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsNumberString()
  @Length(11, 11, { message: 'BVN must be exactly 11 digits' })
  bvn?: string;
}


export class SubscriptionCardPaymentDto {
  @IsString()
transactionReference: string

@IsEnum(SubscriptionPlan)
subscriptionPlan: SubscriptionPlan

@IsInt()
debitAmount: number
}

export class FlwChargeCardDto {
  @IsOptional()
  @IsBoolean()
  is_custom_3ds_enabled?: boolean;

  @IsNumber()
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  card_number: string;

  @IsString()
  cvv: string;

  @IsString()
  expiry_month: string;

  @IsString()
  expiry_year: string;

  @IsEmail()
  email: string;

  @IsString()
  tx_ref: string;


  @IsString()
  fullname: string;

  @IsOptional()
  @IsString()
  card_holder_name?: string;

  @IsString()
  phone_number: string;

  @IsOptional()
  @IsString()
  payment_plan?: string;

  @IsOptional()
  @IsString()
  a_transactionstatus?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AuthorizationDto)
  authorization: AuthorizationDto;
}

export class PaymentProcessorDto {
  @IsOptional()
  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  secretKey: string;

  @IsOptional()
  @IsString()
  publicKey: string;

  @IsOptional()
  @IsBoolean()
  isConnected: boolean;

  @IsOptional()
  @IsString()
  lastSync: string;
}

export class CreatePaymentPlanDto {
  @IsInt()
  amount: number;

  @IsString()
  name: string;

  @IsString()
  interval: string; // e.g. Monthly, Weekly

  @IsOptional()
  @IsInt()
  duration?: number;
}

export class BvnMatchDto {
  @IsString()
  bvn: string;

  @IsString()
  name: string;

  @IsString()
  dateOfBirth: string;

  @IsString()
  mobileNo: string;
}

export class DisburseDto {
  @IsInt()
  @IsOptional()
  amount: number;

  @IsString()
  @IsOptional()
  reference: string;

  @IsString()
  @IsOptional()
  narration: string;

  @IsString()
  @IsOptional()
  destinationBankCode: string;

  @IsString()
  @IsOptional()
  destinationAccountNumber: string;

  @IsString()
  @IsOptional()
  destinationAccountName: string;

  @IsString()
  @IsOptional()
  currency: string;

  @IsString()
  @IsOptional()
  sourceAccountNumber: string;

  @IsString()
  @IsOptional()
  sourceAccountName: string;

  @IsString()
  @IsOptional()
  sourceAccountBvn: string;

  @IsString()
  @IsOptional()
  senderBankCode: string;
}

export class AuthorizeOtpDto {
  @IsString()
  transactionReference: string;

  @IsString()
  collectionChannel: string;

  @IsString()
  tokenId: string;

  @IsString()
  token: string;
}

export class Authorize3DSecureCardDto {
  @IsString()
  transactionReference: string;

  @IsString()
  collectionChannel: string;

  @IsObject()
  card: {
    number: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: number;
    pin: number;
  };
}

export class BvnAccountMatchDto {
  @IsString()
  bankCode: string;

  @IsString()
  accountNumber: string;

  @IsString()
  bvn: string;
}

export class BvnDetailsDto {
  @IsString()
  @Length(11, 11, { message: 'BVN must be exactly 11 digits' })
  bvn: string;

  @IsDateString(
    {},
    { message: 'BVN date of birth must be a valid date (YYYY-MM-DD)' },
  )
  bvnDateOfBirth: string;
}

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  walletReference: string;

  @IsString()
  @IsNotEmpty()
  walletName: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsEmail({}, { message: 'customerEmail must be a valid email address' })
  customerEmail: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => BvnDetailsDto)
  bvnDetails: BvnDetailsDto;
}

export class InitPaymentDto {
  @IsString()
  transactionReference: string;

  @IsString()
  bankCode: string;
}

export class VerifyNinDto {
  @IsString()
  @Length(11, 11)
  nin: string;
}

export class CreateReservedAccountDto {
  @IsOptional()
  @IsString()
  accountReference: string;

  @IsOptional()
  @IsString()
  accountName: string;

  @IsOptional()
  @IsString()
  currencyCode: string;

  @IsOptional()
  @IsString()
  customerEmail: string;

  @IsOptional()
  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  bvn?: string;

  @IsOptional()
  @IsBoolean()
  getAllAvailableBanks?: boolean;

  @IsOptional()
  preferredBanks?: string[];
}

export class DebitPaymentDto {
  @IsOptional()
  @IsString()
  paymentReference: string;

  @IsOptional()
  @IsString()
  mandateCode: string;

  @IsOptional()
  @IsInt()
  debitAmount: number;

  @IsOptional()
  @IsString()
  narration: string;

  @IsOptional()
  @IsString()
  customerEmail: string;
}

export class SubAccountDto {
  @IsOptional()
  @IsString()
  customerAccountNumber: string;

  @IsOptional()
  @IsString()
  customerAccountBankCode: string;

  @IsOptional()
  @IsString()
  customerEmailAddress: string;

  @IsOptional()
  @IsString()
  customerCurrency: string;

  @IsOptional()
  @IsInt()
  defaultSplitPercentage: number;
}

class CardDto {
  @IsString()
  @IsNotEmpty()
  number: string;

  @IsString()
  @IsNotEmpty()
  @Length(2, 2)
  expiryMonth: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 4)
  expiryYear: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 4)
  pin: string;

  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  cvv: string;
}

export class ChargeCardDto {
  @IsString()
  @IsNotEmpty()
  transactionReference: string;

  @ValidateNested()
  @Type(() => CardDto)
  card: CardDto;
}

export class InitTransactionDto {
  @IsNumber()
  amount: number;

  @IsEmail()
  customerEmail: string;

  @IsString()
  paymentReference: string;

  @IsString()
  paymentDescription: string;

  @IsString()
  currencyCode: string;

  @IsOptional()
  @IsString()
  redirectUrl: string;

  @IsArray()
  paymentMethods: string[];

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  incomeSplitConfig?: any[];
}

export class RewardCreditDto {
  @IsNumber()
  amount: number;

  @IsOptional()
    @IsString()
  subject: string;

  
  @IsNumber()
  userId: number;
}

class IncomeSplitDto {
  @IsString()
  subAccountCode: string;

  @IsNumber()
  feePercentage: number;

  @IsNumber()
  splitPercentage: number;

  @IsBoolean()
  feeBearer: boolean;

  @IsNumber()
  splitAmount: number;
}

export class ChargeCardTokenDto {
  @IsString()
  cardToken: string;

  @IsNumber()
  amount: number;

  @IsString()
  customerName: string;

  @IsEmail()
  customerEmail: string;

  @IsString()
  paymentReference: string;

  @IsString()
  paymentDescription: string;

  @IsString()
  currencyCode: string;

  @IsObject()
  metaData: {
    ipAddress: string;
    deviceType: string;
  };
}

export class ResendOtpDto {
  @IsString()
  reference: string;
}

export class ValidateOtpDto {
  @IsString()
  reference: string;

  @IsString()
  authorizationCode: string;
}

export class CancelMandateDto {
  @IsString()
  mandateReference: string;
}

export class GetBalanceDto {
  @IsOptional()
  @IsString()
  currency?: string; // optional filter (BTC, NGN, etc.)

    @IsOptional()
  @IsString()
  customerId?: string; // optional filter (BTC, NGN, etc.)
}

export class CreateBitnobCustomerDto {
  @IsEmail()
  email: string;

  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsString()
  phone: string;

  @IsString()
  country_code: string;
}

export class UpdateBitnobCustomerDto {
  @IsOptional()
  @IsEmail()
  email: string;

   @IsOptional()
  @IsString()
  first_name: string;

   @IsOptional()
  @IsString()
  last_name: string;

   @IsOptional()
  @IsString()
  phone: string;

   @IsOptional()
  @IsString()
  country_code: string;
}

export class CreateCustomerDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  country_code: string;

  @IsString()
  @IsNotEmpty()
  number: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsString()
  @IsNotEmpty()
  line1: string;

  @IsString()
  @IsNotEmpty()
  postal_code: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class CreateBeneficiaryDto {
  @IsString()
  @IsNotEmpty()
  account_bank: string;

  @IsString()
  @IsNotEmpty()
  account_number: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  beneficiary_name: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  bank_name: string;
}

export class CreatePaymentMethodDto {
  @IsEnum(PaymentMethodType)
  type: PaymentMethodType;

  @IsOptional()
  @IsObject()
  card?: {
    billing_address: {
      city: string;
      country: string;
      line1: string;
      postal_code: string;
      state: string;
    };
    cof: {
      enabled: boolean;
    };
    nonce: string;
    encrypted_expiry_month: string;
    encrypted_expiry_year: string;
    encrypted_card_number: string;
    encrypted_cvv: string;
    card_holder_name: string;
  };

  @IsOptional()
  @IsObject()
  bank_account?: {
    accountNumber: string;
    accountName: string;
  };

  @IsOptional()
  @IsObject()
  opay?: {
    accountNumber: number;
  };
}

class CustomerDto {
  @IsEmail()
  email: string;

  @IsString()
  phone_number: string;

  @IsString()
  name: string;
}

class CustomizationsDto {
  @IsString()
  title: string;

  @IsString()
  logo: string;
}

class ConfigurationDto {
  @IsNumber()
  session_duration: number;
}

export class StandardPaymentDto {
  @IsNumber()
  amount: number;

  @IsString()
  tx_ref: string;

  @IsString()
  currency: string;

  @IsString()
  redirect_url: string;

  @IsObject()
  customer: CustomerDto;

  @IsOptional()
  @IsObject()
  customizations?: CustomizationsDto;

  @IsOptional()
  @IsObject()
  configuration?: ConfigurationDto;

  @IsOptional()
  @IsNumber()
  max_retry_attempt?: number;

  @IsOptional()
  @IsNumber()
  payment_plan?: number;

  @IsOptional()
  @IsString()
  payment_options?: string;

  @IsOptional()
  @IsString()
  link_expiration?: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, any>;
}

export class BankTransferDto {
  @IsNumber()
  amount: number;

  @IsEmail()
  email: string;

  @IsString()
  currency: string;

  @IsString()
  tx_ref: string;

  @IsString()
  fullname: string;

  @IsString()
  customer_account_number: string;

  @IsString()
  phone_number: string;

  @IsString()
  client_ip: string;

  @IsString()
  device_fingerprint: string;

  @IsBoolean()
  is_permanent: boolean;
}

export class CreateBalanceDto {
  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  profileId: string;
}

class AddressDto {
  @IsString()
  address_line_1: string;

  //   @IsString()
  // address: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  postal_code: string;

  @IsString()
  country_id: string;
}

export class IdentifyingInformationDto {
  @IsOptional()
  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  number: string;

  @IsOptional()
  @IsString()
  country: string;

  @IsOptional()
  @IsString()
  image_front: string;

  @IsOptional()
  @IsString()
  image_back?: string;
}


export class CreateBushaCustomerDto {
  @IsEmail()
  email: string;

  @IsBoolean()
  has_accepted_terms: boolean;

  @IsString()
  type: string;

  @IsString()
  country_id: string;

  @IsString()
  phone: string;

  @IsString()
  birth_date: string;

  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsObject()
  address: AddressDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IdentifyingInformationDto)
  identifying_information: IdentifyingInformationDto[];
}

export class CreateUserWithdrawalBankDto {
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  bankName: string;

    @IsString()
  @IsNotEmpty()
  bankCode: string;
}

export class CreateUserWithdrawalWalletDto {
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  network: string;

    @IsString()
  @IsNotEmpty()
  country: string;

      @IsString()
  @IsNotEmpty()
  legalEntityType: string;
}

class PayInDto {
  @IsOptional()
  @IsEnum(PayInType)
  type: PayInType;

  @IsOptional()
  @IsString()
  network: string;
}

class PayOutDto {
  @IsEnum(PayOutType)
  type: PayOutType;
}

export class CreateBushaQuoteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  source_currency: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  target_currency: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  quote_currency: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  quote_amount: string;

  @IsEnum(ReversalPolicy)
  @IsOptional()
  reversal_policy: ReversalPolicy;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  reference: string;

  @IsOptional()
  @IsString()
  source_amount?: string;

  @IsOptional()
  @IsString()
  target_amount?: string;

  @ValidateNested()
  @Type(() => PayInDto)
  @IsOptional()
  pay_in: PayInDto;

  @ValidateNested()
  @Type(() => PayOutDto)
  @IsOptional()
  pay_out: PayOutDto;

  @IsString()
  @IsOptional()
  customer_id: string;
}

export class CreateBushaTransferDto {
  @IsString()
  quote_id: string;

  @IsOptional()
    @IsString()
  customerId: string;
}

export class PaymentOptionsDto {
  @IsOptional()
  @IsBoolean()
  support_conversion?: boolean;

  @IsEnum(['withdraw', 'deposit'])
  type: 'withdraw' | 'deposit';

  @IsEnum(['wallet', 'bank'])
  purpose: 'wallet' | 'bank';

  @IsString()
  currency: string;

  @IsNumberString()
  amount: string;
}

export class CreateRecipientDto {
  @IsOptional()
  @IsString()
  customerId?: string

 @IsOptional()
  @IsString()
  type?: string;

   @IsOptional()
  @IsString()
  currency?: string;

     @IsOptional()
  @IsString()
  currency_id?: string;

       @IsOptional()
  @IsString()
  legal_entity_type?: string;


       @IsOptional()
  @IsString()
  country_id?: string;

   @IsOptional()
  @IsString()
  country_code?: string;

   @IsOptional()
  @IsString()
  entity_type?: string;

   @IsOptional()
  @IsString()
  transfer_type?: string;

   @IsOptional()
  @IsString()
  address_label?: string;

   @IsOptional()
  @IsString()
  account_name?: string;

   @IsOptional()
  @IsString()
  bank_name?: string;

   @IsOptional()
  @IsString()
  bank_code?: string;

   @IsOptional()
  @IsString()
  account_number?: string;

   @IsOptional()
  @IsString()
  phone_number?: string;

   @IsOptional()
  @IsString()
  network?: string;

   @IsOptional()
  @IsString()
  address?: string;

   @IsOptional()
  @IsString()
  recipient_address?: string;

   @IsOptional()
  @IsOptional()
  @IsString()
  intermediary_bank_name?: string;

  @IsOptional()
  @IsString()
  intermediary_bank_address?: string;

  @IsOptional()
  @IsString()
  intermediary_swift_code?: string;

   @IsOptional()
  @IsBoolean()
  one_time?: boolean;

  @IsOptional()
  @IsString()
  swift_code?: string;

  @IsOptional()
  @IsString()
  routing_number?: string;

  @IsOptional()
  @IsString()
  sort_code?: string;
}

class BankDto {
  @IsString()
  code: string;

  @IsString()
  account_number: string;
}

class RecipientDto {
  @ValidateNested()
  @Type(() => BankDto)
  bank: BankDto;
}

class AmountDto {
  @IsNumber()
  value: number;

  @IsString()
  applies_to: string;
}

class PaymentInstructionDto {
  @ValidateNested()
  @Type(() => AmountDto)
  amount: AmountDto;

  @IsString()
  source_currency: string;

  @IsString()
  destination_currency: string;

  @ValidateNested()
  @Type(() => RecipientDto)
  recipient: RecipientDto;
}

export class CreateTransferDto {
  @IsString()
  account_bank: string;

  @IsString()
  account_number: string;

  @IsNumber()
  amount: number;

  @IsString()
  currency: string;

  @IsOptional()
  @IsString()
  debit_subaccount: string;

  @IsOptional()
  @IsNumber()
  beneficiary: number;

  @IsOptional()
  @IsString()
  beneficiary_name: string;

  @IsString()
  reference: string;

  @IsString()
  debit_currency: string;

  @IsOptional()
  @IsString()
  destination_branch_code?: string;

  @IsString()
  callback_url: string;

  @IsString()
  narration: string;
}

export class CreatePayoutSubaccountDto {
  @IsString()
  account_name: string;

  @IsEmail()
  email: string;

  @IsString()
  country: string;

  @IsString()
  mobilenumber: string;

  @IsString()
  bank_code: string;
}

export class FundPayoutSubaccountDto {
  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsNumber()
  amount: number;
}

export class GetTransactionsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class TokenizedChargeDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEmail()
  email: string;

  @IsString()
  currency: string;

  @IsString()
  country: string;

  @IsNumber()
  amount: number;

  @IsString()
  tx_ref: string;

  @IsOptional()
  @IsString()
  redirect_url?: string;

  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsBoolean()
  preauthorize: boolean;
}

export class BeneficiaryAddressDto {
  @IsString()
  country: string;

  @IsString()
  city: string;

  @IsString()
  post_code: string;

  @IsString()
  address: string;
}

export class SenderDto {
  @IsString()
  type: string;

  @IsString()
  account_name: string;

  @IsString()
  country: string;

  @IsString()
  city: string;

  @IsString()
  address: string;

  @IsString()
  post_code: string;

  @IsString()
  registration_number: string;
}


export class PayoutBeneficiaryDto {
  @IsString()
  destination_type: string;

  @IsString()
  country: string;

  @IsString()
  account_name: string;

  @IsString()
  account_number: string;

  @IsString()
  swift_code: string;

  @IsString()
  bank_name: string;

  @IsString()
  bank_address: string;

  @IsString()
  bank_city: string;

  @IsString()
  bank_post_code: string;

  @IsString()
  bank_country: string;

  @IsString()
  remittance_purpose: string;

  @ValidateNested()
  @Type(() => BeneficiaryAddressDto)
  beneficiary: BeneficiaryAddressDto;

  @ValidateNested()
  @Type(() => SenderDto)
  sender: SenderDto;
}




export class InitializePayoutDto {
  @IsString()
  quote_id: string;

  @IsString()
  reference: string;

  @IsString()
  payment_reason: string;

  @IsUrl()
  callback_url: string;

  @ValidateNested()
  @Type(() => PayoutBeneficiaryDto)
  beneficiary: PayoutBeneficiaryDto;
}

export class CreatePayoutQuoteDto {
  @IsString()
  from_asset: string;

  @IsString()
  to_currency: string;

  @IsString()
  source: string;

    @IsString()
  country: string;

    @IsString()
  reference: string;

  @IsNumberString()
  amount: string;
}

export class CreateWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  to_address: string;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  chain: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  memo?: string;

  @IsString()
  @IsOptional()
  description?: string;
}