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
import { Public } from '../common/decorators';
import { ApiRoutes } from '../common/enums/routes.enum';
import { JwtGuard } from '../common/guards';
import { PermissionGuard } from '../common/guards/permission.guard';
import { SubAdminDto } from '../user/dto/auth.dto';
import { AdminService } from './admin.service';

@Controller(ApiRoutes.ADMIN)
@UseGuards(JwtGuard, PermissionGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

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
  };

  @Public()
  @Post('/resend-subadmin-invite')
  @HttpCode(HttpStatus.OK)
  async resendSubAdminInvite(
    @Body() email: { email: string },
  ): Promise<{ message: string }> {
    return this.adminService.resendSubAdminInvite(email.email);
  };

  @Public()
  @Post('/subadmin-signup')
  @HttpCode(HttpStatus.OK)
  async subAdminSignup(@Body() dto: SubAdminDto): Promise<{ message: string }> {
    return this.adminService.acceptInvitedSubAdmin(dto);
  };

  
  @Public()
  @Delete('/delete/:adminId')
  async deleteAdmin(@Param('adminId') adminId: number) {
    return this.adminService.deleteAdmin(adminId);
  };

  @Public()
  @Get('/invites')
  async fetchSubAdminInvite() {
    return this.adminService.fetchSubAdminInvites();
  };

  @Public()
  @Delete('/revoke-invite/:inviteId')
  async deleteSubAdminInvite(
    @Param('inviteId', ParseIntPipe) inviteId: number,
  ) {
    return this.adminService.deleteSubAdminInvite(inviteId);
  };

  @Public()
  @Get('/invite')
  async getSubAdminByInvitetoken(
    @Query('token') token: string,
  ) {
    return this.adminService.getSubAdminInviteByToken(token);
  };

  @Public()
  @Get('/stats')
  async getAdminStat() {
    return this.adminService.getAdminStats();
  };

  @Public()
  @Get('/:roleName')
  async getAdmins(@Param('roleName') roleName: string) {
    return this.adminService.getAdminsbyRole(roleName);
  };


  @Get(':id/permissions')
  getSubAdminPermissions(@Param('id') id: number) {
    return this.adminService.getSubAdminWithPermissions(Number(id));
  };

  @Public()
  @Post('/demote/:adminId')
  async demoteAdmin(@Param('adminId') adminId: number) {
    return this.adminService.demoteSubAdminToClient(adminId);
  };
}
