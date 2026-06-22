import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { FlutterwaveModule } from '@scwar/nestjs-flutterwave';
import { MailModule } from "../mail/mail.module";
import { TaskModule } from "../tasks/tasks.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
    imports: [ConfigModule, MailModule, HttpModule, FlutterwaveModule, TaskModule],
    controllers: [AdminController],
    providers: [AdminService]
})
export class AdminModule {}