import * as argon from 'argon2';
import { generateReferralCode } from '../../src/common/shared/lib';
import { prisma } from "../../src/prisma/prisma";
import { createClerkClient } from '@clerk/backend';
export enum SubscriptionPlan {
  FREE = "FREE",
  PREMIUM_PRO = "PREMIUM_PRO",
  PREMIUM_PRO_MAX = "PREMIUM_PRO_MAX",
}



async function seedAll() {
  const users = [
        {
      firstName: "ridwan",
      lastName: "surajudeen",
      email: "ridwan.1095@outlook.com",
      password: "Password@1234#",
      phone: "+2348012345678",
      username: "ridwanSuraj",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "client",
      referral_code: generateReferralCode("ridwan"),
    },
    {
      firstName: "mike",
      lastName: "oketunde",
      email: "michael.5820@outlook.com",
      password: "Password@1234#",
      phone: "+2348046573479",
      username: "mikOutlook",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "client",
      referral_code: generateReferralCode("mike"),
    },
    {
      firstName: "admin",
      lastName: "user",
      email: "superfanng@superfan.ng",
      password: "Password@1234#",
      phone: "+2348098765432",
      username: "adminUser",
      subscriptionPlan: SubscriptionPlan.FREE,
      roleName: "superadmin",
      referral_code: generateReferralCode("admin"),
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

  // ✅ Seed users
  for (const user of users) {
    const hashedPassword = await argon.hash(user.password);

    const role = await prisma.role.findFirstOrThrow({
      where: { name: user.roleName },
    });

    const createdUser = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        username: user.username,
        subscriptionPlan: user.subscriptionPlan,
        roleName: role.name, // safer
        referral_code: user.referral_code,
      },
      create: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        password: hashedPassword,
        phone: user.phone,
        username: user.username,
        subscriptionPlan: user.subscriptionPlan,
        roleName: role.name,
        referral_code: user.referral_code,
      },
    });

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
    secretKey: process.env.CLERK_SECRET_KEY || 'sk_test_TDksIODSXIqyFJlTThO6q7E6fxwCk68q9MXHjIp9sN',
  });

  for (const user of users) {
    try {
      const clerkUsers = await clerkClient.users.getUserList({ emailAddress: [user.email] });
      const existingClerkUser = clerkUsers?.data?.[0] || clerkUsers?.[0];
      if (existingClerkUser) {
        await clerkClient.users.updateUser(existingClerkUser.id, { password: user.password });
        console.log(`Updated Clerk password for ${user.email}`);
      } else {
        await clerkClient.users.createUser({
          emailAddress: [user.email],
          password: user.password,
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
}

// ✅ Run everything
seedAll()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });