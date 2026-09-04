import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Public, Roles } from '../common/decorators';
import { Role } from '../common/enums/role.enum';
import { ApiRoutes } from '../common/enums/routes.enum';
import { RoleGuard } from '../common/guards/roles.guard';
import { CreatePodcastDto, UpdatePodcastDto } from './podcast.dto';
import { PodcastService } from './podcast.service';

@Controller(ApiRoutes.PODCAST)
export class PodcastController {
  constructor(private readonly podcasts: PodcastService) {}
  @Public() @Get('published') listPublished() { return this.podcasts.listPublished(); }
  @UseGuards(RoleGuard) @Roles(Role.superadmin, Role.subadmin) @Get() listAdmin() { return this.podcasts.listAdmin(); }
  @UseGuards(RoleGuard) @Roles(Role.superadmin, Role.subadmin) @Post() create(@Body() dto: CreatePodcastDto, @Req() req: any) { return this.podcasts.create(Number(req.user?.id), dto); }
  @UseGuards(RoleGuard) @Roles(Role.superadmin, Role.subadmin) @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePodcastDto) { return this.podcasts.update(id, dto); }
  @UseGuards(RoleGuard) @Roles(Role.superadmin, Role.subadmin) @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.podcasts.remove(id); }
}
