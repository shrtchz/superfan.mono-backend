import { Injectable } from '@nestjs/common';
import { CreateQuoteDto } from './dto/quote.dto';
import { prisma } from '../prisma/prisma';

@Injectable()
export class QuotesService {
  constructor() {}

  async create(createQuoteDto: CreateQuoteDto) {
    let create_quote = await prisma.quote.create({
      data: {
        text: createQuoteDto.text,
      },
    });

    return {
      message: 'Quote successfully added!',
      data: create_quote,
    };
  }

  async getQuoteOfTheDay() {
    const quote = await prisma.quote.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    return quote;
  }
}
