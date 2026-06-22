import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { PrismaService } from "../config/database/prisma.service";
import { NotificationModule } from "../notification/notification.module";
import { BushaService } from "../payment/busha.service";
import { MonnifyService } from "../payment/monnify.service";
import { WalletService } from "./wallet.service";

@Module({
    imports: [HttpModule, NotificationModule],
    providers: [WalletService, PrismaService, MonnifyService, BushaService],
    exports: [WalletService]
})

export class WalletModule {}