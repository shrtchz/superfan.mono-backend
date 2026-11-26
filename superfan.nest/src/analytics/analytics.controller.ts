import { Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/decorators';
import { ApiRoutes } from '../common/enums/routes.enum';
import { TaskService } from '../tasks/tasks.service';
import { AnalyticsService } from './analytics.service';

@Controller(ApiRoutes.ANALYTICS)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly taskService: TaskService,
  ) {}

  @Get('/total-admins')
  getTotalAdmins() {
    return this.analyticsService.fetchAdminAndInviteStats();
  }

  @Get('/total-clients')
  getTotalCleints() {
    return this.analyticsService.fetchTotalClients();
  }

  @Get('/admin')
  async getAnalytics() {
    return this.analyticsService.fetchAnalytics();
  }

  @Get('/avg-users')
  async getAverageUsers() {
    return this.analyticsService.fetchAverageUsers();
  }

  @Get('/location/country')
  fetchUsersByCountry() {
    return this.analyticsService.fetchUsersByCountry();
  }

  @Get('/location/state')
  fetchUsersByState() {
    return this.analyticsService.fetchUsersByState();
  }

    @Get('/referrals')
  getReferralAnalytics(@Param('userId') userId: number) {
    return this.analyticsService.getReferralsAnalytics(userId);
  }

      @Get('/wallet-summary/:userId')
  getWalletSummary(@Param('userId') userId: number) {
    return this.analyticsService.getfullwalletSummaryPerClient(userId);
  }

  // 🔥 GET /tasks/pending-count
  @Get('/pending-tasks')
  async getAllPendingTaskCount() {
    return this.taskService.getAllPendingTaskCount();
  }

  @Get('/revenue')
  async getRevenueAnalytics() {
    return this.analyticsService.getRevenueAnalytics();
  }

  @Post('reset')
  async resetRevenue() {
    return this.analyticsService.resetRevenue();
  }
}
