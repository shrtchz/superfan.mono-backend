import { ConfigModule } from "@nestjs/config";
import { MailModule } from "../mail/mail.module";
import { Module } from "@nestjs/common";
import { QuotesController } from "./quote.controller";
import { QuotesService } from './quote.service';

@Module({
    imports: [ConfigModule, MailModule],
    controllers: [QuotesController],
    providers: [QuotesService]
})

export class QuotesModule {}