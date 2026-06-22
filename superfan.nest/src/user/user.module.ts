import { HttpModule } from "@nestjs/axios";
import { Module, forwardRef, Global } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AccessControlService } from "../common/shared/access-control.service";
import { DatabaseModule } from "../config/database/database.module";
import { MailModule } from "../mail/mail.module";
import { NotificationModule } from "../notification/notification.module";
import { PaymentModule } from "../payment/payment.module";
import { PosthogModule } from "../posthog/posthog.module";
import { TaskModule } from "../tasks/tasks.module";
import { WalletModule } from "../wallet/wallet.module";
import { PresenceGateway } from './gateway/presence.gateway';
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { UserListener } from "./user.listener";

@Global()
@Module({
    imports: [
        ConfigModule, 
        MailModule, 
        PosthogModule, 
        HttpModule, 
        forwardRef(() => TaskModule),
        DatabaseModule,
        WalletModule,
        PaymentModule,
        NotificationModule
    ],
    controllers: [UserController],
    providers: [
        UserService, 
        PresenceGateway, 
        UserListener, 
        AccessControlService
    ],
    exports: [UserService, PresenceGateway],
})
export class UserModule {}