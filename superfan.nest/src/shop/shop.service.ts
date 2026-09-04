import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import {
  GetProductsQueryDto,
  CreateProductDto,
  UpdateProductDto,
} from './dto/product.dto';
import { CreateOrderDto, CreateReturnDto } from './dto/order.dto';

function generateOrderNumber(): string {
  const p1 = Math.floor(100 + Math.random() * 900);
  const p2 = Math.floor(100000 + Math.random() * 900000);
  const p3 = Math.floor(100000 + Math.random() * 900000);
  return `${p1}-${p2}-${p3}`;
}

@Injectable()
export class ShopService {
  async getProducts(query?: GetProductsQueryDto) {
    const where: any = {};

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    } else {
      where.isActive = true;
    }

    if (query?.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 50;
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { id: 'asc' },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    const productIds = products.map((p) => p.id);
    let orderCountsByProduct: Record<number, { orders: number; fulfilledOrders: number }> = {};

    if (productIds.length > 0) {
      const orderItems = await prisma.orderItem.findMany({
        where: {
          productId: { in: productIds },
        },
        select: {
          productId: true,
          order: {
            select: {
              status: true,
            },
          },
        },
      });

      orderCountsByProduct = productIds.reduce((acc, id) => {
        acc[id] = { orders: 0, fulfilledOrders: 0 };
        return acc;
      }, {} as Record<number, { orders: number; fulfilledOrders: number }>);

      for (const item of orderItems) {
        if (!item.productId || !(item.productId in orderCountsByProduct)) continue;
        const status = item.order?.status;
        if (status === 'DELIVERED') {
          orderCountsByProduct[item.productId].fulfilledOrders += 1;
        } else if (status && status !== 'CANCELLED') {
          orderCountsByProduct[item.productId].orders += 1;
        }
      }
    }

    const productsWithCounts = products.map((p) => ({
      ...p,
      orders: orderCountsByProduct[p.id]?.orders || 0,
      fulfilledOrders: orderCountsByProduct[p.id]?.fulfilledOrders || 0,
    }));

    return {
      products: productsWithCounts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getProductById(id: number) {
    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async createProduct(dto: CreateProductDto) {
    const rawPrice = String(dto.price || '');
    const priceAmount =
      dto.priceAmount !== undefined && !isNaN(dto.priceAmount)
        ? Number(dto.priceAmount)
        : parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0;

    const data = {
      title: dto.title,
      price: dto.price,
      priceAmount,
      images: dto.images || [],
      colors: dto.colors || [],
      sizes: dto.sizes || [],
      badge: dto.badge || null,
      description: dto.description || null,
      stock: dto.stock ?? 100,
      isActive: dto.isActive ?? true,
    };

    try {
      return await prisma.product.create({ data });
    } catch (err: any) {
      const isPkeyError =
        err?.code === 'P2002' ||
        String(err?.message || '').includes('Product_pkey') ||
        String(err?.cause?.originalMessage || '').includes('Product_pkey');

      if (isPkeyError) {
        try {
          await prisma.$executeRawUnsafe(`
            SELECT setval(
              pg_get_serial_sequence('"Product"', 'id'),
              COALESCE((SELECT MAX(id) FROM "Product"), 0) + 1,
              false
            );
          `);
          return await prisma.product.create({ data });
        } catch (retryErr) {
          const maxProduct = await prisma.product.findFirst({
            orderBy: { id: 'desc' },
            select: { id: true },
          });
          const nextId = (maxProduct?.id ?? 0) + 1;
          return await prisma.product.create({
            data: {
              ...data,
              id: nextId,
            },
          });
        }
      }

      throw err;
    }
  }

  async updateProduct(id: number, dto: UpdateProductDto) {
    const existing = await prisma.product.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const data: any = { ...dto };
    if (dto.price && dto.priceAmount === undefined) {
      data.priceAmount = parseFloat(String(dto.price).replace(/[^0-9.]/g, '')) || 0;
    }

    return prisma.product.update({
      where: { id },
      data,
    });
  }

  async deleteProduct(id: number) {
    const existing = await prisma.product.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    // Detach from any orderItems or returns so orders are preserved
    await prisma.orderItem.updateMany({
      where: { productId: id },
      data: { productId: null },
    });

    await prisma.orderReturn.updateMany({
      where: { productId: id },
      data: { productId: null },
    });

    const deleted = await prisma.product.delete({
      where: { id },
    });

    return { message: 'Product deleted successfully', product: deleted };
  }

  async createOrder(userId: number, dto: CreateOrderDto) {
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    const totalAmount = Number(dto.totalAmount) || 0;
    const shippingFee = Number(dto.shippingFee) || 0;
    const vatAmount = Number(dto.vatAmount) || 0;

    // Verify product IDs to prevent FK constraint failures
    const itemsData = await Promise.all(
      dto.items.map(async (item) => {
        let validProductId: number | null = null;
        if (item.productId && typeof item.productId === 'number' && !isNaN(item.productId)) {
          const product = await prisma.product.findUnique({
            where: { id: item.productId },
            select: { id: true },
          });
          if (product) {
            validProductId = product.id;
          }
        }

        return {
          productId: validProductId,
          productName: item.productName || 'Shop Item',
          productImage: item.productImage || null,
          price: Number(item.price) || 0,
          quantity: Math.max(1, Number(item.quantity) || 1),
          color: item.color || null,
          size: item.size || null,
        };
      }),
    );

    const orderNumber = generateOrderNumber();

    // Use transaction for atomic wallet debit and order creation
    const order = await prisma.$transaction(async (tx) => {
      // If paying with wallet, verify and deduct balance
      if (dto.paymentMethod === 'wallet') {
        let wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          wallet = await tx.wallet.create({
            data: {
              userId,
              balance: 0,
              personalBalance: 0,
              goldBalance: 0,
            },
          });
        }

        const isGold = dto.subWallet?.toLowerCase() === 'gold';
        let availableBalance = isGold
          ? Number(wallet.goldBalance) || 0
          : Number(wallet.personalBalance) || 0;

        if (!isGold) {
          const held = await tx.walletTransaction.aggregate({
            _sum: { amount: true },
            where: {
              userId,
              account_type: 'Personal',
              holdUntil: { gt: new Date() },
            },
          });
          availableBalance = Math.max(0, availableBalance - Number(held._sum.amount || 0));
        }

        if (availableBalance < totalAmount) {
          throw new BadRequestException(
            `Insufficient ${isGold ? 'Gold' : 'Personal'} wallet balance. Required: ₦${totalAmount.toFixed(2)}, Available: ₦${availableBalance.toFixed(2)}`,
          );
        }

        // Deduct from wallet balance
        if (isGold) {
          await tx.wallet.update({
            where: { userId },
            data: {
              goldBalance: { decrement: totalAmount },
              balance: { decrement: totalAmount },
            },
          });
        } else {
          await tx.wallet.update({
            where: { userId },
            data: {
              personalBalance: { decrement: totalAmount },
              balance: { decrement: totalAmount },
            },
          });
        }

        // Record wallet transaction tagged as shop debit
        await tx.walletTransaction.create({
          data: {
            userId,
            amount: totalAmount,
            type: 'debit',
            currency: 'NGN',
            payment_method: 'shop',
            reference: `SHOP-${Date.now()}`,
            status: 'SUCCESS',
            account_name: `Shop Purchase (${dto.subWallet || 'Personal'})`,
            description: 'Shop Merch Payment',
          },
        });
      }


      // Create Order
      return await tx.order.create({
        data: {
          orderNumber,
          userId,
          status: 'ORDERED',
          totalAmount,
          currency: 'NGN',
          shippingFee,
          vatAmount,
          paymentMethod: dto.paymentMethod || 'wallet',
          subWallet: dto.subWallet || null,
          paymentStatus: 'PAID',
          fullName: dto.fullName || 'Customer',
          country: dto.country || 'Nigeria',
          address: dto.address || 'Address',
          phoneCode: dto.phoneCode || '+234',
          phoneNumber: dto.phoneNumber || '08012345678',
          items: {
            create: itemsData,
          },
        },
        include: {
          items: true,
        },
      });
    });

    return {
      message: 'Order placed successfully',
      order,
    };
  }

  async getUserOrders(userId: number, page = 1, limit = 10) {
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: {
          items: true,
          returns: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.order.count({ where: { userId } }),
    ]);

    return {
      orders,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  async getOrderById(userId: number, orderId: number) {
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },
      include: {
        items: true,
        returns: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    return order;
  }

  async createReturn(userId: number, dto: CreateReturnDto) {
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }

    const order = await prisma.order.findFirst({
      where: {
        id: dto.orderId,
        userId,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Must select at least one item to return');
    }

    const createdReturns = await Promise.all(
      dto.items.map((item) =>
        prisma.orderReturn.create({
          data: {
            orderId: dto.orderId,
            userId,
            productId: item.productId || null,
            productName: item.productName,
            productImage: item.productImage || null,
            price: Number(item.price) || 0,
            reason: item.reason,
            refundMethod: dto.refundMethod || 'mastercard',
            status: 'PENDING',
          },
        }),
      ),
    );

    return {
      message: 'Return request submitted successfully',
      returns: createdReturns,
    };
  }

  async getUserReturns(userId: number) {
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('User not authenticated');
    }

    const returns = await prisma.orderReturn.findMany({
      where: { userId },
      include: {
        order: {
          select: {
            orderNumber: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { returns };
  }

  async getAdminOrders(query?: {
    page?: number;
    limit?: number;
    status?: string;
    productId?: number;
    search?: string;
  }) {
    const where: any = {};

    if (query?.productId) {
      where.items = {
        some: {
          productId: Number(query.productId),
        },
      };
    }

    if (query?.status) {
      const rawStatus = String(query.status).trim().toUpperCase();
      if (rawStatus === 'NEW') {
        where.status = {
          in: ['ORDERED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'],
        };
      } else if (rawStatus === 'FULFILLED') {
        where.status = 'DELIVERED';
      } else if (
        ['ORDERED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(
          rawStatus,
        )
      ) {
        where.status = rawStatus;
      }
    }

    if (query?.search) {
      const s = String(query.search).trim();
      where.OR = [
        { orderNumber: { contains: s, mode: 'insensitive' } },
        { fullName: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
        { phoneNumber: { contains: s, mode: 'insensitive' } },
        { user: { username: { contains: s, mode: 'insensitive' } } },
        { user: { firstName: { contains: s, mode: 'insensitive' } } },
        { user: { lastName: { contains: s, mode: 'insensitive' } } },
        { items: { some: { productName: { contains: s, mode: 'insensitive' } } } },
      ];
    }

    const page = query?.page && query.page > 0 ? Number(query.page) : 1;
    const limit = query?.limit && query.limit > 0 ? Number(query.limit) : 50;
    const skip = (page - 1) * limit;

    const baseWhereForCounts: any = {};
    if (query?.productId) {
      baseWhereForCounts.items = {
        some: {
          productId: Number(query.productId),
        },
      };
    }

    const [orders, total, newOrdersCount, fulfilledOrdersCount] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
              email: true,
              phone: true,
            },
          },
          items: {
            include: {
              product: true,
            },
          },
          returns: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
      prisma.order.count({
        where: {
          ...baseWhereForCounts,
          status: { in: ['ORDERED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'] },
        },
      }),
      prisma.order.count({
        where: {
          ...baseWhereForCounts,
          status: 'DELIVERED',
        },
      }),
    ]);

    return {
      orders,
      total,
      newOrdersCount,
      fulfilledOrdersCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateOrderStatus(orderId: number, status: string) {
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
          },
        },
        items: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    // Normalize status string
    const normalized = status.trim().toUpperCase().replace(/\s+/g, '_');
    const validStatuses = [
      'ORDERED',
      'PROCESSING',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
    ];

    if (!validStatuses.includes(normalized)) {
      throw new BadRequestException(
        `Invalid status: ${status}. Valid options are: ${validStatuses.join(', ')}`,
      );
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: normalized as any,
        updatedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            email: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        returns: true,
      },
    });

    return {
      message: `Order status updated to ${normalized}`,
      order: updatedOrder,
    };
  }
}
