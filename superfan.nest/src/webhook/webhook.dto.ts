// export class ProductDto {
//   reference: string;
//   type: string;
// }

import { IsObject, IsString } from "class-validator";

export class OfflineProductInformationDto {
  code: string;
  type: string;
}

export class CustomerDto {
  name: string;
  email: string;
}

export class EventDataDto {
  transactionReference: string;
  reference: string;
  paidOn: string;
  paymentDescription: string;
  metaData: Record<string, unknown>;
  destinationAccountInformation: Record<string, unknown>;
  paymentSourceInformation: Record<string, unknown>;
  amountPaid: number;
  totalPayable: number;
  offlineProductInformation: OfflineProductInformationDto;
  cardDetails: Record<string, unknown>;
  paymentMethod: string;
  currency: string;
  settlementAmount: number;
  paymentStatus: string;
  customer: CustomerDto;
}

export class DisbursementEventDataDto {
  amount: number;
  fee: number;
  transactionReference: string;
  transactionDescription: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  destinationBankCode: string;
  destinationBankName: string;
  reference: string;
  sessionId: string;
  narration: string;
  currency: string;
  status: string;
  createdOn: string;
  completedOn: string;
}

// export class MonnifyWebhookDto {
//   eventData: EventDataDto | DisbursementEventDataDto;
//   eventType: string;
// }

export class MonnifyWebhookDto {
  @IsString()
  eventType: string;

  @IsObject()
  eventData: Record<string, any>;
}