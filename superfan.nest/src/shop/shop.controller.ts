import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { ShopService } from './shop.service';
import {
  GetProductsQueryDto,
  CreateProductDto,
  UpdateProductDto,
} from './dto/product.dto';
import { CreateOrderDto, CreateReturnDto } from './dto/order.dto';
import { Public } from '../common/decorators';

@Controller(ApiRoutes.SHOP)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Public()
  @Get('products')
  getProducts(@Query() query: GetProductsQueryDto) {
    return this.shopService.getProducts(query);
  }

  @Public()
  @Get('products/:id')
  getProductById(@Param('id', ParseIntPipe) id: number) {
    return this.shopService.getProductById(id);
  }

  @Public()
  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.shopService.createProduct(dto);
  }

  @Public()
  @Patch('products/:id')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.shopService.updateProduct(id, dto);
  }

  @Public()
  @Delete('products/:id')
  deleteProduct(@Param('id', ParseIntPipe) id: number) {
    return this.shopService.deleteProduct(id);
  }

  @Post('orders')
  createOrder(@Req() req: any, @Body() dto: CreateOrderDto) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.shopService.createOrder(userId, dto);
  }

  @Get('orders')
  getUserOrders(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.shopService.getUserOrders(userId, page, limit);
  }

  @Get('orders/:id')
  getOrderById(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.shopService.getOrderById(userId, id);
  }

  @Post('returns')
  createReturn(@Req() req: any, @Body() dto: CreateReturnDto) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.shopService.createReturn(userId, dto);
  }

  @Get('returns')
  getUserReturns(@Req() req: any) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.shopService.getUserReturns(userId);
  }
}
