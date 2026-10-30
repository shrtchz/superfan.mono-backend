import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // adjust path as needed
import { ResetController } from './reset.controller';
import { ResetService } from './reset.service';

@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [ResetController],
  providers: [ResetService, ], // Ensure is provided
})
export class ResetModule {}