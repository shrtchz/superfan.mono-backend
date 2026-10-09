import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export function extractClientIp(request: any): string {
  if (!request) return '';
  const forwarded = request.headers?.['x-forwarded-for'];
  let ip = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0]?.trim() ||
      request.headers?.['cf-connecting-ip'] ||
      request.headers?.['x-real-ip'] ||
      request.ip ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      '';

  if (typeof ip === 'string') {
    ip = ip.trim();
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
  }
  return ip;
}

export const RealIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return extractClientIp(request);
  },
);