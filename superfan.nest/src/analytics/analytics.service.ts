import { Injectable } from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { WalletService } from '../wallet/wallet.service';


@Injectable()
export class AnalyticsService {
  constructor(private walletService: WalletService) {}

  async fetchAdminAndInviteStats() {
    try {
      const now = new Date();

      // Start of today
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      // Last 7 days
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - 7);

      // Run all queries in parallel 🚀
      const [
        totalAdmins,
        newAdminsThisWeek,
        totalInvites,
        invitesThisWeek,
        invitesToday,
        totalClients,
        newClientsToday,
      ] = await Promise.all([
        // ✅ Admins (superadmin + subadmin)
        prisma.user.count({
          where: {
            roleName: { in: ['subadmin'] },
            active: true,
          },
        }),
        prisma.user.count({
          where: {
            roleName: { in: ['subadmin'] },
            active: true,
            createdAt: { gte: startOfWeek },
          },
        }),

        // ✅ Invites
        prisma.subAdminInvite.count(),
        prisma.subAdminInvite.count({
          where: { createdAt: { gte: startOfWeek } },
        }),
        prisma.subAdminInvite.count({
          where: { createdAt: { gte: startOfToday } },
        }),

        // ✅ Clients
        prisma.user.count({
          where: { roleName: 'client', active: true },
        }),
        prisma.user.count({
          where: {
            roleName: 'client',
            active: true,
            createdAt: { gte: startOfToday },
          },
        }),
      ]);

      return {
        admins: {
          total: totalAdmins,
          weeklyChange: `+${newAdminsThisWeek} this week`,
        },
        invites: {
          total: totalInvites,
          weeklyChange: `+${invitesThisWeek} this week`,
          today: `${invitesToday} sent today`,
        },
        clients: {
          total: totalClients,
          dailyChange: `+${newClientsToday} today`,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  async fetchTotalClients() {
    try {
      const now = new Date();

      // start of today
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      // total clients
      const totalClients = await prisma.user.count({
        where: {
          roleName: 'client',
          active: true,
        },
      });

      // clients created today
      const newClientsToday = await prisma.user.count({
        where: {
          roleName: 'client',
          active: true,
          createdAt: {
            gte: startOfToday,
          },
        },
      });

      return {
        totalClients,
        dailyChange: `+${newClientsToday} today`,
      };
    } catch (error) {
      throw error;
    }
  }

  async fetchAnalytics() {
    try {
      const now = new Date();

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const totalUsers = await prisma.user.count();

      const activeUsers = await prisma.user.count({
        where: {
          active: true,
          isBanned: false,
        },
      });

      const newUsersToday = await prisma.user.count({
        where: {
          createdAt: {
            gte: startOfToday,
          },
        },
      });

      const bannedUsers = await prisma.user.count({
        where: {
          isBanned: true,
        },
      });

      // FIRST USER DATE
      const firstUser = await prisma.user.findFirst({
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          createdAt: true,
        },
      });

      let averageDailyUsers = 0;

      if (firstUser) {
        const diffTime = now.getTime() - firstUser.createdAt.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        averageDailyUsers = totalUsers / diffDays;
      }

      const usersByCountry = await prisma.user.groupBy({
        by: ['country'],
        _count: {
          country: true,
        },
      });

      const usersByState = await prisma.user.groupBy({
        by: ['address'],
        _count: {
          address: true,
        },
      });

      return {
        quickStats: {
          totalUsers,
          activeUsers,
          newUsersToday,
          bannedUsers,
          averageDailyUsers: Number(averageDailyUsers.toFixed(2)),
        },

        locationByCountry: usersByCountry.map((item) => ({
          country: item.country,
          count: item._count.country,
        })),

        locationByState: usersByState.map((item) => ({
          state: item.address,
          count: item._count.address,
        })),

        lastUpdated: now,
      };
    } catch (error) {
      throw error;
    }
  }

  async fetchAverageUsers() {
    const now = new Date();

    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const totalUsers = await prisma.user.count();

    const firstUser = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    if (!firstUser) {
      return {
        dailyAverage: 0,
        monthlyAverage: 0,
        yearlyAverage: 0,
      };
    }

    const daysDiff =
      (now.getTime() - firstUser.createdAt.getTime()) / (1000 * 60 * 60 * 24);

    const monthsDiff =
      (now.getFullYear() - firstUser.createdAt.getFullYear()) * 12 +
      (now.getMonth() - firstUser.createdAt.getMonth()) +
      1;

    const yearsDiff = now.getFullYear() - firstUser.createdAt.getFullYear() + 1;

    const dailyAverage = totalUsers / daysDiff;
    const monthlyAverage = totalUsers / monthsDiff;
    const yearlyAverage = totalUsers / yearsDiff;

    return {
      dailyAverageUsers: Number(dailyAverage.toFixed(2)),
      monthlyAverageUsers: Number(monthlyAverage.toFixed(2)),
      yearlyAverageUsers: Number(yearlyAverage.toFixed(2)),
    };
  }

  async fetchUsersByCountry() {
    try {
      const usersByCountry = await prisma.user.groupBy({
        by: ['country'],
        _count: {
          country: true,
        },
      });

      return usersByCountry.map((item) => ({
        country: item.country,
        count: item._count.country,
      }));
    } catch (error) {
      throw error;
    }
  }

  async fetchUsersByState() {
    try {
      const usersByState = await prisma.user.groupBy({
        by: ['state'],
        _count: {
          state: true,
        },
      });

      return usersByState.map((item) => ({
        state: item.state,
        count: item._count.state,
      }));
    } catch (error) {
      throw error;
    }
  }

    async getRevenueAnalytics() {
    return {
      daily: 0,
      weekly: 0,
      monthly: 0,
      quarterly: 0,
      yearly: 0,
      gross_revenue: 0,
      total_expenses: 0,
      net_revenue: 0,
      profit_margin: 0.00,
      referral_bonuses: 0,
      ads_rewards: 0,
      quiz_rewards: 0
    };
  }

    // Reset revenue
  async resetRevenue() {
    // If you have a revenue table, reset all values in DB
    // Example using Prisma (pseudo code):
    // await prisma.revenue.updateMany({ data: { amount: 0 } });

    // For now, just return 0 values
    return {
      daily: 0,
      weekly: 0,
      monthly: 0,
      quarterly: 0,
      yearly: 0,
      gross_revenue: 0,
      total_expenses: 0,
      net_revenue: 0,
      profit_margin: 0.00,
      referral_bonuses: 0,
      ads_rewards: 0,
      quiz_rewards: 0
    };
  }

  async getReferralsAnalytics(userId: number) {
    try {
      // Total referrals made by the user (where user is referrer)
      const totalReferrals = await prisma.referral.count({
        where: {
          referrerId: userId,
        },
      });

      // Total earned from referrals (sum of all referral rewards for the user that are available or paid out)
      const referralRewards = await prisma.reward.findFirst({
        where: {
          userId: userId,
          status: {
            in: ['AVAILABLE', 'PAID_OUT'],
          },
        },

      });

      const totalEarned = referralRewards.amount || 0;

      // Pending referrals (referrals made by user that haven't reached FIRST_TEST_COMPLETED status)
      const pendingReferrals = await prisma.referral.count({
        where: {
          referrerId: userId,
          status: {
            not: 'FIRST_TEST_COMPLETED',
          },
        },
      });

      // Average per referral
      const averagePerReferral = totalReferrals > 0 ? Number((totalEarned / totalReferrals).toFixed(2)) : 0;

      return {
        totalReferrals,
        totalEarned,
        pendingReferrals,
        averagePerReferral,
      };
    } catch (error) {
      throw error;
    }
  }
  

  async getfullwalletSummaryPerClient(userId: number) {
    try {
      // Fetch all wallet transactions for the user
      const transactions = await prisma.walletTransaction.findMany({
        where: { userId },
        select: {
          amount: true,
          type: true,
          account_type: true,
          payment_method: true,
          description: true,
          createdAt: true,
        },
      });

      // Calculate balances
      const gold_balance = transactions
        .filter(tx => tx.type === 'credit' && (tx.account_type === 'Gold' || tx.account_type == null))
        .reduce((sum, tx) => sum + tx.amount, 0);

      const personal_balance = transactions
        .filter(tx => tx.type === 'credit' && tx.account_type === 'Personal')
        .reduce((sum, tx) => sum + tx.amount, 0);

      const wallet_balance = gold_balance + personal_balance;

      // Total deposits: sum of credits from monnify_deposit, flutterwave_card, busha_stablecoin
      const depositMethods = ['monnify_deposit', 'flutterwave_card', 'busha_stablecoin'];
      const total_deposits = transactions
        .filter(tx => tx.type === 'credit' && depositMethods.includes(tx.payment_method || ''))
        .reduce((sum, tx) => sum + tx.amount, 0);

      // Total earnings: sum of gold account credits that are rewards/bonuses/quiz earnings
      const total_earnings = transactions
        .filter(tx => tx.type === 'CREDIT' && (tx.account_type === 'Gold' || tx.account_type == null) && 
                     (tx.description?.includes('Reward') || tx.description?.includes('Earned')))
        .reduce((sum, tx) => sum + tx.amount, 0);

      // Total withdrawals: sum of all debits across both sub-accounts
      const total_withdrawals = transactions
        .filter(tx => tx.type === 'DEBIT')
        .reduce((sum, tx) => sum + tx.amount, 0);

      // Currencies used: for now, assume NGN, but could be extended
      const currencies_used = ['NGN'];

      // Last activity date: latest transaction date
      const last_activity_date = transactions.length > 0 
        ? transactions.reduce((latest, tx) => tx.createdAt > latest ? tx.createdAt : latest, transactions[0].createdAt)
        : null;

      return {
        gold_balance,
        personal_balance,
        wallet_balance,
        account_type: 'Gold', // Assuming this summary is for Gold account as per platform-earned
        total_deposits,
        total_earnings,
        total_withdrawals,
        currencies_used,
        last_activity_date,
      };
    } catch (error) {
      throw error;
    }
  }
}