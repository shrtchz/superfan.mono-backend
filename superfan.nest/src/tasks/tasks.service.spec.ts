import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskService } from './tasks.service';
import { TaskChatGateway } from './tasks.gateway';
import { prisma } from '../prisma/prisma';
import { TaskPriority, TaskStatus } from '../common/enums/task.enum';

jest.mock('../prisma/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    task: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    taskMessage: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    activity: {
      deleteMany: jest.fn(),
    },
  },
}));

describe('TaskService', () => {
  let service: TaskService;
  let gateway: Partial<TaskChatGateway>;
  let walletService: any;
  let notificationService: any;
  let userService: any;
  let cronService: any;
  let pointsConversionUtil: any;

  beforeEach(() => {
    jest.clearAllMocks();

    gateway = {
      server: {
        to: jest.fn().mockReturnValue({
          emit: jest.fn(),
        }),
      } as any,
      getUserSocket: jest.fn().mockReturnValue('socket_123'),
    };
    (gateway as any)['users'] = new Map<number, string>([[2, 'socket_123']]);

    walletService = {};
    notificationService = {};
    userService = {};
    cronService = {};
    pointsConversionUtil = {};

    service = new TaskService(
      walletService,
      gateway as TaskChatGateway,
      notificationService,
      userService,
      cronService,
      pointsConversionUtil,
    );
  });

  describe('createTask', () => {
    it('should reject task creation if assigner is not superadmin', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 1,
        roleName: 'subadmin',
        firstName: 'Sub',
        lastName: 'Admin',
        username: 'subadmin1',
      });

      await expect(
        service.createTask({
          title: 'Review submissions',
          assignmentDate: new Date(Date.now() + 86400000).toISOString(),
          dueDate: new Date(Date.now() + 172800000).toISOString(),
          userId: 2,
          assignerId: 1,
          priority: TaskPriority.HIGH,
          status: TaskStatus.PENDING,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject task creation if assignment date is strictly before today (in the past)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 1,
        roleName: 'superadmin',
        firstName: 'Super',
        lastName: 'Admin',
        username: 'superadmin1',
      });

      const yesterday = new Date(Date.now() - 2 * 86400000).toISOString();

      await expect(
        service.createTask({
          title: 'Past task',
          assignmentDate: yesterday,
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          userId: 2,
          assignerId: 1,
          priority: TaskPriority.MEDIUM,
          status: TaskStatus.PENDING,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create task successfully when assigner is superadmin and assignmentDate is current/future', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 1,
          roleName: 'superadmin',
          firstName: 'Super',
          lastName: 'Admin',
          username: 'superadmin1',
        })
        .mockResolvedValueOnce({
          id: 2,
          firstName: 'Assignee',
        });

      const createdTaskMock = {
        id: 10,
        title: 'Review submissions',
        description: 'Check quiz submissions',
        priority: TaskPriority.HIGH,
        status: TaskStatus.PENDING,
        dueDate: new Date(Date.now() + 86400000),
        assignmentDate: new Date(),
        userId: 2,
        assignerId: 1,
        assignerFirstName: 'Super',
        assignerLastName: 'Admin',
        assignerUserName: 'superadmin1',
        isDeleted: false,
        assignTo: 'Assignee',
      };

      (prisma.task.create as jest.Mock).mockResolvedValueOnce(createdTaskMock);
      (prisma.taskMessage.create as jest.Mock).mockResolvedValueOnce({
        id: 1,
        taskId: 10,
        senderId: 1,
        message: 'Task "Review submissions" has been assigned.',
      });

      const result = await service.createTask({
        title: 'Review submissions',
        description: 'Check quiz submissions',
        assignmentDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        userId: 2,
        assignerId: 1,
        priority: TaskPriority.HIGH,
        status: TaskStatus.PENDING,
      });

      expect(result.create_task).toEqual(createdTaskMock);
      expect(prisma.task.create).toHaveBeenCalled();
      expect(prisma.taskMessage.create).toHaveBeenCalled();
    });

    it('should allow assignment date set to today midnight without rejecting it', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 1,
          roleName: 'superadmin',
          firstName: 'Super',
          lastName: null, // null lastName should not crash
          username: 'superadmin1',
        })
        .mockResolvedValueOnce({
          id: 2,
          firstName: 'Assignee',
        });

      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);

      (prisma.task.create as jest.Mock).mockResolvedValueOnce({ id: 20, title: 'Today Task' });
      (prisma.taskMessage.create as jest.Mock).mockResolvedValueOnce({ id: 2 });

      await expect(
        service.createTask({
          title: 'Today Task',
          assignmentDate: todayMidnight.toISOString(),
          userId: 2,
          assignerId: 1,
          priority: TaskPriority.LOW,
          status: TaskStatus.PENDING,
        }),
      ).resolves.toBeDefined();

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assignerLastName: '',
        }),
      });
    });
  });

  describe('deleteTasks', () => {
    it('should delete task by ID', async () => {
      (prisma.task.delete as jest.Mock).mockResolvedValueOnce({ id: 10 });

      const res = await service.deleteTasks(10);
      expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 10 } });
      expect(res.message).toBe('Tasks deleted successfully');
    });

    it('should delete all tasks using deleteAllTasks', async () => {
      (prisma.task.deleteMany as jest.Mock).mockResolvedValueOnce({ count: 5 });

      const res = await service.deleteAllTasks();
      expect(prisma.task.deleteMany).toHaveBeenCalled();
      expect(res).toEqual({ count: 5 });
    });
  });

  describe('Chat functionality (sendMessage, fetchMessages, editMessage, deleteMessage)', () => {
    it('should send a message, enrich senderName, and broadcast to task room', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValueOnce({ id: 10 });
      (prisma.taskMessage.create as jest.Mock).mockResolvedValueOnce({
        id: 101,
        taskId: 10,
        senderId: 1,
        message: 'Hello subadmin',
        createdAt: new Date(),
      });
      userService.findUserById = jest.fn().mockResolvedValueOnce({
        id: 1,
        firstName: 'Super',
        lastName: 'Admin',
        username: 'superadmin1',
      });

      const res = await service.sendMessage({
        taskId: 10,
        senderId: 1,
        message: 'Hello subadmin',
      });

      expect(res.senderName).toBe('Super Admin');
      expect(res.sender).toEqual({
        id: 1,
        firstName: 'Super',
        lastName: 'Admin',
        username: 'superadmin1',
      });
      expect(gateway.server?.to).toHaveBeenCalledWith('task-10');
    });

    it('should fetch messages and enrich all items with senderName', async () => {
      (prisma.taskMessage.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 1, taskId: 10, senderId: 1, message: 'Message 1', createdAt: new Date() },
        { id: 2, taskId: 10, senderId: 2, message: 'Message 2', createdAt: new Date() },
      ]);
      userService.findUserById = jest
        .fn()
        .mockResolvedValueOnce({ id: 1, firstName: 'Super', lastName: 'Admin', username: 'super' })
        .mockResolvedValueOnce({ id: 2, firstName: 'Sub', lastName: 'Admin', username: 'sub' });

      const res = await service.fetchMessages(10);
      expect(res).toHaveLength(2);
      expect(res[0].senderName).toBe('Super Admin');
      expect(res[1].senderName).toBe('Sub Admin');
    });

    it('should edit message and broadcast messageEdited event', async () => {
      (prisma.taskMessage.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 5,
        taskId: 10,
        senderId: 1,
        message: 'Old text',
      });
      (prisma.taskMessage.update as jest.Mock).mockResolvedValueOnce({
        id: 5,
        taskId: 10,
        senderId: 1,
        message: 'New edited text',
      });

      const res = await service.editMessage(5, 1, 'New edited text');
      expect(res.message).toBe('New edited text');
      expect(gateway.server?.to).toHaveBeenCalledWith('task-10');
    });

    it('should delete message and broadcast messageDeleted event', async () => {
      (prisma.taskMessage.delete as jest.Mock).mockResolvedValueOnce({
        id: 5,
        taskId: 10,
        senderId: 1,
      });

      const res = await service.deleteMessage('5');
      expect(res.message).toBe('Message deleted successfully');
      expect(gateway.server?.to).toHaveBeenCalledWith('task-10');
    });
  });
});
