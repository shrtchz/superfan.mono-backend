import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { NotificationService } from '../notification/notification.service';
import { prisma } from '../prisma/prisma';
import { UserService } from '../user/user.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateActivityDto } from './dto/activity.dto';
import { CreateClientHistoryDto, CreatePayoutDto, GetClientHistoryDto, TaskDto, TaskMessageDto } from './dto/task.dto';
import { TaskChatGateway } from './tasks.gateway';
import { TaskStatus, ActivityType } from '../common/enums/task.enum';
import { CronJobService } from '../cronjobs/cronjob.service';

@Injectable()
export class TaskService {
  constructor(
    private walletService: WalletService,
    private gateway: TaskChatGateway,
    private notificationService: NotificationService,
    @Inject(forwardRef(() => UserService))
    private userService: UserService,
    private cronService: CronJobService
  ) {}

  async createTask(dto: TaskDto) {
    const assigner = await prisma.user.findUnique({
      where: { id: dto.assignerId },
      select: {
        id: true,
        roleName: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });

    if (!assigner) {
      throw new Error('Assigner not found');
    }

    if (assigner.roleName !== 'superadmin') {
      throw new ForbiddenException('Only superadmin can assign tasks');
    }

    // ✅ Validate assignment date
    const now = new Date();
    const assignmentDate = new Date(dto.assignmentDate);

    if (assignmentDate < now) {
      throw new BadRequestException('Assignment date cannot be in the past');
    }

    // ✅ Validate receiver (user)
    const user = await prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, firstName: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    let create_task = await prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        status: dto.status,
        dueDate: dto.dueDate,
        assignmentDate: dto.assignmentDate,
        userId: dto.userId,
        assignerId: dto.assignerId,
        assignerFirstName: assigner.firstName,
        assignerLastName: assigner.lastName,
        assignerUserName: assigner.username,
        isDeleted: false,
        assignTo: user.firstName,
      },
    });

    // ✅ Create initial message (system or superadmin message)
    const initialMessage = await prisma.taskMessage.create({
      data: {
        taskId: create_task.id,
        senderId: dto.assignerId, // or superadmin ID if available
        message: `Task "${create_task.title}" has been assigned.`,
      },
    });

    // 🔥 Emit task assignment
    const socketId = this.gateway.getUserSocket(dto.userId);

    if (socketId) {
      this.gateway.server.to(socketId).emit('taskAssigned', create_task);
    }

    // 🔥 Notify assigned user
    this.gateway.server
      .to(this.gateway['users'].get(dto.userId))
      .emit('taskAssigned', create_task);

    return {
      create_task,
      initialMessage,
    };
  }

  async sendMessage(data: TaskMessageDto) {
    // ✅ Validate task exists
    const task = await prisma.task.findUnique({
      where: { id: data.taskId },
    });

    if (!task) {
      throw new Error('Task not found');
    }

    // ✅ Save message
    const newMessage = await prisma.taskMessage.create({
      data: {
        taskId: data.taskId,
        senderId: data.senderId,
        message: data.message,
      },
    });

    // 🔥 Emit to task room (real-time)
    this.gateway.server
      .to(`task-${data.taskId}`)
      .emit('newMessage', newMessage);

    return newMessage;
  }

  // async fetchMessages(taskId: number) {
  //   const messages = await prisma.taskMessage.findMany({
  //     where: {
  //       taskId: taskId,
  //     },
  //     orderBy: {
  //       createdAt: 'asc', // oldest → newest (chat order)
  //     },
  //   });

  //   return messages;
  // }

  async fetchMessages(taskId: number) {
    const messages = await prisma.taskMessage.findMany({
      where: {
        taskId: taskId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Fetch sender details for each message
    const enrichedMessages = await Promise.all(
      messages.map(async (msg) => {
        const sender = await this.userService.findUserById(msg.senderId);

        return {
          ...msg,
          sender: sender
            ? {
                id: sender.id,
                firstName: sender.firstName,
                lastName: sender.lastName,
                username: sender.username,
              }
            : null,
        };
      }),
    );

    return enrichedMessages;
  }

  // ✏️ Edit Message
  async editMessage(messageId: number, userId: number, message: string) {
    const existingMessage = await prisma.taskMessage.findUnique({
      where: { id: messageId },
    });

    if (!existingMessage) {
      throw new NotFoundException('Message not found');
    }

    if (existingMessage.senderId !== userId) {
      throw new ForbiddenException('You cannot edit this message');
    }

    const updatedMessage = await prisma.taskMessage.update({
      where: { id: messageId },
      data: { message },
    });

    // 🔥 Emit real-time update
    this.gateway.server
      .to(`task-${existingMessage.taskId}`)
      .emit('messageEdited', updatedMessage);

    return updatedMessage;
  }

  // 🗑 Delete Message
  async deleteMessage(messageId: string) {
    let existingTask = await prisma.taskMessage.delete({
      where: { id: Number(messageId) },
    });

    // 🔥 Emit real-time delete
    this.gateway.server
      .to(`task-${existingTask.taskId}`)
      .emit('messageDeleted', { id: messageId });

    return {
      message: 'Message deleted successfully',
    };
  }

  async updateTask(id: string, dto: TaskDto) {
    return prisma.task.update({
      where: { id: Number(id) },
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        status: dto.status,
      },
    });
  }

  async findAllTasks() {
    return prisma.task.findMany();
  }

  async deleteTasks(id: number) {
    const deleted_task = await prisma.task.delete({
      where: { id },
    });

    return {
      message: 'Tasks deleted successfully',
      data: deleted_task,
    };
  }

  async findTasksByUserId(userId: number, status?: TaskStatus) {
    const tasks = await prisma.task.findMany({
      where: {
        userId,
        status,
      },
      orderBy: { createdAt: 'desc' },
    });

    return tasks;
  }

  async getAllPendingTaskCount() {
    const count = await prisma.task.count({
      where: {
        status: 'PENDING',
        isDeleted: false,
      },
    });

    return { pendingCount: count };
  }

  async logActivity(data: CreateActivityDto) {
    return prisma.activityMonitor.create({
      data: {
        type: data.type,
        actorId: data.actorId,
        actorName: data.actorName,
        actorEmail: data.actorEmail,
        metadata: data.metadata,
      },
    });
  }

  async getRecentActivities(limit = 20) {
    return prisma.activityMonitor.findMany({
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async userRegistered(user: {
    id: number;
    name: string;
    email: string;
    role: string;
  }) {
    const activity = await this.logActivity({
      type: ActivityType.user_registered,
      actorId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      metadata: {
        role: user.role, // ✅ store role here
        label: `New ${user.role.toLowerCase()} registered`, // optional readable text
      },
    });

    // Notify all superadmin and subadmin users
    const admins = await prisma.user.findMany({
      where: {
        roleName: { in: ['superadmin', 'subadmin'] },
      },
      select: { id: true, username: true },
    });

    await Promise.all(
      admins.map((admin) =>
        this.notificationService.createNotification(
          admin.id,
          `New user Signup`,
          `${user.role} account. @${user.name}`,
        ),
      ),
    );

    return activity;
  }

  async subadminRegistered(user: {
    id: number;
    name: string;
    email: string;
    role: string;
  }) {
    const activity = await this.logActivity({
      type: ActivityType.subadmin_registered,
      actorId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      metadata: {
        role: user.role, // ✅ store role here
        label: `New ${user.role.toLowerCase()} registered`, // optional readable text
      },
    });

    // Look up the invite to find who invited this subadmin
    const invite = await prisma.subAdminInvite.findFirst({
      where: { email: user.email },
      include: {
        invitedBy: {
          select: { id: true, username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (invite?.invitedBy) {
      let notif_sub_admin = await this.notificationService.createNotification(
        invite.invitedBy.id,
        'New user Signup',
        `${user.role} account. @${user.name}`,
      );
    }

    return activity;
  }

  async deleteActivity(id: number) {
    return prisma.activityMonitor.delete({
      where: {
        id,
      },
    });
  }

  async deleteAllActivities() {
    return prisma.activityMonitor.deleteMany({});
  }

  async deleteAllTasks() {
    return prisma.task.deleteMany({});
  }

  async rewardFirstTest(userId: number) {
    const referral = await prisma.referral.findFirst({
      where: {
        refereeId: userId,
        testRewardGiven: false,
      },
    });

    if (!referral) return;

    await this.walletService.creditWallet(
      referral.referrerId,
      10,
      'referral_test_bonus',
      `You earned ₦10 because completed a test`,
    );

    // call createReward and createPoints

    await prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'FIRST_TEST_COMPLETED',
        testRewardGiven: true,
      },
    });
  }

  async getMyReferrals(userId: number) {
    return prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referee: true,
      },
    });
  }

  async referralEarnings(userId: number) {
    const transactions = await prisma.walletTransaction.aggregate({
      where: {
        userId,
        description: {
          contains: 'Referral',
        },
      },
      _sum: {
        amount: true,
      },
    });

    return transactions._sum.amount || 0;
  }

//   async createClientHistory(payload: CreateClientHistoryDto) {
//   const { userId, type, description, submittedBy } = payload;

//   // Optional: ensure user exists (prevents orphan records)
//   const user = await prisma.user.findUnique({
//     where: { id: userId },
//     select: { id: true },
//   });

//   if (!user) {
//     throw new Error('User not found');
//   }

//   const history = await prisma.userHistory.create({
//     data: {
//       userId,
//       type,
//       description,
//       submittedBy,
//             user: {
//         connect: { id: userId },
//       },

//     },
//   });

//   return history;
// }

// async createClientHistory(payload: CreateClientHistoryDto) {
//   const { userId, type, title, description, creatorId, submittedBy } = payload;

//   return prisma.userHistory.create({
//     data: {
//       type,
//       title,
//       description,
//       submittedBy,
//       creatorId,
//       user: {
//         connect: { id: userId },
//       },
//     },
//   });
// }

async createClientHistory(payload: CreateClientHistoryDto) {
  const { userId, type, title, description, creatorId, submittedBy } = payload;

  return prisma.userHistory.create({
    data: {
      type,
      title,
      description,
      submittedBy,
      user: {
        connect: { id: userId },
      },
      creator: {
        connect: { id: creatorId },
      },
    },
  });
}

  // async getClientHistory(query: GetClientHistoryDto) {
  //   const page = Number(query.page) || 1;
  //   const limit = Number(query.limit) || 10;

  //   const skip = (page - 1) * limit;

  //   const [data, total] = await Promise.all([
  //     prisma.userHistory.findMany({
  //       where: { userId: query.userId },
  //       orderBy: { createdAt: 'desc' }, // latest first
  //       skip,
  //       take: limit,
  //     }),
  //     prisma.userHistory.count({
  //       where: { userId: query.userId },
  //     }),
  //   ]);

  //   return {
  //     data,
  //     meta: {
  //       total,
  //       page,
  //       limit,
  //       totalPages: Math.ceil(total / limit),
  //     },
  //   };
  // }

  async getClientHistory(query: GetClientHistoryDto) {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.userHistory.findMany({
      where: { userId: query.userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        creator: {
          select: {
            firstName: true,
            lastName: true,
            username: true,
          },
        },
      },
    }),
    prisma.userHistory.count({
      where: { userId: query.userId },
    }),
  ]);

  // map response
  const formattedData = data.map((item) => ({
    ...item,
    adminDetails: item.creator
      ? {
          creatorFirstName: item.creator.firstName,
          creatorLastName: item.creator.lastName,
          creatorUserName: item.creator.username,
        }
      : null,
  }));

  return {
    data: formattedData,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

  async createUserPayout(dto: CreatePayoutDto) {
    // ✅ Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // check if reference already exists
    const existingPayout = await prisma.payout.findUnique({
      where: { reference: dto.reference },
    });

    if (existingPayout) {
      throw new BadRequestException('Reference already exists');
    }

    const payout = await prisma.payout.create({
      data: {
        userId: dto.userId,
        amount: dto.amount,
        status: 'PENDING',
        method: dto.method,
        reference: dto.reference,
        currency: dto.currency,
        provider: dto.provider,

      }
  })

  return payout;

  }

  async getAllPayouts() {
    return prisma.payout.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

async getUserPayoutDetail(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  const [payouts, aggregates] = await Promise.all([
    prisma.payout.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),

    prisma.payout.aggregate({
      where: { userId },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    }),
  ]);

  // pending amount
  const pending = await prisma.payout.aggregate({
    where: {
      userId,
      status: 'PENDING',
    },
    _sum: {
      amount: true,
    },
  });

  return {
    user,
    summary: {
      totalEarnings: aggregates._sum.amount || 0,
      pendingAmount: pending._sum.amount || 0,
      totalPayouts: aggregates._count.id,
    },
    payouts,
  };
}

// async exportPayoutsToPDF(userId: number, res: any) {
//   // ✅ Fetch user info
//   const user = await prisma.user.findUnique({
//     where: { id: Number(userId) },
//     select: {
//       firstName: true,
//       lastName: true,
//       email: true,
//     },
//   });

//   if (!user) {
//     throw new NotFoundException('User not found');
//   }

//   // ✅ Fetch payouts
//   const payouts = await prisma.payout.findMany({
//     where: { userId: Number(userId) },
//     orderBy: { createdAt: 'desc' },
//   });

//   // ✅ Create PDF
//   const doc = new PDFDocument({ margin: 40 });

//   // Set headers for download
//   res.setHeader(
//     'Content-Disposition',
//     `attachment; filename=payouts_${userId}.pdf`,
//   );
//   res.setHeader('Content-Type', 'application/pdf');

//   doc.pipe(res);

//   // ✅ Title
//   doc.fontSize(18).text('Payout History Report', { align: 'center' });
//   doc.moveDown();

//   // ✅ User Info
//   doc.fontSize(12).text(`Name: ${user.firstName} ${user.lastName}`);
//   doc.text(`Email: ${user.email}`);
//   doc.moveDown();

//   // ✅ Table Header
//   doc.fontSize(12).text(
//     'Reference | Amount | Currency | Status | Method | Date',
//   );
//   doc.moveDown(0.5);

//   // ✅ Payout Rows
//   payouts.forEach((payout) => {
//     doc.text(
//       `${payout.reference} | ${payout.amount} | ${payout.currency} | ${payout.status} | ${payout.method} | ${new Date(
//         payout.createdAt,
//       ).toLocaleDateString()}`,
//     );
//   });

//   doc.end();
// }

async exportPayoutsToPDF(
  userId: number,
  // res: any,
  range: 'ALL' | 'LAST_MONTH' | 'LAST_QUARTER' | 'LAST_YEAR' | 'CUSTOM' = 'ALL',
  startDate?: string,
  endDate?: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  // ✅ Handle date filtering
  let dateFilter: any = {};

  const now = new Date();

  if (range === 'LAST_MONTH') {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    dateFilter = { gte: firstDay, lte: lastDay };
  }

  if (range === 'LAST_QUARTER') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
    const end = new Date(now.getFullYear(), currentQuarter * 3, 0);
    dateFilter = { gte: start, lte: end };
  }

  if (range === 'LAST_YEAR') {
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() - 1, 11, 31);
    dateFilter = { gte: start, lte: end };
  }

  if (range === 'CUSTOM' && startDate && endDate) {
    dateFilter = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  // ✅ Fetch payouts with filter
  const payouts = await prisma.payout.findMany({
    where: {
      userId: Number(userId),
      ...(range !== 'ALL' && { createdAt: dateFilter }),
    },
    orderBy: { createdAt: 'desc' },
  });

  // ✅ Create PDF
  const doc = new PDFDocument({ margin: 40 });

  // res.setHeader(
  //   'Content-Disposition',
  //   `attachment; filename=payouts_${userId}.pdf`,
  // );
  // res.setHeader('Content-Type', 'application/pdf');



  // ✅ Title
  doc.fontSize(18).text('Payout History Report', { align: 'center' });
  doc.moveDown();

  // ✅ User Info
  doc.fontSize(12).text(`Name: ${user.firstName} ${user.lastName}`);
  doc.text(`Email: ${user.email}`);
  doc.text(`Filter: ${range}`);
  doc.moveDown();

  // ✅ Table Header (aligned columns)
  const tableTop = doc.y;

  const colX = {
    date: 40,
    amount: 120,
    method: 200,
    reference: 280,
    status: 400,
  };

  doc.font('Helvetica-Bold');
  doc.text('Date', colX.date, tableTop);
  doc.text('Amount', colX.amount, tableTop);
  doc.text('Method', colX.method, tableTop);
  doc.text('Reference', colX.reference, tableTop);
  doc.text('Status', colX.status, tableTop);

  doc.moveDown();

  doc.font('Helvetica');

  let y = doc.y;

  payouts.forEach((payout) => {
    const rowHeight = 20;

    doc.text(
      new Date(payout.createdAt).toLocaleDateString(),
      colX.date,
      y,
    );
    doc.text(`${payout.amount} ${payout.currency}`, colX.amount, y);
    doc.text(payout.method, colX.method, y);
    doc.text(payout.reference, colX.reference, y);
    doc.text(payout.status, colX.status, y);

    y += rowHeight;

    // ✅ Page break
    if (y > doc.page.height - 50) {
      doc.addPage();
      y = 50;
    }
  });

  const buffers: Buffer[] = [];

doc.on('data', buffers.push.bind(buffers));

return new Promise<Buffer>((resolve, reject) => {
  doc.on('end', () => {
    resolve(Buffer.concat(buffers));
  });

  doc.on('error', reject);

  doc.end();
});

  // doc.end();
}

async exportPayoutsToCSV(
  userId: number,
  range: 'ALL' | 'LAST_MONTH' | 'LAST_QUARTER' | 'LAST_YEAR' | 'CUSTOM' = 'ALL',
  startDate?: string,
  endDate?: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  // ✅ Date filtering (same as PDF)
  let dateFilter: any = {};
  const now = new Date();

  if (range === 'LAST_MONTH') {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    dateFilter = { gte: firstDay, lte: lastDay };
  }

  if (range === 'LAST_QUARTER') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
    const end = new Date(now.getFullYear(), currentQuarter * 3, 0);
    dateFilter = { gte: start, lte: end };
  }

  if (range === 'LAST_YEAR') {
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() - 1, 11, 31);
    dateFilter = { gte: start, lte: end };
  }

  if (range === 'CUSTOM' && startDate && endDate) {
    dateFilter = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  const payouts = await prisma.payout.findMany({
    where: {
      userId: Number(userId),
      ...(range !== 'ALL' && { createdAt: dateFilter }),
    },
    orderBy: { createdAt: 'desc' },
  });

  // ✅ CSV Header (updated columns)
  const header = 'Date,Amount,Method,Reference,Status\n';

  // ✅ Helper to escape CSV values (IMPORTANT)
  const escapeCSV = (value: any) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    return `"${str.replace(/"/g, '""')}"`;
  };

  // ✅ Rows
  const rows = payouts
    .map((p) =>
      [
        new Date(p.createdAt).toLocaleDateString(),
        `${p.amount} ${p.currency}`,
        p.method,
        p.reference,
        p.status,
      ]
        .map(escapeCSV)
        .join(','),
    )
    .join('\n');

  const csv = header + rows;

  return csv;

  // return res
  // .header(
  //   'Content-Disposition',
  //   `attachment; filename=payouts_${userId}.csv`,
  // )
  // .type('text/csv')
  // .send(csv);




  // res.setHeader(
  //   'Content-Disposition',
  //   `attachment; filename=payouts_${userId}.csv`,
  // );
  // res.setHeader('Content-Type', 'text/csv');

  // res.send(csv);
}


async exportPayoutsToExcel(
  userId: number,
  range: 'ALL' | 'LAST_MONTH' | 'LAST_QUARTER' | 'LAST_YEAR' | 'CUSTOM' = 'ALL',
  startDate?: string,
  endDate?: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  // ✅ Date filtering (same logic)
  let dateFilter: any = {};
  const now = new Date();

  if (range === 'LAST_MONTH') {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    dateFilter = { gte: firstDay, lte: lastDay };
  }

  if (range === 'LAST_QUARTER') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
    const end = new Date(now.getFullYear(), currentQuarter * 3, 0);
    dateFilter = { gte: start, lte: end };
  }

  if (range === 'LAST_YEAR') {
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() - 1, 11, 31);
    dateFilter = { gte: start, lte: end };
  }

  if (range === 'CUSTOM' && startDate && endDate) {
    dateFilter = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  const payouts = await prisma.payout.findMany({
    where: {
      userId: Number(userId),
      ...(range !== 'ALL' && { createdAt: dateFilter }),
    },
    orderBy: { createdAt: 'desc' },
  });

  // ✅ Create workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payouts');

  // ✅ Title
  worksheet.mergeCells('A1:E1');
  worksheet.getCell('A1').value = 'Payout History Report';
  worksheet.getCell('A1').font = { size: 16, bold: true };

  // ✅ User info
  worksheet.addRow([]);
  worksheet.addRow([`Name: ${user.firstName} ${user.lastName}`]);
  worksheet.addRow([`Email: ${user.email}`]);
  worksheet.addRow([`Filter: ${range}`]);
  worksheet.addRow([]);

  // ✅ Table header
  const headerRow = worksheet.addRow([
    'Date',
    'Amount',
    'Method',
    'Reference',
    'Status',
  ]);

  headerRow.font = { bold: true };

  // ✅ Column widths
  worksheet.columns = [
    { key: 'date', width: 15 },
    { key: 'amount', width: 20 },
    { key: 'method', width: 20 },
    { key: 'reference', width: 30 },
    { key: 'status', width: 15 },
  ];

  // ✅ Data rows
  payouts.forEach((p) => {
    worksheet.addRow([
      new Date(p.createdAt).toLocaleDateString(),
      `${p.amount} ${p.currency}`,
      p.method,
      p.reference,
      p.status,
    ]);
  });

  // ✅ Optional: Total row
  const total = payouts.reduce((sum, p) => sum + Number(p.amount), 0);

  worksheet.addRow([]);
  const totalRow = worksheet.addRow([
    '',
    `Total: ${total}`,
    '',
    '',
    '',
  ]);
  totalRow.font = { bold: true };

  // ✅ Response headers
  // res.setHeader(
  //   'Content-Disposition',
  //   `attachment; filename=payouts_${userId}.xlsx`,
  // );

  // res.setHeader(
  //   'Content-Type',
  //   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // );

  // await workbook.xlsx.write(res);
  // res.end();

// await workbook.xlsx.write(res);

// return res.end();
const buffer = await workbook.xlsx.writeBuffer();

return buffer;
}

async getCronJobs() {

  let jobs = await this.cronService.getAllCronJobs();

  return jobs;

}
}
