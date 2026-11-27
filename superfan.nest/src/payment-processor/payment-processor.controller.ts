import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../common/decorators';
import { Role } from '../common/enums/role.enum';
import { JwtGuard } from '../common/guards';
import { RoleGuard } from '../common/guards/roles.guard';
import { ConfigurePaymentProcessorDto } from './dto/payment-processor.dto';
import { PaymentProcessorService } from './payment-processor.service';

@UseGuards(JwtGuard, RoleGuard)
@Roles(Role.superadmin, Role.subadmin)
@Controller(['api/v1/payment-processors', 'api/v1/payment/processors', 'payment-processors'])
export class PaymentProcessorController {
  constructor(private readonly processorService: PaymentProcessorService) {}

  @Get()
  async getAll() {
    return this.processorService.getAllProcessors();
  }

  @Get('active')
  async getActive(@Query('channel') channel?: string) {
    return this.processorService.getActiveProcessor(channel);
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
