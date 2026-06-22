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
// import { User } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private mail: MailService,
    private configService: ConfigService,
    private taskService: TaskService,
  ) {}

  async inviteSubAdmin(
    email: string,
    inviterId: number,
    inviterUsername: string,
    permissionIds: number[] = [],
    adminType: string,
  ): Promise<any> {
    try {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new ForbiddenException('User with this email already exists');
      }

      let validPermissionIds: number[] = [];

      // Only process permissions if NOT superadmin
      if (adminType !== 'superadmin') {
        if (!permissionIds || permissionIds.length === 0) {
          throw new BadRequestException(
            'permissionIds are required for this admin type',
          );
        }

        const sanitizedPermissionIds = permissionIds
          .map((id) => Number(id))
          .filter((id) => !isNaN(id));

        const validPermissions = await prisma.permission.findMany({
          where: {
            id: { in: sanitizedPermissionIds },
          },
          select: { id: true },
        });

        validPermissionIds = validPermissions.map((p) => p.id);

        if (
          sanitizedPermissionIds.length > 0 &&
          validPermissionIds.length === 0
        ) {
          throw new BadRequestException(
            'None of the provided permission IDs are valid',
          );
        }
      }

      // generate invite token
      const token = uuidv4();

      // expiry time (7 days)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // save invitation
      const invite = await prisma.subAdminInvite.create({
        data: {
          email,
          token,
          expiresAt,
          invitedById: inviterId,
        },
      });

      // add permissions only if NOT superadmin
      if (adminType !== 'superadmin' && validPermissionIds.length > 0) {
        await prisma.subAdminPermission.createMany({
          data: validPermissionIds.map((permissionId) => ({
            inviteId: invite.id,
            permissionId,
            subAdminId: null,
          })),
          skipDuplicates: true,
        });
      }

      const inviteLink = `${this.configService.get<string>(
        'ADMIN_FRONTEND_URL',
      )}/admin-invitation?token=${token}`;

      await this.mail.subAdminInvitationEmail(
        email,
        inviterUsername,
        inviteLink,
        adminType,
        7,
        expiresAt,
      );

      return {
        message: `${adminType} invitation sent successfully`,
        data: {
          id: invite.id
        }
      };
    } catch (error) {
      throw failureResponse(error);
    }
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

      // determine adminType from permission count (mirrors inviteSubAdmin logic)
      const permissionCount = invite.subAdminPermissions.length;
      const adminType = permissionCount === 0 ? 'superadmin' : 'subadmin';

      // generate a fresh token and reset expiry (same as inviteSubAdmin)
      const newToken = uuidv4();
      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // update invite with new token + expiry
      await prisma.subAdminInvite.update({
        where: { id: invite.id },
        data: {
          token: newToken,
          expiresAt: newExpiry,
        },
      });

      // build fresh invite link with new token
      const inviteLink = `${this.configService.get<string>(
        'ADMIN_FRONTEND_URL',
      )}/admin-invitation?token=${newToken}`;

      // resend email (mirrors inviteSubAdmin signature exactly)
      await this.mail.subAdminInvitationEmail(
        email,
        inviter.username,
        inviteLink,
        adminType,
        7,
        newExpiry,
      );

      return {
        message: `${adminType} invitation resent successfully`,
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

      const adminType =
        invite.subAdminPermissions.length === 0 ? 'superadmin' : 'subadmin';

      return {
        message: 'Invite fetched successfully',
        data: {
          id: invite.id,
          email: invite.email,
          token: invite.token,
          expiresAt: invite.expiresAt,
          adminType,
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

  // delete sub-admin invite
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
        message: 'Sub-admin invite deleted successfully',
      };
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async acceptInvitedSubAdmin(dto: SubAdminDto): Promise<any> {
    try {
      const password = await argon.hash(dto.password);

      let userRole = await prisma.role.findFirst({
        where: { name: dto.roleName },
      });

      if (!userRole) {
        userRole = await prisma.role.create({
          data: { name: dto.roleName },
        });
      }

            // confirm username does not exist
      const check_username = await prisma.user.findFirst({
        where: { username: dto.username },
      });

      if (check_username) {
        throw new ForbiddenException('Username already exists');
      }

      // confirm invite token
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
          roleName: dto.roleName,
        },
      });

      const subAdmin = await prisma.subAdmin.create({
        data: {
          userId: user.id,
          roleId: userRole.id,
        },
      });

          await this.taskService.subadminRegistered({
      id: user.id,
      name: user.username,
      email: user.email,
      role: user.roleName,
    });

      // 🔁 TRANSFER PERMISSIONS FROM INVITE TO SUBADMIN BEFORE DELETING INVITE
      await prisma.subAdminPermission.updateMany({
        where: { inviteId: check_token.id },
        data: { subAdminId: subAdmin.id },
      });

      // 🔥 REMOVE USED INVITE


      return user;
    } catch (error) {
      throw error;
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
      // Check if user exists and is actually a subadmin
      const user = await prisma.user.findUnique({
        where: { id: adminId },
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
}
