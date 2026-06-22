// import { User } from "../../generated/prisma/client";

import { User } from '@prisma/client'

export type UserWithJwtPayload = User & {
    refreshToken?: string | null;
    role: string;
}