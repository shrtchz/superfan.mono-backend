import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators';
import { ApiRoutes } from '../common/enums/routes.enum';
import { JwtGuard } from '../common/guards';
import { CreateClientHistoryDto, CreatePayoutDto, GetClientHistoryDto, GetTasksQueryDto, TaskDto, TaskMessageDto } from './dto/task.dto';
import { TaskService } from './tasks.service';

@Controller(ApiRoutes.TASK)
@UseGuards(JwtGuard)
export class TaskController {
  constructor(private taskService: TaskService) {}

  @Public()
  @Post('/create-task')
  @HttpCode(HttpStatus.OK)
  async createTask(@Body() dto: TaskDto) {
    return this.taskService.createTask(dto);
  }

  @Post('/send-message')
  async sendMessage(
    @Body()
    dto: TaskMessageDto,
  ) {
    return this.taskService.sendMessage(dto);
  }

  @Public()
  @Get('/:taskId/messages')
  @HttpCode(HttpStatus.OK)
  async fetchMessages(@Param('taskId') taskId: number) {
    return this.taskService.fetchMessages(taskId);
  }

  // ✏️ Edit
  @Patch('/edit-task-message/:id')
  editMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { userId: number; message: string },
  ) {
    return this.taskService.editMessage(
      id,
      body.userId,
      body.message,
    );
  }

  // 🗑 Delete
  @Delete('/delete-task-message/:messageId')
  deleteMessage(
    @Param('messageId') messageId: string,
  ) {
    return this.taskService.deleteMessage(
      messageId,
    );
  }

  @Public()
  @Put('/:id/edit-task')
  @HttpCode(HttpStatus.OK)
  async editTask(@Param('id') id: string, @Body() dto: TaskDto) {
    return this.taskService.updateTask(id, dto);
  }

  @Public()
  @Get('/recent-activities')
  @HttpCode(HttpStatus.OK)
  getRecent() {
    return this.taskService.getRecentActivities();
  }

  @Public()
  @Delete('/activity/activities')
  deleteAllActivities() {
    return this.taskService.deleteAllActivities();
  }

  @Public()
  @Delete('/tasks')
  deleteAllTasks() {
    return this.taskService.deleteAllActivities();
  }

  @Public()
  @Get('/')
  @HttpCode(HttpStatus.OK)
  getAllTasks() {
    return this.taskService.findAllTasks();
  }

    @Post('/create-client-history')
  async createClientHistory(
    @Body()
    dto: CreateClientHistoryDto,
  ) {
    return this.taskService.createClientHistory(dto);
  }

     @Get('/client-history')
  async getClientHistory(
    @Query()
    dto: GetClientHistoryDto,
  ) {
    return this.taskService.getClientHistory(dto);
  }

  @Public()
  @Get(':userId/tasks')
  findTasks(
    @Param('userId') userId: string,
    @Query() query: GetTasksQueryDto,
  ) {
    return this.taskService.findTasksByUserId(+userId, query.status);
  }

     @Post('/create-user-payout')
  async createUserPayouts(
    @Body()
    dto: CreatePayoutDto,
  ) {
    return this.taskService.createUserPayout(dto);
  }

  @Get(':userId/payout/details')
  getPayouts(
    @Param('userId') userId: string,
  ) {
    return this.taskService.getUserPayoutDetail(+userId);
  }

  @Get('/payout/all')
  getAllPayouts() {
    return this.taskService.getAllPayouts();
  }

    @Get('/jobs')
  getJobs() {
    return this.taskService.getCronJobs();
  }

//   @Get('/users/:userId/payouts/export')
// async exportUserPayouts(
//   @Param('userId') userId: number,
//   @Res() res: Response,
//   @Req() req: any,
//   @Query('format') format: 'pdf' | 'csv' = 'pdf',
// ) {
//   // ✅ Authorization check (example)
//   if (!req.user || req.user.role !== 'superadmin') {
//     throw new ForbiddenException('Unauthorized access');
//   }

//   if (format === 'pdf') {
//     return this.taskService.exportPayoutsToPDF(userId, res);
//   }

//   if (format === 'csv') {
//     return this.taskService.exportPayoutsToCSV(userId, res);
//   }

//   throw new BadRequestException('Invalid format');
// }

// @Get('/users/:userId/payouts/export')
// async exportUserPayouts(
//   @Param('userId', ParseIntPipe) userId: number,
//   // @Res() res: Response,
//   @Req() req: any,
//   @Header('Content-Type', 'text/csv'),
// @Header('Content-Disposition', 'attachment; filename=payouts.csv'),
//   @Query('format') format: 'pdf' | 'csv' | 'excel' = 'pdf',
//   @Query('range') range: 'ALL' | 'LAST_MONTH' | 'LAST_QUARTER' | 'LAST_YEAR' | 'CUSTOM' = 'ALL',
//   @Query('startDate') startDate?: string,
//   @Query('endDate') endDate?: string,
// ) {
//   // ✅ Authorization check
//   if (!req.user || req.user.role !== 'superadmin') {
//     throw new ForbiddenException('Unauthorized access');
//   }

//   // ✅ Validate CUSTOM range
//   if (range === 'CUSTOM' && (!startDate || !endDate)) {
//     throw new BadRequestException(
//       'startDate and endDate are required for CUSTOM range',
//     );
//   }

//   // ✅ Normalize format
//   const normalizedFormat = format?.toLowerCase();

//   if (normalizedFormat === 'pdf') {
//     return this.taskService.exportPayoutsToPDF(
//       userId,
//       range,
//       startDate,
//       endDate,
//     );
//   }

