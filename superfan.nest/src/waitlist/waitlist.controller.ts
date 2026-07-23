import { Body, Controller, Post } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { WaitlistService } from './waitlist.service';
import { JoinWaitlistDto } from './dto/waitlist.dto';
import { Public } from '../common/decorators';

@Controller(ApiRoutes.WAITLIST)
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Public()
  @Post()
  joinWaitlist(@Body() dto: JoinWaitlistDto) {
    return this.waitlistService.joinWaitlist(dto);
  }
}
