import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { VersusService } from './versus.service';
import {
  AcceptVersusDto,
  CreateVersusDto,
  FundVersusDto,
  SubmitVersusResultDto,
  ToggleReadyDto,
} from './dto/create-versus.dto';

@Controller(ApiRoutes.VERSUS)
export class VersusController {
  constructor(private readonly versusService: VersusService) {}

  @Post('create')
  async createRequest(@Req() req: any, @Body() dto: CreateVersusDto) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.createRequest(userId, dto);
  }

  @Get('active')
  async getActiveRequests(@Req() req: any) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.getActiveRequests(userId);
  }

  @Get('stats/summary')
  async get30DaysSummary(@Req() req: any) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.get30DaysSummary(userId);
  }

  @Get('h2h/:opponentId')
  async getHeadToHeadSummary(
    @Req() req: any,
    @Param('opponentId', ParseIntPipe) opponentId: number,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.getHeadToHeadSummary(userId, opponentId);
  }

  @Get('history')
  async getVersusHistory(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.getPaginatedVersusHistory(
      userId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  private ensureAdmin(req: any) {
    const user = req.user;
    if (!user || !user.id) {
      throw new UnauthorizedException('User not authenticated');
    }
    const role = String(user.roleName || user.role || '').toLowerCase();
    const isAdmin =
      role === 'superadmin' ||
      role === 'admin' ||
      role === 'subadmin' ||
      user.isAdmin === true;
    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return user;
  }

  @Get('admin/ledger')
  async getAdminVersusLedger(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.ensureAdmin(req);
    return this.versusService.getAdminVersusLedger(
      Number(page) || 1,
      Number(limit) || 10,
    );
  }

  @Get('admin/summary')
  async getAdminVersusSummary(@Req() req: any) {
    this.ensureAdmin(req);
    return this.versusService.getAdminVersusSummary();
  }

  @Get('admin/:id/questions/:playerId')
  async getAdminPlayerQuestions(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Param('playerId', ParseIntPipe) playerId: number,
  ) {
    this.ensureAdmin(req);
    return this.versusService.getAdminPlayerQuestions(id, playerId);
  }

  @Get(':id')
  async getSingleRequest(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.getSingleRequest(userId, id);
  }

  @Get(':id/result')
  async getMatchResult(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.getMatchResult(userId, id);
  }

  @Post(':id/submit-result')
  async submitResult(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitVersusResultDto,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.submitResult(userId, id, dto);
  }

  @Post(':id/fund')
  async fundOpponentShare(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FundVersusDto,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.fundOpponentShare(userId, id, dto);
  }

  @Post(':id/start')
  async startRequest(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.startRequest(userId, id);
  }

  @Post(':id/ready')
  async toggleReady(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleReadyDto,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.toggleReady(userId, id, dto);
  }

  @Post(':id/accept')
  async acceptRequest(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptVersusDto,
  ) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.acceptRequest(userId, id, dto);
  }

  @Post(':id/decline')
  async declineRequest(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.declineRequest(userId, id);
  }

  @Post(':id/cancel')
  async cancelRequest(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user?.id);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.versusService.cancelRequest(userId, id);
  }
}
