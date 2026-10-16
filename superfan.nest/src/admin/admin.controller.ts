import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsNumber } from 'class-validator';
import { Public } from '../common/decorators';
import { ApiRoutes } from '../common/enums/routes.enum';
import { JwtGuard } from '../common/guards';
import { PermissionGuard } from '../common/guards/permission.guard';
import { SubAdminDto } from '../user/dto/auth.dto';
import { AdminService } from './admin.service';

// DTO for the new invite-admin endpoint
class InviteAdminDto {
  @IsEmail()
  email: string;

  /** "owner" | "full" | "restricted" */
  @IsIn(['owner', 'full', 'restricted'])
  accessLevel: 'owner' | 'full' | 'restricted';

  /** Only relevant when accessLevel === "full" */
  @IsOptional()
  @IsBoolean()
  allowManageAdmins?: boolean;

  /** Required when accessLevel === "restricted"; ignored otherwise */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  permissionIds?: number[];
}

@Controller(ApiRoutes.ADMIN)
@UseGuards(JwtGuard, PermissionGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  /**
   * POST /api/v1/admin/invite-admin
   *
   * Primary invite endpoint supporting all three access levels:
   *   - "owner"      → Owner / Super Admin (full control + manage all admins)
   *   - "full"       → Full Admin Access (all features, with optional allowManageAdmins)
   *   - "restricted" → Restricted Admin Access (permissionIds list required)
   */
  @Post('/invite-admin')
  @HttpCode(HttpStatus.OK)
  async inviteAdmin(
    @Body() body: InviteAdminDto,
    @Req() req: any,
  ): Promise<{ message: string; data?: { id: number } }> {
    return this.adminService.inviteAdmin(
      body.email,
      req.user.id,
      req.user.username,
      body.accessLevel,
      body.allowManageAdmins ?? false,
      body.permissionIds ?? [],
    );
  }

  /**
   * POST /api/v1/admin/subadmin-invite  (legacy alias)
   * Kept for backwards compatibility with older frontend builds.
   */
  @Post('/subadmin-invite')
  @HttpCode(HttpStatus.OK)
  async inviteSubAdmin(
    @Body()
    body: { email: string; permissionIds?: number[]; adminType: string },
    @Req() req: any,
  ): Promise<{ message: string }> {
    return this.adminService.inviteSubAdmin(
      body.email,
      req.user.id,
      req.user.username,
      body.permissionIds ?? [],
      body.adminType,
    );
  }

  @Public()
  @Post('/resend-subadmin-invite')
  @HttpCode(HttpStatus.OK)
  async resendSubAdminInvite(
    @Body() email: { email: string },
  ): Promise<{ message: string }> {
    return this.adminService.resendSubAdminInvite(email.email);
  }

  @Public()
  @Post('/subadmin-signup')
  @HttpCode(HttpStatus.OK)
  async subAdminSignup(@Body() dto: SubAdminDto): Promise<{ message: string }> {
    return this.adminService.acceptInvitedSubAdmin(dto);
  }

  @Public()
  @Delete('/delete/:adminId')
  async deleteAdmin(@Param('adminId') adminId: number) {
    return this.adminService.deleteAdmin(adminId);
  }

  @Public()
  @Get('/invites')
  async fetchSubAdminInvite() {
    return this.adminService.fetchSubAdminInvites();
  }

  /**
   * DELETE /api/v1/admin/cancel-invite/:inviteId
   * Cancel (revoke) a pending invite. Also aliased at /revoke-invite/:inviteId.
   */
  @Public()
  @Delete('/cancel-invite/:inviteId')
  async cancelInvite(
    @Param('inviteId', ParseIntPipe) inviteId: number,
  ) {
    return this.adminService.deleteSubAdminInvite(inviteId);
  }

  @Public()
  @Delete('/revoke-invite/:inviteId')
  async deleteSubAdminInvite(
    @Param('inviteId', ParseIntPipe) inviteId: number,
  ) {
    return this.adminService.deleteSubAdminInvite(inviteId);
  }

  @Public()
  @Get('/invite')
  async getSubAdminByInvitetoken(
    @Query('token') token: string,
  ) {
    return this.adminService.getSubAdminInviteByToken(token);
  }

  @Public()
  @Get('/stats')
  async getAdminStat() {
    return this.adminService.getAdminStats();
  }

  @Public()
  @Get('/dashboard/admin-count')
  @HttpCode(HttpStatus.OK)
  async getAdminCount() {
    return this.adminService.getAdminCount();
  }

  @Public()
  @Get('/dashboard/client-count')
  @HttpCode(HttpStatus.OK)
  async getClientCount() {
    return this.adminService.getClientCount();
  }

  @Public()
  @Get('/dashboard/invite-count')
  @HttpCode(HttpStatus.OK)
  async getInviteCount() {
    return this.adminService.getPendingInviteCount();
  }

  @Public()
  @Get('/dashboard/pending-invites-count')
  @HttpCode(HttpStatus.OK)
  async getPendingInvitesCount() {
    return this.adminService.getPendingInviteCount();
  }

  /**
   * GET /api/v1/admin/list-admins
   * Lists all admins with optional status filter (active/inactive) and live status counts.
   */
  @Public()
  @Get('/list-admins')
  @HttpCode(HttpStatus.OK)
  async listAdmins(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
    @Query('status') status?: string,
  ) {
    return this.adminService.listAdmins({
      page: Number(page) || 1,
      perPage: Number(perPage) || 10,
      status,
    });
  }

  @Public()
  @Get('/subadmins')
  @HttpCode(HttpStatus.OK)
  async getSubadmins(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
    @Query('status') status?: string,
  ) {
    return this.adminService.listAdmins({
      page: Number(page) || 1,
      perPage: Number(perPage) || 10,
      status,
    });
  }

  /**
   * GET /api/v1/admin/list-clients
   * Lists all clients with all columns, pagination (page, perPage), and status/plan/search filters.
   */
  @Public()
  @Get('/list-clients')
  @HttpCode(HttpStatus.OK)
  async listClients(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listClients({
      page: Number(page) || 1,
      perPage: Number(perPage) || 10,
      status,
      plan,
      search,
    });
  }

  @Public()
  @Get('/clients')
  @HttpCode(HttpStatus.OK)
  async getClients(
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listClients({
      page: Number(page) || 1,
      perPage: Number(perPage) || 10,
      status,
      plan,
      search,
    });
  }

  @Public()
  @Get('/:roleName')
  async getAdmins(@Param('roleName') roleName: string) {
    return this.adminService.getAdminsbyRole(roleName);
  }

  @Get(':id/permissions')
  getSubAdminPermissions(@Param('id') id: number) {
    return this.adminService.getSubAdminWithPermissions(Number(id));
  }

  @Public()
  @Post('/demote/:adminId')
  async demoteAdmin(@Param('adminId') adminId: number) {
    return this.adminService.demoteSubAdminToClient(adminId);
  }
}
