import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { FlutterwaveModule } from '@scwar/nestjs-flutterwave';
import { WalletModule } from '../wallet/wallet.module';
import { BushaService } from './busha.service';
import { FlutterwaveSuperfanService } from './flutterwave.service';
import { MonnifyService } from './monnify.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { BitnobService } from './bitnob.service';

@Module({
  imports: [HttpModule, WalletModule,     FlutterwaveModule.forRoot({
      secretKey: process.env.FLW_SECRET_KEY, // v3 key or pre-fetched v4 access token
      publicKey: process.env.FLW_PUBLIC_KEY,
      version: 'v3', // or 'v4'
    })],
  controllers: [PaymentController],
  providers: [PaymentService, FlutterwaveSuperfanService, MonnifyService, BushaService, BitnobService],
  exports: [PaymentService, FlutterwaveSuperfanService, MonnifyService, BushaService, BitnobService],
})
export class PaymentModule {}