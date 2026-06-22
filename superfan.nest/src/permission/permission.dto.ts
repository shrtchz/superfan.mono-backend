import { IsArray, IsInt, IsOptional, IsString } from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AssignPermissionsToSubAdminDto {

  @IsInt()
  subAdminId: number;

  @IsArray()
  @IsInt({ each: true })
  permissionIds: number[];
}

export class RemovePermissionsToSubAdminDto {
  @IsInt()
  subAdminId: number;

  @IsArray()
  @IsInt({ each: true })
  permissionIds: number[];
}

export class GetRolePermissionsDto {
  @IsString()
  roleName: string;
}