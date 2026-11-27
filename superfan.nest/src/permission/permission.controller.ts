import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../common/decorators';
import { Role } from '../common/enums/role.enum';
import { Permissions } from '../common/decorators/permission.decorator';
import { ApiRoutes } from '../common/enums/routes.enum';
import { JwtGuard } from '../common/guards/jwt.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RoleGuard } from '../common/guards/roles.guard';
import {
  AssignPermissionsToSubAdminDto,
  GetRolePermissionsDto,
  RemovePermissionsToSubAdminDto,
} from './permission.dto';
import { PermissionService } from './permission.service';

@Controller(ApiRoutes.PERMISSION)
@UseGuards(JwtGuard, PermissionGuard)
export class PermissionController {
  constructor(private permissionService: PermissionService) {}

  @Post('create')
  @Permissions('manage_roles')
  async createPermissions(
    @Body() body: { name: string; description?: string }[],
  ) {
    return this.permissionService.createPermissions(body);
  }

  @Post('assign')
  @Permissions('manage_roles')
  async assignPermissions(
    @Body()
    dto: AssignPermissionsToSubAdminDto,
  ) {
    return this.permissionService.assignPermissionsToSubAdmin(dto);
  }

  @Post('remove')
  @Permissions('manage_roles')
  async removePermissions(
    @Body()
    dto: RemovePermissionsToSubAdminDto,
  ) {
    return this.permissionService.removePermissionsFromSubAdmin(dto);
  }

  @Get('role/:roleName')
  async getRolePermissions(@Param() dto: GetRolePermissionsDto) {
    return this.permissionService.getRolePermissions(dto);
  }

  @Get('/permissions/:userId')
  async getUserPermissions(@Param('userId', ParseIntPipe) userId: number) {
    return this.permissionService.getUserPermissions(userId);
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/')
  async getPermissions() {
    return this.permissionService.getPermissions();
  }
}
