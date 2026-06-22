import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../common/decorators';
import { ApiRoutes } from '../common/enums/routes.enum';

@Controller(ApiRoutes.HEALTH)
export class HealthController {
  constructor(private health: HealthCheckService) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }

  @Get('/debug-sentry')
  getError() {
    throw new Error('My first Sentry error!');
  }
}
