// require('dotenv').config();
// import { PrismaPg } from "@prisma/adapter-pg";
// import { withAccelerate } from "@prisma/extension-accelerate";
// import { PrismaClient } from "../src/generated/prisma/client.js";
// import { DATABASE_URL } from "../config/index.js";

// export const prisma = new PrismaClient({
//   accelerateUrl: DATABASE_URL as string
// }).$extends(withAccelerate());
// // import { PrismaClient } from '@prisma/client';
// // import { PrismaClient } from "../../src/config/database/generated";
// // 
// const connectionString = process.env.DATABASE_URL;

// if(!connectionString) {
//     throw new Error('DATABASE_URL environment variable is not set');
// }

// const adapter = new PrismaPg({
//     connectionString,
// })

// // export const prisma = new PrismaClient({ adapter });