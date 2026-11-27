import { Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { Role } from '../common/enums/role.enum';
import { ApiRoutes } from '../common/enums/routes.enum';
import { RoleGuard } from '../common/guards/roles.guard';
import { TaskService } from '../tasks/tasks.service';
import { AnalyticsService } from './analytics.service';

@Controller(ApiRoutes.ANALYTICS)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly taskService: TaskService,
  ) {}

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/total-admins')
  getTotalAdmins() {
    return this.analyticsService.fetchAdminAndInviteStats();
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/total-clients')
  getTotalCleints() {
    return this.analyticsService.fetchTotalClients();
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/admin')
  async getAnalytics() {
    return this.analyticsService.fetchAnalytics();
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/avg-users')
  async getAverageUsers() {
    return this.analyticsService.fetchAverageUsers();
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/location/country')
  fetchUsersByCountry() {
    return this.analyticsService.fetchUsersByCountry();
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/location/state')
  fetchUsersByState() {
    return this.analyticsService.fetchUsersByState();
  }

    @Get('/referrals')
  getReferralAnalytics(@Param('userId') userId: number) {
    return this.analyticsService.getReferralsAnalytics(userId);
  }

  @Get('/wallet-summary/:userId')
  getWalletSummary(@Req() req: any, @Param('userId') userId: number) {
    const isAdmin =
      req.user?.roleName === Role.superadmin ||
      req.user?.roleName === Role.subadmin;
    if (!isAdmin && Number(req.user?.id) !== Number(userId)) {
      throw new ForbiddenException('You can only access your own wallet summary');
    }
    const effectiveUserId = isAdmin ? userId : req.user.id;
    return this.analyticsService.getfullwalletSummaryPerClient(effectiveUserId);
  }

  // 🔥 GET /tasks/pending-count
  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/pending-tasks')
  async getAllPendingTaskCount() {
    return this.taskService.getAllPendingTaskCount();
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Get('/revenue')
  async getRevenueAnalytics() {
    return this.analyticsService.getRevenueAnalytics();
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin)
  @Post('reset')
  async resetRevenue() {
    return this.analyticsService.resetRevenue();
  }
}
