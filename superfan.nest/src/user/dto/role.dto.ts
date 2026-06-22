import { IsArray, IsString, ArrayNotEmpty, IsOptional, IsNumber } from "class-validator";

export class CreateRoleDto {
  @IsString()
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  permissionIds: number[];
}


export class UpdateRoleDto {
  @IsOptional()
  name?: string;

  @IsOptional()
  @IsArray()
  permissionIds?: number[];
}

export class AssignRoleDto {
  @IsNumber()
  userId: number;

  @IsNumber()
  roleId: number;
}