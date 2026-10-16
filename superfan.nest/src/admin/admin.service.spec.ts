import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { MailService } from '../mail/mail.service';
import { TaskService } from '../tasks/tasks.service';
import { prisma } from '../prisma/prisma';

// Mock dependencies
jest.mock('../prisma/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    permission: {
      findMany: jest.fn(),
    },
    subAdminInvite: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    subAdminPermission: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    admin: {
      create: jest.fn(),
    },
    subAdmin: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

describe('AdminService - inviteAdmin & access levels', () => {
  let service: AdminService;
  let mailService: Partial<MailService>;
  let configService: Partial<ConfigService>;
  let taskService: Partial<TaskService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mailService = {
      subAdminInvitationEmail: jest.fn().mockResolvedValue(true),
    };
    configService = {
      get: jest.fn().mockReturnValue('http://localhost:9050'),
    };
    taskService = {
      subadminRegistered: jest.fn().mockResolvedValue(true),
    };

    service = new AdminService(
      mailService as MailService,
      configService as ConfigService,
      taskService as TaskService,
    );
  });

  describe('1. Owner / Super Admin Access Level', () => {
    it('should create invite with stored adminType "superadmin" and all permissions including manage-admins', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.permission.findMany as jest.Mock).mockResolvedValue([
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
        { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 },
        { id: 13 }, { id: 14 },
      ]);
      (prisma.subAdminInvite.create as jest.Mock).mockResolvedValue({ id: 101 });
      (prisma.subAdminPermission.createMany as jest.Mock).mockResolvedValue({ count: 12 });

      const result = await service.inviteAdmin(
        'owner@example.com',
        1,
        'odofin',
        'owner',
        false,
        [],
      );

      expect(prisma.subAdminInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'owner@example.com',
          adminType: 'superadmin',
          invitedById: 1,
        }),
      });

      // Must attach all 12 permissions (including 10 = manage admins)
      expect(prisma.subAdminPermission.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ permissionId: 10 }),
          expect.objectContaining({ permissionId: 1 }),
        ]),
        skipDuplicates: true,
      });

      expect(mailService.subAdminInvitationEmail).toHaveBeenCalledWith(
        'owner@example.com',
        'odofin',
        expect.stringContaining('http://localhost:9050/admin-invitation?token='),
        'Owner / Super Admin',
        7,
        expect.any(Date),
      );

      expect(result.message).toContain('Owner / Super Admin');
    });
  });

  describe('2. Full Admin Access Level', () => {
    it('should include manage-admins (ID: 10) when allowManageAdmins is true', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.permission.findMany as jest.Mock).mockResolvedValue([
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
        { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 },
        { id: 13 }, { id: 14 },
      ]);
      (prisma.subAdminInvite.create as jest.Mock).mockResolvedValue({ id: 102 });

      await service.inviteAdmin(
        'full_admin@example.com',
        1,
        'odofin',
        'full',
        true, // allowManageAdmins
        [],
      );

      expect(prisma.subAdminInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'full_admin@example.com',
          adminType: 'subadmin',
        }),
      });

      expect(prisma.subAdminPermission.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ permissionId: 10 }),
        ]),
        skipDuplicates: true,
      });
    });

    it('should exclude manage-admins (ID: 10) when allowManageAdmins is false', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.permission.findMany as jest.Mock).mockResolvedValue([
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
        { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 13 }, { id: 14 },
      ]);
      (prisma.subAdminInvite.create as jest.Mock).mockResolvedValue({ id: 103 });

      await service.inviteAdmin(
        'full_no_manage@example.com',
        1,
        'odofin',
        'full',
        false, // allowManageAdmins = false
        [],
      );

      const passedData = (prisma.subAdminPermission.createMany as jest.Mock).mock.calls[0][0].data;
      const ids = passedData.map((d: any) => d.permissionId);
      expect(ids).not.toContain(10);
    });
  });

  describe('3. Restricted Admin Access Level', () => {
    it('should throw BadRequestException when no permission IDs are provided', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.inviteAdmin(
          'restricted@example.com',
          1,
          'odofin',
          'restricted',
          false,
          [],
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should only attach the specified feature permissions', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.permission.findMany as jest.Mock).mockResolvedValue([
        { id: 2 }, { id: 3 },
      ]);
      (prisma.subAdminInvite.create as jest.Mock).mockResolvedValue({ id: 104 });

      await service.inviteAdmin(
        'restricted@example.com',
        1,
        'odofin',
        'restricted',
        false,
        [2, 3],
      );

      const passedData = (prisma.subAdminPermission.createMany as jest.Mock).mock.calls[0][0].data;
      const ids = passedData.map((d: any) => d.permissionId);
      expect(ids).toEqual([2, 3]);
    });
  });

  describe('4. Cancel Pending Invite', () => {
    it('should delete the invite record by ID', async () => {
      (prisma.subAdminInvite.findUnique as jest.Mock).mockResolvedValue({ id: 101 });
      (prisma.subAdminInvite.delete as jest.Mock).mockResolvedValue({ id: 101 });

      const res = await service.deleteSubAdminInvite(101);
      expect(prisma.subAdminInvite.delete).toHaveBeenCalledWith({ where: { id: 101 } });
      expect(res.message).toContain('cancelled successfully');
    });

    it('should throw NotFoundException if invite does not exist', async () => {
      (prisma.subAdminInvite.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteSubAdminInvite(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('5. Fetch Invite by Token', () => {
    it('should return human-readable accessLevel and permissions list', async () => {
      (prisma.subAdminInvite.findFirst as jest.Mock).mockResolvedValue({
        id: 101,
        email: 'recipient@example.com',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 100000),
        adminType: 'superadmin',
        subAdminPermissions: [
          { permission: { id: 1, name: 'client' } },
          { permission: { id: 10, name: 'admins' } },
        ],
        invitedBy: { username: 'odofin' },
      });

      const res = await service.getSubAdminInviteByToken('valid-token');
      expect(res.data.accessLevel).toBe('Owner / Super Admin');
      expect(res.data.permissions).toHaveLength(2);
      expect(res.data.inviter).toBe('odofin');
    });

    it('should reject expired tokens', async () => {
      (prisma.subAdminInvite.findFirst as jest.Mock).mockResolvedValue({
        id: 101,
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 100000),
      });

      await expect(service.getSubAdminInviteByToken('expired-token')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('6. List Admins with Status Filter & Live Counts', () => {
    it('should return paginated admins, filter by status, and include live active/inactive counts', async () => {
      const mockAdmins = [
        { id: 1, username: 'admin1', roleName: 'superadmin', active: true },
        { id: 2, username: 'admin2', roleName: 'subadmin', active: true },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValue([
        mockAdmins, // users
        2,          // total
        5,          // activeCount
        3,          // inactiveCount
      ]);

      (prisma.subAdmin.findMany as jest.Mock).mockResolvedValue([
        { id: 10, userId: 2 },
      ]);

      (prisma.subAdminPermission.findMany as jest.Mock).mockResolvedValue([
        { subAdminId: 10, permission: { id: 1, name: 'client' } },
      ]);

      const res = await service.listAdmins({
        page: 1,
        perPage: 10,
        status: 'active',
      });

      expect(res.data).toHaveLength(2);
      expect(res.meta.total).toBe(2);
      expect(res.counts).toEqual({
        active: 5,
        inactive: 3,
        total: 8,
      });
      expect(res.statusCounts).toEqual({
        active: 5,
        inactive: 3,
      });
    });

    it('should filter inactive admins when status=inactive is passed', async () => {
      (prisma.$transaction as jest.Mock).mockResolvedValue([
        [{ id: 3, username: 'inactive_admin', roleName: 'subadmin', active: false }],
        1,
        5,
        3,
      ]);
      (prisma.subAdmin.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.subAdminPermission.findMany as jest.Mock).mockResolvedValue([]);

      const res = await service.listAdmins({
        page: 1,
        perPage: 10,
        status: 'inactive',
      });

      expect(res.data[0].active).toBe(false);
      expect(res.counts.active).toBe(5);
      expect(res.counts.inactive).toBe(3);
    });
  });
});
