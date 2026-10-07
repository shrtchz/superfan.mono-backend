import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { failureResponse } from '../common/interceptors/response.interceptor';
import { MailService } from '../mail/mail.service';
import { prisma } from '../prisma/prisma';
import { TaskService } from "../tasks/tasks.service";
import { SubAdminDto } from '../user/dto/auth.dto';

// ─── Canonical permission sets ──────────────────────────────────────────────

/** All feature / content permission IDs (excludes "admins" ID 10) */
const ALL_FEATURE_PERMISSION_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14];
/** "Manage admins" permission ID */
const MANAGE_ADMINS_PERMISSION_ID = 10;
/** Full set: every feature + manage-admins */
const ALL_PERMISSION_IDS_WITH_ADMINS = [
  ...ALL_FEATURE_PERMISSION_IDS,
  MANAGE_ADMINS_PERMISSION_ID,
];

type AccessLevel = 'owner' | 'full' | 'restricted';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the final permissionIds array from the incoming access-level payload.
 *
 * | accessLevel  | allowManageAdmins | result                                    |
 * |--------------|-------------------|-------------------------------------------|
 * | "owner"      | (ignored)         | all feature IDs + manage-admins ID        |
 * | "full"       | true              | all feature IDs + manage-admins ID        |
 * | "full"       | false             | all feature IDs only                      |
 * | "restricted" | (ignored)         | caller-supplied permissionIds (validated) |
 */
