import { HttpModule } from "@nestjs/axios";
import { Module, forwardRef } from "@nestjs/common";
import { PointsConversionUtil } from "../common/utils/points-conversion.util";
import { PrismaService } from "../config/database/prisma.service";
import { NotificationModule } from "../notification/notification.module";
import { WalletService } from "./wallet.service";

@Module({
    imports: [HttpModule, NotificationModule],
    providers: [WalletService, PrismaService, PointsConversionUtil],
    exports: [WalletService, PointsConversionUtil]
})

export class WalletModule {}