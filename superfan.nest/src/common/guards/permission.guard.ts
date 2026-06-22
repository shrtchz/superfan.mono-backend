import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';
import { prisma } from '../../prisma/prisma';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (!requiredPermissions) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const roleName = user.roleName;

    // ✅ SUPERADMIN BYPASS
    if (roleName === 'superadmin') {
      return true;
    }

    const role = await prisma.role.findFirst({
      where: { name: roleName },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      throw new ForbiddenException('Role not found');
    }

    const userPermissions = role.permissions.map(
      (rp) => rp.permission.name,
    );

    const hasPermission = requiredPermissions.every((perm) =>
      userPermissions.includes(perm),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    return true;
  }
}