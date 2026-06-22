import { IsString } from 'class-validator';

export class CreateQuoteDto {
  @IsString()
  text: string;
}