import { createClerkClient } from '@clerk/backend';
import * as argon from 'argon2';
import crypto from 'crypto';
import { generateReferralCode } from '../../src/common/shared/lib';
import { prisma } from "../../src/prisma/prisma";
export enum SubscriptionPlan {
  FREE = "FREE",
  PREMIUM_PRO = "PREMIUM_PRO",
  PREMIUM_PRO_MAX = "PREMIUM_PRO_MAX",
}




export async function seedAll(client: any = prisma) {
  const db = client;
  const users = [
        {
      firstName: "ridwan",
      lastName: "surajudeen",
      email: "ridwan.1095@outlook.com",
      password: "Shortchase@11",
      phone: "+2348012345678",
      username: "ridwanSuraj",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "client",
      referral_code: generateReferralCode("ridwan"),
      profilePicture:"https://cloudflare-b2.shrtchz.workers.dev/Screenshot 2025-07-04 153317.png",
    },
    {
      firstName: "mike",
      lastName: "oketunde",
      email: "michael.5820@outlook.com",
      password: "SF_dev_pass_9872#@!",
      phone: "+2348046573479",
      username: "mikOutlook",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "client",
      referral_code: generateReferralCode("mike"),
      profilePicture:null
    },
    {
      firstName: "Superfan",
      lastName: "Admin",
      email: "superfanng@superfan.ng",
      password: "Shortchase#2019@",
      phone: "+2348098765432",
      username: "odofin",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "superadmin",
      referral_code: generateReferralCode("admin"),
      profilePicture:null
    },{
      firstName: "Samuel",
      lastName: "Clement",
      email:"samuel.7421@outlook.com",
      password: "Shortchase@11",
      phone: "+2349112074341",
      username: "thesamclem01",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "client",
      referral_code: generateReferralCode("samuel"),
      profilePicture:null
    },
    {
      firstName: "Sola",
      lastName: "Sola",
      email: "sola.8519@outlook.com",
      password: "Shortchase@11",
      phone: "+2349012345678",
      username: "soladebayo",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "client",
      referral_code: generateReferralCode("sola"),
      profilePicture:null
    },
  ];

  

  const roles = [
    { name: "client" },
    { name: "superadmin" },
    { name: "subadmin" },
  ];

  const permissions = [
    { id: 1, name: "client", description: "Manage client" },
    { id: 2, name: "q&a", description: "Manage Q&A" },
    { id: 3, name: "podcasts", description: "Manage podcasts" },
    { id: 4, name: "store", description: "Manage stores" },
    { id: 5, name: "livestream", description: "Manage livestreams" },
    { id: 6, name: "quiz", description: "Manage quizzes" },
    { id: 7, name: "advertising", description: "Manage advertising" },
    { id: 8, name: "chatbot", description: "Manage chatbot" },
    { id: 9, name: "users", description: "Manage users" },
    { id: 10, name: "admins", description: "Manage admins" },
    { id: 11, name: "roles", description: "Manage roles" },
    { id: 12, name: "dashboard", description: "View dashboard" },
    { id: 13, name: "payment", description: "Manage payments" },
    { id: 14, name: "analytics", description: "Manage analytics" },
    { id: 29, name: "more", description: "Manage more" },
  ];

  // ✅ Seed roles FIRST
  for (const role of roles) {
    // await prisma.role.upsert({
    //   where: { name: role.name },
    //   update: {},
    //   create: role,
    // });

    const existingRole = await prisma.role.findFirst({
  where: { name: role.name },
});

if (!existingRole) {
  await prisma.role.create({ data: role });
}
  }

  console.log("Roles seeded");

  // ✅ Seed permissions
  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { description: permission.description },
      create: permission,
    });
  }

  console.log("Permissions seeded");

  // ✅ Seed payment processors
  const processors = ["monnify", "flutterwave", "busha"];

  for (const name of processors) {
    const existing = await prisma.paymentProcessor.findFirst({
      where: { name },
    });

    if (!existing) {
      await prisma.paymentProcessor.create({ data: { name } });
    }
  }

  console.log("Payment processors seeded");

  // ✅ Seed users (safe against email/username unique conflicts)
  for (const user of users) {
    const hashedPassword = await argon.hash(user.password);

    const role = await prisma.role.findFirstOrThrow({
      where: { name: user.roleName },
    });

    const existingByEmail = await prisma.user.findUnique({
      where: { email: user.email },
    });
    const existingByUsername = await prisma.user.findUnique({
      where: { username: user.username },
    });

    const existingUser = existingByEmail || existingByUsername;
    const stableReferralCode = existingUser?.referral_code || user.referral_code;

    const sharedUpdate = {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      subscriptionPlan: user.subscriptionPlan,
      roleName: role.name,
      referral_code: stableReferralCode,
      password: hashedPassword,
      profilePicture: user.profilePicture || null,
    };

    let createdUser;

    if (existingByEmail) {
      const usernameTakenByOther =
        existingByUsername && existingByUsername.id !== existingByEmail.id;

      createdUser = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          ...sharedUpdate,
          // Avoid P2002 when username already belongs to a different row.
          ...(usernameTakenByOther ? {} : { username: user.username }),
        },
      });
    } else if (existingByUsername) {
      createdUser = await prisma.user.update({
        where: { id: existingByUsername.id },
        data: {
          ...sharedUpdate,
          email: user.email,
        },
      });
    } else {
      createdUser = await prisma.user.create({
        data: {
          ...sharedUpdate,
          email: user.email,
          username: user.username,
        },
      });
    }

    // ✅ Create wallet for user
    await prisma.wallet.upsert({
      where: { userId: createdUser.id },
      update: {},
      create: {
        userId: createdUser.id,
        balance: 0,
      },
    });
  }

  console.log("Users seeded in DB");

  // ✅ Seed users in Clerk
  const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });

  // Helper to generate a random strong password (base64 + symbols) that avoids pwned lists.
  function generateSafePassword(): string {
    // 12 random bytes => 16 base64 chars, then remove URL‑unsafe chars and append extra symbols.
    const raw = crypto.randomBytes(12).toString('base64');
    const sanitized = raw.replace(/[+/=]/g, '');
    // Ensure we have at least 12 characters and add a symbol/number for extra strength.
    return `${sanitized}!A1`;
  }

  for (const user of users) {
    try {
      const clerkUsers = await clerkClient.users.getUserList({ emailAddress: [user.email] });
      const existingClerkUser = clerkUsers?.data?.[0] || clerkUsers?.[0];
      const clerkPassword = user.password;
      if (existingClerkUser) {
        // Update Clerk user with the configured password.
        await clerkClient.users.updateUser(existingClerkUser.id, { password: clerkPassword });
        console.log(`Updated Clerk password for ${user.email}`);
      } else {
        // Create Clerk user with the configured password.
        await clerkClient.users.createUser({
          emailAddress: [user.email],
          password: clerkPassword,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
        });
        console.log(`Created Clerk user for ${user.email}`);
      }
    } catch (e) {
      console.error(`Error syncing ${user.email} to Clerk:`, e);
    }
  }
  console.log('✅ All seeded users have been synced to Clerk');

  // ✅ Seed Stream, Stream Comments, Nested Replies, and Live Quiz
  const adminUser = await prisma.user.findFirst({
    where: { roleName: 'superadmin' },
  });
  const clientUser = await prisma.user.findFirst({
    where: { roleName: 'client' },
  });

  if (adminUser && clientUser) {
    // 1. Seed Stream
    const stream = await prisma.stream.upsert({
      where: { id: 1 },
      update: {
        title: "Superfan Live Yoruba & General Knowledge Quiz",
        status: "live",
        isActive: true,
      },
      create: {
        id: 1,
        userId: adminUser.id,
        title: "Superfan Live Yoruba & General Knowledge Quiz",
        description: "Join our weekly interactive stream to answer questions live and win prizes!",
        privacyStatus: "public",
        networkPlatform: "youtube",
        broadcastId: "sample_broadcast_001",
        streamUrl: "https://www.youtube.com/watch?v=sample_live",
        status: "live",
        category: "quiz",
        isActive: true,
      },
    });
    console.log("✅ Seeded Stream (ID: 1)");

    // 2. Seed Stream Comments & Nested Replies
    const rootComment1 = await prisma.streamComment.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        streamId: stream.id,
        userId: clientUser.id,
        message: "Hello everyone! Ready for the live quiz show!",
        depth: 0,
        isDeleted: false,
        likesCount: 5,
      },
    });

    const replyComment1 = await prisma.streamComment.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        streamId: stream.id,
        userId: adminUser.id,
        parentId: rootComment1.id,
        rootId: rootComment1.id,
        replyToUserId: clientUser.id,
        message: "Welcome! The quiz is about to start in 2 minutes.",
        depth: 1,
        isDeleted: false,
        likesCount: 3,
      },
    });

    await prisma.streamComment.upsert({
      where: { id: 3 },
      update: {},
      create: {
        id: 3,
        streamId: stream.id,
        userId: clientUser.id,
        parentId: replyComment1.id,
        rootId: rootComment1.id,
        replyToUserId: adminUser.id,
        message: "Awesome! Locking in my answers.",
        depth: 2,
        isDeleted: false,
        likesCount: 1,
      },
    });
    console.log("✅ Seeded Stream Comments & Nested Replies");

    // 3. Seed Ongoing Live Quiz
    const liveQuiz = await prisma.ongoingLiveQuiz.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        userId: String(adminUser.id),
        quizIds: ["QUIZ_YORUBA_001"],
        streamId: stream.id,
        questions: [
          {
            id: "q1",
            question: "What is the capital of Lagos State?",
            options: ["Ikeja", "Lekki", "Badagry", "Epe"],
            correctAnswer: "Ikeja",
          },
          {
            id: "q2",
            question: "Translate 'Good morning' in Yoruba:",
            options: ["E kaaro", "E kaasan", "E ku ale", "O dababo"],
            correctAnswer: "E kaaro",
          },
        ],
        totalEarning: 5000,
        completed: false,
      },
    });
    console.log("✅ Seeded Ongoing Live Quiz");

    // 4. Seed Live Quiz Attempt & Leaderboard
    await prisma.liveQuizAttempt.upsert({
      where: {
        userId_quizId: {
          userId: String(clientUser.id),
          quizId: "QUIZ_YORUBA_001",
        },
      },
      update: {},
      create: {
        userId: String(clientUser.id),
        quizId: "QUIZ_YORUBA_001",
        ongoingLiveQuizId: liveQuiz.id,
        totalPrize: 5000,
        recipients: 10,
        unitPrize: 500,
        earning: 500,
        isWinner: true,
        isCompleted: true,
      },
    });

    const existingLeaderboard = await prisma.liveQuizLeaderboard.findFirst({
      where: {
        userId: String(clientUser.id),
        quizId: "QUIZ_YORUBA_001",
      },
    });

    if (!existingLeaderboard) {
      await prisma.liveQuizLeaderboard.create({
        data: {
          userId: String(clientUser.id),
          quizId: "QUIZ_YORUBA_001",
          question: "What is the capital of Lagos State?",
          answer: "Ikeja",
          rewardType: "LIVE_QUIZ",
          isWinner: true,
          participants: 10,
          unitPrize: 500,
          rewardStatus: "paid",
          quizDate: new Date(),
        },
      });
    }
    console.log("✅ Seeded Live Quiz Attempt & Leaderboard");
  }

}

// ✅ Run when executed directly
if (typeof require !== 'undefined' && require.main === module) {
  seedAll()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
} else if (!process.env.NEST_APP_INIT) {
  seedAll()
    .catch((e) => {
      console.error(e);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
