import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { QuotesService } from './quote.service';
import { CreateQuoteDto } from './dto/quote.dto';
import { Public } from '../common/decorators';

@Controller(ApiRoutes.QUOTES)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Public()
  @Post()
  create(@Body() createQuoteDto: CreateQuoteDto) {
    return this.quotesService.create(createQuoteDto);
  }

  @Public()
  @Get('/quote-of-the-day')
  getQuoteOfTheDay() {
    return this.quotesService.getQuoteOfTheDay();
  }
}
