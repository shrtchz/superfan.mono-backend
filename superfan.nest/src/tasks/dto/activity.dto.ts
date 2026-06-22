// import { ActivityType } from "../../generated/prisma/client";

import { ActivityType } from '@prisma/client'



export class CreateActivityDto {
  type: ActivityType;

  actorId?: number;

  actorName: string;

  actorEmail: string;

  metadata?: Record<string, any>;
}