import { HttpModule } from "@nestjs/axios";
import { forwardRef, Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { UserModule } from "../user/user.module";
import { WalletModule } from "../wallet/wallet.module";
import { CronJobModule } from "../cronjobs/cronjob.module";
import { TaskController } from "./tasks.controller";
import { TaskChatGateway } from "./tasks.gateway";
import { TaskService } from "./tasks.service";

@Module({
    imports: [HttpModule, NotificationModule, forwardRef(() => UserModule), WalletModule, CronJobModule],
    controllers: [TaskController],
    providers: [TaskService, TaskChatGateway],
    exports: [TaskService]
})
export class TaskModule {}