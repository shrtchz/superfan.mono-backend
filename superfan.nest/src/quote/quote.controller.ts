import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { Role } from '../common/enums/role.enum';
import { RoleGuard } from '../common/guards/roles.guard';
import { QuotesService } from './quote.service';
import { CreateQuoteDto } from './dto/quote.dto';
import { Public, Roles } from '../common/decorators';

@Controller(ApiRoutes.QUOTES)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post()
  create(@Body() createQuoteDto: CreateQuoteDto) {
    return this.quotesService.create(createQuoteDto);
  }

  @Get('/quote-of-the-day')
  getQuoteOfTheDay() {
    return this.quotesService.getQuoteOfTheDay();
  }
}
