import { Module } from '@nestjs/common';
import { PaymentProcessorController } from './payment-processor.controller';
import { PaymentProcessorService } from './payment-processor.service';

@Module({
  controllers: [PaymentProcessorController],
  providers: [PaymentProcessorService],
  exports: [PaymentProcessorService],
})
export class PaymentProcessorModule {}