function resolvePermissions(
  accessLevel: AccessLevel,
  allowManageAdmins: boolean,
  restrictedIds: number[],
): number[] {
  if (accessLevel === 'owner') {
    return ALL_PERMISSION_IDS_WITH_ADMINS;
  }
  if (accessLevel === 'full') {
    return allowManageAdmins
      ? ALL_PERMISSION_IDS_WITH_ADMINS
      : ALL_FEATURE_PERMISSION_IDS;
  }
  // restricted
  return [...new Set(restrictedIds)];
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AdminService {
  constructor(
    private mail: MailService,
    private configService: ConfigService,
    private taskService: TaskService,
  ) {}

  /**
   * POST /api/v1/admin/invite-admin
   *
   * Invite a new admin at one of three access levels:
   *   - "owner"      → stored adminType "superadmin"; receives ALL permissions
   *   - "full"       → stored adminType "subadmin"; receives all feature perms
   *                    (+ manage-admins if allowManageAdmins is true)
   *   - "restricted" → stored adminType "subadmin"; receives only the listed perms
   */
  async inviteAdmin(
    email: string,
    inviterId: number,
    inviterUsername: string,
    accessLevel: AccessLevel,
    allowManageAdmins: boolean,
    permissionIds: number[],
  ): Promise<any> {
    try {
      // ── Guard: email must not already belong to an active user ────────────
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new ForbiddenException('A user with this email already exists');
      }

      // ── Guard: restricted access must specify at least one feature ────────
      if (accessLevel === 'restricted' && permissionIds.length === 0) {
        throw new BadRequestException(
          'At least one permission must be selected for Restricted Admin Access',
        );
      }

      // ── Resolve final permission set ──────────────────────────────────────
      const resolvedIds = resolvePermissions(
        accessLevel,
        allowManageAdmins,
        permissionIds,
      );

      // Validate that all requested IDs actually exist in the DB
      const validPermissions = await prisma.permission.findMany({
        where: { id: { in: resolvedIds } },
        select: { id: true },
      });
      const validIds = validPermissions.map((p) => p.id);

      if (validIds.length === 0) {
        throw new BadRequestException('None of the provided permission IDs are valid');
      }

      // ── Determine stored adminType ────────────────────────────────────────
      const storedAdminType = accessLevel === 'owner' ? 'superadmin' : 'subadmin';

      // ── Generate token + expiry (7 days) ─────────────────────────────────
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // ── Persist invite ────────────────────────────────────────────────────
      const invite = await prisma.subAdminInvite.create({
        data: {
          email,
          token,
          expiresAt,
          adminType: storedAdminType,
          invitedById: inviterId,
        },
      });

      // Attach permissions to the invite record (for all access levels)
      await prisma.subAdminPermission.createMany({
        data: validIds.map((permissionId) => ({
          inviteId: invite.id,
          permissionId,
          subAdminId: null,
        })),
        skipDuplicates: true,
      });

      // ── Send invitation email ─────────────────────────────────────────────
      const inviteLink = `${this.configService.get<string>('ADMIN_FRONTEND_URL')}/admin-invitation?token=${token}`;

      const emailRoleLabel =
        accessLevel === 'owner'
          ? 'Owner / Super Admin'
          : accessLevel === 'full'
            ? 'Full Admin'
            : 'Restricted Admin';

      await this.mail.subAdminInvitationEmail(
        email,
        inviterUsername,
        inviteLink,
        emailRoleLabel,
        7,
        expiresAt,
      );

      return {
        message: `${emailRoleLabel} invitation sent successfully`,
        data: { id: invite.id },
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  /**
   * POST /api/v1/admin/subadmin-invite  (legacy alias)
   *
   * Kept for backwards-compatibility with existing frontend calls.
   * Maps the old { adminType, permissionIds } shape onto inviteAdmin().
   */
  async inviteSubAdmin(
    email: string,
    inviterId: number,
    inviterUsername: string,
    permissionIds: number[] = [],
    adminType: string,
  ): Promise<any> {
    const accessLevel: AccessLevel =
      adminType === 'superadmin' ? 'owner' : 'restricted';
    const allowManageAdmins = permissionIds.includes(MANAGE_ADMINS_PERMISSION_ID);
    const featureIds = permissionIds.filter(
      (id) => id !== MANAGE_ADMINS_PERMISSION_ID,
    );

    return this.inviteAdmin(
      email,
      inviterId,
      inviterUsername,
      accessLevel === 'owner' ? 'owner' : featureIds.length >= ALL_FEATURE_PERMISSION_IDS.length ? 'full' : 'restricted',
      allowManageAdmins,
      featureIds.length > 0 ? permissionIds : [],
    );
  }

  async resendSubAdminInvite(email: string): Promise<any> {
    try {
      // fetch existing invite with permissions
      const invite = await prisma.subAdminInvite.findFirst({
        where: { email },
        include: {
          subAdminPermissions: {
            include: { permission: true },
          },
        },
      });

      if (!invite) {
        throw new NotFoundException('No invitation found for this email');
      }

      // fetch the original inviter (not the invitee)
      const inviter = await prisma.user.findUnique({
        where: { id: invite.invitedById },
        select: { username: true },
      });

      if (!inviter) {
        throw new NotFoundException('Inviter account no longer exists');
      }

      const adminType = invite.adminType || 'subadmin';

      // generate a fresh token and reset expiry
      const newToken = uuidv4();
      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.subAdminInvite.update({
        where: { id: invite.id },
        data: {
          token: newToken,
          expiresAt: newExpiry,
        },
      });

      const inviteLink = `${this.configService.get<string>('ADMIN_FRONTEND_URL')}/admin-invitation?token=${newToken}`;

      const emailRoleLabel =
        adminType === 'superadmin' ? 'Owner / Super Admin' : 'Admin';

      await this.mail.subAdminInvitationEmail(
        email,
        inviter.username,
        inviteLink,
        emailRoleLabel,
        7,
        newExpiry,
      );

      return {
        message: `${emailRoleLabel} invitation resent successfully`,
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async getSubAdminInviteByToken(token: string): Promise<any> {
    try {
      if (!token) {
        throw new BadRequestException('Token is required');
      }

      const invite = await prisma.subAdminInvite.findFirst({
        where: { token },
        include: {
          subAdminPermissions: {
            include: { permission: true },
          },
          invitedBy: {
            select: { username: true },
          },
        },
      });

      if (!invite) {
        throw new NotFoundException('Invalid invitation token');
      }

      if (invite.expiresAt < new Date()) {
        throw new ForbiddenException('Invitation token has expired');
      }

      const adminType = invite.adminType || 'subadmin';
      const permCount = invite.subAdminPermissions.length;
      const hasManageAdmins = invite.subAdminPermissions.some(
        (p) => p.permission.name === 'admins',
      );

      // Derive a human-readable access level for the accept page
      let accessLevel: string;
      if (adminType === 'superadmin') {
        accessLevel = 'Owner / Super Admin';
      } else if (permCount >= ALL_FEATURE_PERMISSION_IDS.length) {
        accessLevel = hasManageAdmins ? 'Full Admin (+ Manage Admins)' : 'Full Admin';
      } else {
        accessLevel = 'Restricted Admin';
      }

      return {
        message: 'Invite fetched successfully',
        data: {
          id: invite.id,
          email: invite.email,
          token: invite.token,
          expiresAt: invite.expiresAt,
          adminType,
          accessLevel,
          permissions: invite.subAdminPermissions.map((p) => p.permission),
          inviter: invite.invitedBy?.username || null,
        },
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  // fetch all sub-admin invites.
  async fetchSubAdminInvites(): Promise<any> {
    try {
      const invites = await prisma.subAdminInvite.findMany({
        where: {
          expiresAt: {
            gt: new Date(), // only invites that have not expired
          },
        },
        include: {
          subAdminPermissions: {
            include: {
              permission: true, // fetch actual permission details
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        message: 'invites fetched successfully',
        data: invites,
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  // delete sub-admin invite (cancel a pending invite)
  async deleteSubAdminInvite(id: number): Promise<any> {
    try {
      const invite = await prisma.subAdminInvite.findUnique({
        where: { id },
      });

      if (!invite) {
        throw new NotFoundException('Sub-admin invite not found');
      }

      await prisma.subAdminInvite.delete({
        where: { id },
      });

      return {
        message: 'Invitation cancelled successfully',
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async acceptInvitedSubAdmin(dto: SubAdminDto): Promise<any> {
    try {
      const password = await argon.hash(dto.password);

      // confirm username does not exist
      const check_username = await prisma.user.findFirst({
        where: { username: dto.username },
      });

      if (check_username) {
        throw new ForbiddenException('Username already exists');
      }

      // confirm invite token + load the adminType stored at invite time
      const check_token = await prisma.subAdminInvite.findFirst({
        where: { token: dto.inviteToken },
      });

      if (!check_token) {
        throw new ForbiddenException('Invalid invitation token');
      }

      // check expiration
      if (check_token.expiresAt < new Date()) {
        throw new ForbiddenException('Invitation token has expired');
      }

      // Use the adminType stored on the invite, falling back to dto.roleName
      const effectiveRoleName = check_token.adminType || dto.roleName || 'subadmin';

      let userRole = await prisma.role.findFirst({
        where: { name: effectiveRoleName },
      });

      if (!userRole) {
        userRole = await prisma.role.create({
          data: { name: effectiveRoleName },
        });
      }

      // create user
      const user = await prisma.user.create({
        data: {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          username: dto.username,
          password,
          phone: dto.phone,
          active: true,
          roleName: effectiveRoleName,
        },
      });

      if (effectiveRoleName === 'superadmin') {
        // Owner/Super Admin: create an Admin record (not SubAdmin)
        await prisma.admin.create({
          data: {
            userId: user.id,
            roleId: userRole.id,
          },
        });
      } else {
        // Full or Restricted Admin: create SubAdmin + transfer permissions
        const subAdmin = await prisma.subAdmin.create({
          data: {
            userId: user.id,
            roleId: userRole.id,
          },
        });

        // Transfer permissions from invite to the new subAdmin record
        await prisma.subAdminPermission.updateMany({
          where: { inviteId: check_token.id },
          data: { subAdminId: subAdmin.id },
        });
      }

      await this.taskService.subadminRegistered({
        id: user.id,
        name: user.username,
        email: user.email,
        role: user.roleName,
      });

      return user;
    } catch (error) {
      throw error;
    }
  }

  /**
   * GET /api/v1/admin/list-admins
   * Lists all admins (superadmin and subadmin) with optional status filter (active/inactive)
   * and includes live counts for each status.
   */
  async listAdmins(params: {
    page?: number;
    perPage?: number;
    status?: string;
  }): Promise<any> {
    try {
      const page = Math.max(1, Number(params.page) || 1);
      const perPage = Math.max(1, Number(params.perPage) || 10);
      const { status } = params;

      const skip = (page - 1) * perPage;

      const baseRoleWhere = {
        roleName: { in: ['superadmin', 'subadmin'] },
      };

      const where: any = { ...baseRoleWhere };

      if (status) {
        const normalized = status.toLowerCase().trim();
        if (normalized === 'active') {
          where.active = true;
        } else if (normalized === 'inactive') {
          where.active = false;
        }
      }

      const [users, total, activeCount, inactiveCount] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          skip,
          take: perPage,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
        prisma.user.count({ where: { ...baseRoleWhere, active: true } }),
        prisma.user.count({ where: { ...baseRoleWhere, active: false } }),
      ]);

      const subadminUsers = users.filter((u) => u.roleName === 'subadmin');
      const subadminIds = subadminUsers.map((u) => u.id);

      const subAdmins = await prisma.subAdmin.findMany({
        where: { userId: { in: subadminIds } },
      });

      const subAdminMap = subAdmins.reduce(
        (acc, s) => {
          acc[s.userId] = s.id;
          return acc;
        },
        {} as Record<number, number>,
      );

      const actualSubAdminIds = Object.values(subAdminMap);

      const permissions = await prisma.subAdminPermission.findMany({
        where: { subAdminId: { in: actualSubAdminIds } },
        include: { permission: true },
      });

      const permissionMap = permissions.reduce(
        (acc, item) => {
          if (!acc[item.subAdminId]) {
            acc[item.subAdminId] = [];
          }
          acc[item.subAdminId].push(item.permission);
          return acc;
        },
        {} as Record<number, any[]>,
      );

      const formatted = users.map((user) => {
        if (user.roleName !== 'subadmin') {
          return { ...user, permissions: [] };
        }

        const subAdminId = subAdminMap[user.id];

        return {
          ...user,
          permissions: subAdminId ? permissionMap[subAdminId] || [] : [],
        };
      });

      return {
        data: formatted,
        meta: {
          page,
          perPage,
          total,
          lastPage: Math.ceil(total / perPage),
        },
        counts: {
          active: activeCount,
          inactive: inactiveCount,
          total: activeCount + inactiveCount,
        },
        statusCounts: {
          active: activeCount,
          inactive: inactiveCount,
        },
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  /**
   * GET /api/v1/admin/list-clients
   * Lists all client users with all table columns (Username, Display Photo, Name, Email,
   * Phone, Date Registered, Subscription Plan, Birth Date, Age, Country, State,
   * Verified Photo, BVN, NIN, etc.) and supports pagination and filters.
   */
  async listClients(params: {
    page?: number;
    perPage?: number;
    status?: string;
    plan?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<any> {
    try {
      const page = Math.max(1, Number(params.page) || 1);
      const perPage = Math.max(1, Number(params.perPage) || 10);
      const { status, plan, search, sortBy = 'createdAt', sortOrder = 'desc' } = params;

      const skip = (page - 1) * perPage;

      const baseWhere: any = {
        roleName: 'client',
      };

      const where: any = { ...baseWhere };

      if (status) {
        const normalized = status.toLowerCase().trim();
        if (normalized === 'active') {
          where.active = true;
        } else if (normalized === 'inactive') {
          where.active = false;
        } else if (normalized === 'online') {
          where.isOnline = true;
        } else if (normalized === 'offline') {
          where.isOnline = false;
        } else if (normalized === 'banned') {
          where.isBanned = true;
        }
      }

      if (plan) {
        const normalizedPlan = plan.toUpperCase().trim();
        if (normalizedPlan === 'FREE') {
          where.subscriptionPlan = 'FREE';
        } else if (normalizedPlan === 'PREMIUM_PRO' || normalizedPlan === 'PRO') {
          where.subscriptionPlan = 'PREMIUM_PRO';
        } else if (normalizedPlan === 'PREMIUM_PRO_MAX' || normalizedPlan === 'PRO_MAX' || normalizedPlan === 'PRO MAX') {
          where.subscriptionPlan = 'PREMIUM_PRO_MAX';
        } else if (normalizedPlan === 'PREMIUM') {
          where.subscriptionPlan = { in: ['PREMIUM_PRO', 'PREMIUM_PRO_MAX'] };
        }
      }

      if (search && search.trim()) {
        const q = search.trim();
        where.OR = [
          { username: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { bvn: { contains: q, mode: 'insensitive' } },
          { nin: { contains: q, mode: 'insensitive' } },
          { country: { contains: q, mode: 'insensitive' } },
          { state: { contains: q, mode: 'insensitive' } },
        ];
      }

      const orderBy: any = {};
      if (['createdAt', 'username', 'email', 'firstName', 'lastName', 'dob'].includes(sortBy)) {
        orderBy[sortBy] = sortOrder === 'asc' ? 'asc' : 'desc';
      } else {
        orderBy.createdAt = 'desc';
      }

      const [clients, total, activeCount, inactiveCount, bannedCount] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          skip,
          take: perPage,
          orderBy,
        }),
        prisma.user.count({ where }),
        prisma.user.count({ where: { ...baseWhere, active: true } }),
        prisma.user.count({ where: { ...baseWhere, active: false } }),
        prisma.user.count({ where: { ...baseWhere, isBanned: true } }),
      ]);

      const clientIds = clients.map((c) => c.id);

      const subscriptions = clientIds.length > 0
        ? await prisma.subscription.findMany({
            where: { userId: { in: clientIds } },
            orderBy: { startDate: 'desc' },
          })
        : [];

      const subscriptionMap = subscriptions.reduce((acc, sub) => {
        if (!acc[sub.userId]) {
          acc[sub.userId] = sub;
        }
        return acc;
      }, {} as Record<number, any>);

      const formatted = clients.map((user) => {
        const sub = subscriptionMap[user.id];

        const effectivePlan = user.subscriptionPlan || (sub?.subscriptionPlan ?? 'FREE');
        let subscriptionName = 'Free';
        let planTier: string | null = null;

        if (effectivePlan === 'PREMIUM_PRO' || effectivePlan === 'PREMIUM_PRO_MAX') {
          subscriptionName = 'Premium';
          planTier = effectivePlan === 'PREMIUM_PRO' ? 'Pro' : 'Pro Max';
        } else if (effectivePlan === 'FREE') {
          subscriptionName = 'Free';
          planTier = null;
        } else if (effectivePlan) {
          subscriptionName = String(effectivePlan);
        }

        let age: number | null = null;
        if (user.dob) {
          const birth = new Date(user.dob);
          if (!isNaN(birth.getTime())) {
            const today = new Date();
            let calculatedAge = today.getFullYear() - birth.getFullYear();
            const monthDiff = today.getMonth() - birth.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
              calculatedAge--;
            }
            age = calculatedAge >= 0 ? calculatedAge : null;
          }
        }

        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;

        return {
          id: user.id,
          username: user.username,
          displayPhoto: user.profilePicture || user.verify_photo || null,
          profilePicture: user.profilePicture || null,
          name: fullName,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone || null,
          dateRegistered: user.createdAt,
          createdAt: user.createdAt,
          subscriptionPlan: effectivePlan,
          subscription: subscriptionName,
          plan: planTier,
          subscriptionDate: sub?.startDate ?? null,
          subscriptionExpiry: sub?.endDate ?? null,
          birthDate: user.dob ?? null,
          dob: user.dob ?? null,
          age,
          country: user.country || null,
          state: user.state || null,
          verifiedPhoto: user.verify_photo || null,
          verify_photo: user.verify_photo || null,
          bvn: user.bvn || null,
          nin: user.nin || null,
          residentialAddress: user.address || null,
          address: user.address || null,
          postal_code: user.postal_code || null,
          status: user.isOnline ? 'active' : (user.active ? 'active' : 'inactive'),
          active: user.active,
          isOnline: user.isOnline,
          isBanned: user.isBanned,
          lastLogin: user.login_timestamp ?? null,
          login_timestamp: user.login_timestamp ?? null,
          location: user.location || null,
          ip_address: user.ip_address || null,
          kyc_status: user.kyc_status,
          kyc_tier: user.kyc_tier,
          report: {
            banReason: user.banReason || '',
            banCategory: user.banCategory || '',
            unbanReason: user.unBanReason || '',
          },
        };
      });

      return {
        data: formatted,
        meta: {
          page,
          perPage,
          total,
          lastPage: Math.ceil(total / perPage),
          hasNextPage: page < Math.ceil(total / perPage),
          hasPrevPage: page > 1,
        },
        counts: {
          total,
          active: activeCount,
          inactive: inactiveCount,
          banned: bannedCount,
        },
        statusCounts: {
          active: activeCount,
          inactive: inactiveCount,
          banned: bannedCount,
        },
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async getAdminsbyRole(roleName: string): Promise<any> {
    try {
      const admins = await prisma.user.findMany({
        where: { roleName: roleName },
      });
      return admins;
    } catch (error) {
      throw error;
    }
  }

  async deleteAdmin(adminId: number): Promise<any> {
    try {
      await prisma.user.delete({
        where: { id: adminId },
      });
      return { message: 'Admin deleted successfully' };
    } catch (error) {
      throw error;
    }
  }

  async getAdminStats() {
    // get all user emails
    const users = await prisma.user.findMany({
      select: { email: true },
    });

    const userEmails = users.map((u) => u.email);

    const [totalSuperAdmin, totalSubAdmin, totalClient, currentSubAdminInvite] =
      await Promise.all([
        prisma.user.count({
          where: { roleName: 'superadmin' },
        }),
        prisma.user.count({
          where: { roleName: 'subadmin' },
        }),
        prisma.user.count({
          where: { roleName: 'client' },
        }),
        prisma.subAdminInvite.count({
          where: {
            email: {
              notIn: userEmails,
            },
          },
        }),
      ]);

    return {
      totalSuperAdmin,
      totalSubAdmin,
      totalClient,
      currentSubAdminInvite,
    };
  }

  async demoteSubAdminToClient(adminId: number): Promise<any> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: Number(adminId) },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.roleName !== 'subadmin') {
        throw new BadRequestException('User is not a sub-admin');
      }

      // Ensure the 'client' role exists, create if not
      let clientRole = await prisma.role.findFirst({
        where: { name: 'client' },
      });

      if (!clientRole) {
        clientRole = await prisma.role.create({
          data: { name: 'client' },
        });
      }

      // Remove the subAdmin record tied to this user
      await prisma.subAdmin.deleteMany({
        where: { userId: adminId },
      });

      // Remove any permissions tied to this subadmin
      await prisma.subAdminPermission.deleteMany({
        where: { subAdminId: adminId },
      });

      // Update the user's role to 'client'
      const updatedUser = await prisma.user.update({
        where: { id: adminId },
        data: { roleName: 'client' },
      });

      return {
        message: 'Sub-admin successfully demoted to client',
        data: updatedUser,
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async getSubAdminWithPermissions(adminId: number): Promise<any> {
    try {
      const subAdmin = await prisma.subAdmin.findFirst({
        where: { userId: adminId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              username: true,
            },
          },
          subAdminPermissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      if (!subAdmin) {
        throw new NotFoundException('SubAdmin not found');
      }

      return {
        message: 'Sub-admin permissions fetched successfully',
        data: subAdmin,
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  /**
   * Returns the live Total Admins count and week-over-week delta for the
   * admin Home dashboard card.
   */
  async getAdminCount() {
    const now = new Date();

    const startOfCurrentWeek = new Date(now);
    startOfCurrentWeek.setDate(now.getDate() - 7);

    const startOfPreviousWeek = new Date(now);
    startOfPreviousWeek.setDate(now.getDate() - 14);

    const [total, thisWeek, lastWeek] = await Promise.all([
      prisma.user.count({
        where: {
          roleName: { in: ['superadmin', 'subadmin'] },
          active: true,
          isBanned: false,
        },
      }),
      prisma.user.count({
        where: {
          roleName: { in: ['superadmin', 'subadmin'] },
          active: true,
          isBanned: false,
          createdAt: { gte: startOfCurrentWeek },
        },
      }),
      prisma.user.count({
        where: {
          roleName: { in: ['superadmin', 'subadmin'] },
          active: true,
          isBanned: false,
          createdAt: { gte: startOfPreviousWeek, lt: startOfCurrentWeek },
        },
      }),
    ]);

    const weeklyDelta = thisWeek - lastWeek;
    const deltaLabel =
      weeklyDelta > 0
        ? `+${weeklyDelta} this week`
        : weeklyDelta < 0
          ? `${weeklyDelta} this week`
          : `+${thisWeek} this week`;

    return {
      total,
      weeklyDelta,
      deltaLabel,
      thisWeek,
      lastWeek,
      asOf: now.toISOString(),
    };
  }

  /**
   * Returns the live Client Users count for the admin Home dashboard.
   */
  async getClientCount() {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [total, today] = await Promise.all([
      prisma.user.count({
        where: {
          roleName: 'client',
          active: true,
          isBanned: false,
        },
      }),
      prisma.user.count({
        where: {
          roleName: 'client',
          active: true,
          isBanned: false,
          createdAt: { gte: startOfToday },
        },
      }),
    ]);

    const deltaLabel = `+${today} today`;

    return {
      total,
      today,
      dailyDelta: today,
      deltaLabel,
      totalClients: total,
      dailyChange: deltaLabel,
      asOf: now.toISOString(),
    };
  }

  /**
   * Returns the live Pending Invites count for the admin Home dashboard.
   */
  async getPendingInviteCount() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [users, activeInvites] = await Promise.all([
      prisma.user.findMany({
        select: { email: true },
      }),
      prisma.subAdminInvite.findMany({
        where: {
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          email: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
    ]);

    const registeredEmails = new Set(
      users.map((u) => (u.email || '').toLowerCase().trim()).filter(Boolean),
    );

    const pendingInvites = activeInvites.filter(
      (inv) => !registeredEmails.has((inv.email || '').toLowerCase().trim()),
    );

    const total = pendingInvites.length;
    const today = pendingInvites.filter((inv) => inv.createdAt >= startOfToday).length;

    const deltaLabel = total > 0 ? `${total} total` : '0';

    return {
      total,
      pendingCount: total,
      today,
      deltaLabel,
      asOf: now.toISOString(),
    };
  }
}
