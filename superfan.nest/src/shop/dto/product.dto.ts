import { IsOptional, IsString, IsBoolean, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class GetProductsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class ProductDto {
  id: number;
  title: string;
  price: string;
  priceAmount: number;
  images: string[];
  colors: string[];
  sizes: string[];
  badge?: string | null;
  description?: string | null;
  stock: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