//   if (normalizedFormat === 'csv') {
//     return this.taskService.exportPayoutsToCSV(
//       userId,
//       range,
//       startDate,
//       endDate,
//     );
//   }

//   if (normalizedFormat === 'excel') {
//   return this.taskService.exportPayoutsToExcel(
//     userId,
//     // res,
//     range,
//     startDate,
//     endDate,
//   );
// }

//   throw new BadRequestException('Invalid format. Use pdf or csv');
// }

// @Get('/users/:userId/payouts/export')
// async exportUserPayouts(
//   @Param('userId', ParseIntPipe) userId: number,
//   @Req() req: any,
//   @Query('format') format: 'pdf' | 'csv' | 'excel' = 'pdf',
//   @Query('range') range: 'ALL' | 'LAST_MONTH' | 'LAST_QUARTER' | 'LAST_YEAR' | 'CUSTOM' = 'ALL',
//   @Query('startDate') startDate?: string,
//   @Query('endDate') endDate?: string,
// ) {
//   if (!req.user || req.user.role !== 'superadmin') {
//     throw new ForbiddenException('Unauthorized access');
//   }

//   if (range === 'CUSTOM' && (!startDate || !endDate)) {
//     throw new BadRequestException('startDate and endDate are required for CUSTOM range');
//   }

//   const normalizedFormat = format?.toLowerCase();

//   if (normalizedFormat === 'pdf') {
//     return this.taskService.exportPayoutsToPDF(userId, range, startDate, endDate);
//   }

//   if (normalizedFormat === 'csv') {
//     return this.taskService.exportPayoutsToCSV(userId, range, startDate, endDate);
//   }

//   if (normalizedFormat === 'excel') {
//     return this.taskService.exportPayoutsToExcel(userId, range, startDate, endDate);
//   }

//   throw new BadRequestException('Invalid format. Use pdf, csv, or excel');
// }

// @Get('/users/:userId/payouts/export')
// async exportUserPayouts(
//   @Param('userId', ParseIntPipe) userId: number,
//   @Req() req: any,
//   @Res() res: Response,
//   @Query('format') format: 'pdf' | 'csv' | 'excel' = 'pdf',
//   @Query('range') range: 'ALL' | 'LAST_MONTH' | 'LAST_QUARTER' | 'LAST_YEAR' | 'CUSTOM' = 'ALL',
//   @Query('startDate') startDate?: string,
//   @Query('endDate') endDate?: string,
// ) {
//   if (!req.user || req.user.role !== 'superadmin') {
//     throw new ForbiddenException('Unauthorized access');
//   }

//   if (range === 'CUSTOM' && (!startDate || !endDate)) {
//     throw new BadRequestException('startDate and endDate are required for CUSTOM range');
//   }

//   const normalizedFormat = format?.toLowerCase();

//   if (normalizedFormat === 'pdf') {
//     return this.taskService.exportPayoutsToPDF(userId, res, range, startDate, endDate);
//   }

//   if (normalizedFormat === 'csv') {
//     return this.taskService.exportPayoutsToCSV(userId, res, range, startDate, endDate);
//   }

//   if (normalizedFormat === 'excel') {
//     return this.taskService.exportPayoutsToExcel(userId, res, range, startDate, endDate);
//   }

//   throw new BadRequestException('Invalid format. Use pdf, csv, or excel');
// }


@Get('/users/:userId/payouts/export')
async exportUserPayouts(
  @Param('userId', ParseIntPipe) userId: number,
  @Req() req: any,
  @Res({ passthrough: false }) res: Response,
  @Query('format') format: 'pdf' | 'csv' | 'excel' = 'pdf',
  @Query('range')
  range:
    | 'ALL'
    | 'LAST_MONTH'
    | 'LAST_QUARTER'
    | 'LAST_YEAR'
    | 'CUSTOM' = 'ALL',
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
) {
  if (!req.user || req.user.role !== 'superadmin') {
    throw new ForbiddenException('Unauthorized access');
  }

  if (range === 'CUSTOM' && (!startDate || !endDate)) {
    throw new BadRequestException(
      'startDate and endDate are required for CUSTOM range',
    );
  }

  const normalizedFormat = format?.toLowerCase();

  if (normalizedFormat === 'pdf') {
    const pdfBuffer = await this.taskService.exportPayoutsToPDF(
      userId,
      range,
      startDate,
      endDate,
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payouts_${userId}.pdf`,
    );

    res.setHeader('Content-Type', 'application/pdf');

    return res.send(pdfBuffer);
  }

  if (normalizedFormat === 'csv') {
    const csv = await this.taskService.exportPayoutsToCSV(
      userId,
      range,
      startDate,
      endDate,
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payouts_${userId}.csv`,
    );

    res.setHeader('Content-Type', 'text/csv');

    return res.send(csv);
  }

  if (normalizedFormat === 'excel') {
    const excelBuffer = await this.taskService.exportPayoutsToExcel(
      userId,
      range,
      startDate,
      endDate,
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payouts_${userId}.xlsx`,
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    return res.send(excelBuffer);
  }

  throw new BadRequestException(
    'Invalid format. Use pdf, csv, or excel',
  );
}

  @Public()
  @Delete('/activity/:id')
  deleteActivity(@Param('id') id: number) {
    return this.taskService.deleteActivity(id);
  }

  @Public()
  @Delete('/tasks/:id')
  deleteTask(@Param('id') id: number) {
    return this.taskService.deleteTasks(id);
  }
}
