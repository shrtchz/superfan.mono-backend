import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ConfigurePaymentProcessorDto } from './dto/payment-processor.dto';
import { PaymentProcessorService } from './payment-processor.service';

@Public()
@Controller(['api/v1/payment-processors', 'api/v1/payment/processors', 'payment-processors'])
export class PaymentProcessorController {
  constructor(private readonly processorService: PaymentProcessorService) {}

  @Get()
  async getAll() {
    return this.processorService.getAllProcessors();
  }

  @Get('active')
  async getActive() {
    return this.processorService.getActiveProcessor();
  }

  @Patch('cngn/toggle')
  async toggleCngn() {
    return this.processorService.toggleCngn();
  }

  @Patch(':id/toggle')
  async toggle(@Param('id', ParseIntPipe) id: number) {
    return this.processorService.toggleProcessor(id);
  }

  @Post('configure')
  async configureByBody(@Body() dto: ConfigurePaymentProcessorDto) {
    return this.processorService.configureProcessor(dto.name || 'monnify', dto);
  }

  @Post()
  async createOrUpdate(@Body() dto: ConfigurePaymentProcessorDto) {
    return this.processorService.configureProcessor(dto.name || 'monnify', dto);
  }

  @Put(':id')
  async updatePut(
    @Param('id') id: string,
    @Body() dto: ConfigurePaymentProcessorDto,
  ) {
    return this.processorService.configureProcessor(id, dto);
  }

  @Patch(':id')
  async updatePatch(
    @Param('id') id: string,
    @Body() dto: ConfigurePaymentProcessorDto,
  ) {
    return this.processorService.configureProcessor(id, dto);
  }
}
