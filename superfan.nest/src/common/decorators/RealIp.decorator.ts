// import { createParamDecorator, ExecutionContext } from '@nestjs/common';
// import { Request } from 'express';

// export const RealIp = createParamDecorator(
//   (data: unknown, ctx: ExecutionContext) => {
//     const request = ctx.switchToHttp().getRequest<Request>();
//     // Check for common proxy headers first, fallback to the request.ip property
//     const ip = request.headers['x-forwarded-for'] || request.ip;
//     console.log(ip, '')
//     // X-Forwarded-For can return a list of IPs. The first one is typically the client IP.
//     return Array.isArray(ip) ? ip[0] : ip;
//   },
// );

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const RealIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();

    const forwarded = request.headers['x-forwarded-for'];

    const ip = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0]?.trim() || request.ip;

    return ip;
  },
);