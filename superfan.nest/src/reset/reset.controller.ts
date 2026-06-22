import { Controller, Delete, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { JwtGuard } from '../common/guards';
import { ResetService } from './reset.service';
import { Public } from '../common/decorators';

@Controller(ApiRoutes.WIPE)
@UseGuards(JwtGuard)
export class ResetController {
  constructor(private readonly resetService: ResetService) {}

  /**
   * DELETE /admin/reset/deallocate-and-wipe
   *
   * 1. Finds all users with a non-null accountReference.
   * 2. Deallocates each reserved Monnify account.
   * 3. Runs `prisma migrate reset --force` to wipe all tables.
   *
   * Restricted to ADMIN role only.
   */
  @Public()
  @Delete('deallocate-and-wipe')
//   @Roles(Role.superadmin)
  @HttpCode(HttpStatus.OK)
  async deallocateAndWipe() {
    return this.resetService.deallocateAndWipe();
  }
}