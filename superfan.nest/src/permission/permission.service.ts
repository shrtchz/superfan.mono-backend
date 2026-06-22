import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignPermissionsToSubAdminDto,
  CreatePermissionDto,
  GetRolePermissionsDto,
  RemovePermissionsToSubAdminDto,
} from './permission.dto';
import { prisma } from '../prisma/prisma';

@Injectable()
export class PermissionService {
  constructor() {}

  async createPermissions(dto: CreatePermissionDto[]) {
    return prisma.permission.createMany({
      data: dto,
      skipDuplicates: true, // prevents error if name already exists
    });
  }

  // permission can only be added to SUB-AMIN, whose role is fit to have permission added.
  async assignPermissionsToSubAdmin(dto: AssignPermissionsToSubAdminDto) {
    const { subAdminId, permissionIds } = dto;

    // 🔍 Find SubAdmin using userId
    const subAdmin = await prisma.subAdmin.findUnique({
      where: { userId: subAdminId },
      include: { role: true },
    });

    if (!subAdmin) {
      throw new NotFoundException('SubAdmin not found');
    }

    // 🚫 Prevent assigning to Admin
    if (subAdmin.role?.name?.toLowerCase() === 'admin') {
      throw new BadRequestException('Admin already has all permissions');
    }

    // ✅ Validate permissions
    const permissions = await prisma.permission.findMany({
      where: {
        id: { in: permissionIds },
      },
      select: { id: true },
    });

    if (permissions.length !== permissionIds.length) {
      throw new BadRequestException('One or more permissions are invalid');
    }

    // Get existing permissions
    const existingPermissions = await prisma.subAdminPermission.findMany({
      where: {
        subAdminId: subAdmin.id,
        permissionId: { in: permissionIds },
      },
      select: { permissionId: true },
    });

    const existingIds = new Set(existingPermissions.map((p) => p.permissionId));

    // Filter out duplicates
    const newPermissionIds = permissionIds.filter((id) => !existingIds.has(id));

    // Map only new ones
    const subAdminPermissions = newPermissionIds.map((permissionId) => ({
      subAdminId: subAdmin.id,
      permissionId,
    }));

    await prisma.subAdminPermission.createMany({
      data: subAdminPermissions,
      skipDuplicates: true,
    });

    return {
      message: 'Permissions assigned successfully',
      subAdminId: subAdmin.id,
      assignedPermissions: permissionIds,
    };
  }

  async removePermissionsFromSubAdmin(dto: RemovePermissionsToSubAdminDto) {
    const { subAdminId, permissionIds } = dto;

    // 🔍 Find SubAdmin
    const subAdmin = await prisma.subAdmin.findUnique({
      where: { userId: subAdminId },
      include: { role: true },
    });

    if (!subAdmin) {
      throw new NotFoundException('SubAdmin not found');
    }

    // 🚫 Prevent removing from Admin
    if (subAdmin.role?.name?.toLowerCase() === 'admin') {
      throw new BadRequestException('Admin permissions cannot be modified');
    }

    // 🗑 Remove only specified permissions
    await prisma.subAdminPermission.deleteMany({
      where: {
        subAdminId: subAdmin.id, // ✅ correct FK
        permissionId: { in: permissionIds },
      },
    });

    return {
      message: 'Permissions removed successfully',
      subAdminId: subAdmin.id,
      removedPermissions: permissionIds,
    };
  }

  async getUserPermissions(userId: number) {
    try {
      const subAdmin = await prisma.subAdmin.findUnique({
        where: {
          userId: Number(userId),
        },
        include: {
          subAdminPermissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      if (!subAdmin) {
        return [];
      }

      // Extract permissions
      const permissions = subAdmin.subAdminPermissions.map(
        (sp) => sp.permission,
      );

      return permissions;
    } catch (error) {
      throw new Error(`Failed to fetch user permissions: ${error}`);
    }
  }

  async getRolePermissions(dto: GetRolePermissionsDto) {
    const role = await prisma.role.findFirst({
      where: { name: dto.roleName },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role.permissions.map((p) => p.permission.name);
  }

  async getPermissions() {
    try {
      const permissions = await prisma.permission.findMany();

      return {
        message: 'Permissions fetched successfully',
        data: permissions,
      };
    } catch (error) {
      throw error;
    }
  }
}
