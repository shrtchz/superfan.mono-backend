import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // adjust path as needed
import { BushaService } from '../payment/busha.service';
import { ResetController } from './reset.controller';
import { ResetService } from './reset.service';

@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [ResetController],
  providers: [ResetService, BushaService], // Ensure BushaService is provided
})
export class ResetModule {}