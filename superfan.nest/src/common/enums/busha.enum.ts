export enum PayInType {
  ADDRESS = 'address',
  MOBILE_MONEY = 'mobile_money',
  TEMPORARY_BANK_ACCOUNT = 'temporary_bank_account',
  DIRECT_DEBIT = 'direct_debit',
  BALANCE = 'balance',
}

export enum PayOutType {
  ADDRESS = 'address',
  BANK_TRANSFER = 'bank_transfer',
  MOBILE_MONEY = 'mobile_money',
  PAYBILL = 'paybill',
  TILL = 'till',
  BALANCE = 'balance',
  SAVINGS = 'savings',
  DIRECT_DEBIT = 'direct_debit',
}

export enum ReversalPolicy {
  CONVERSION_ONLY = 'conversion_only',
}