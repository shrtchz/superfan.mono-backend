import { HttpModule } from "@nestjs/axios";
import { Module, forwardRef, Global } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AccessControlService } from "../common/shared/access-control.service";
import { DatabaseModule } from "../config/database/database.module";
import { MailModule } from "../mail/mail.module";
import { NotificationModule } from "../notification/notification.module";
import { PosthogModule } from "../posthog/posthog.module";
import { TaskModule } from "../tasks/tasks.module";
import { WalletModule } from "../wallet/wallet.module";
import { PresenceGateway } from './gateway/presence.gateway';
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { UserListener } from "./user.listener";
import { DiditService } from "./didit.service";
import { TwoFactorController } from "./two-factor/two-factor.controller";
import { TwoFactorService } from "./two-factor/two-factor.service";
import { TalkingDrumService } from "./two-factor/talking-drum.service";
import { ImageModule } from "../image/image.module";

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
        NotificationModule,
        ImageModule,
    ],
    controllers: [UserController, TwoFactorController],
    providers: [
        UserService, 
        PresenceGateway, 
        UserListener, 
        AccessControlService,
        DiditService,
        TwoFactorService,
        TalkingDrumService,
    ],
    exports: [UserService, PresenceGateway, DiditService, TwoFactorService, TalkingDrumService],
})
export class UserModule {}