# Prisma Minimal Reproduction

A minimal reproduction of the Prisma ORM setup from the Montem backend. This repository contains only the essential infrastructure code for Prisma with NestJS, including Redis and BullMQ integration.

## Tech Stack

- **Framework**: NestJS 11 with TypeScript
- **Database**: PostgreSQL 16 with Prisma ORM 7.0.1
- **Cache/Queue**: Redis with BullMQ
- **Prisma Adapter**: @prisma/adapter-pg (node-postgres driver)

## Key Features

- Split-schema architecture (multiple `.prisma` files)
- Custom Prisma client output location
- PostgreSQL adapter with connection pooling
- Redis caching and BullMQ job queues
- Simple User CRUD to demonstrate Prisma usage

## Project Structure

```
prisma-minimal-repro/
├── prisma/
│   └── schema/
│       ├── schema.prisma    # Generator and datasource config
│       └── user.prisma      # User model
├── src/
│   ├── config/
│   │   ├── database/        # Prisma service and module
│   │   └── redis/           # Redis configuration
│   ├── user/                # Example User module
│   ├── app.module.ts
│   └── main.ts
├── docker-compose.yml       # PostgreSQL + Redis
├── prisma.config.ts         # Prisma configuration
└── package.json
```

## Quick Start

### 1. Start Infrastructure

```bash
docker-compose up -d
```

### 2. Install Dependencies

```bash
pnpm i install
```

This will automatically run `prisma generate` via the postinstall hook.

### 3. Run Migrations

```bash
npx prisma migrate dev --name init
```

### 4. Start the Server

```bash
pnpm run dev
```

The API will be available at http://localhost:3000

- Swagger docs: http://localhost:3000/api
- Health check: http://localhost:3000/health

## Common Commands

```bash
# Generate Prisma client
npx prisma generate

# Create a new migration
npx prisma migrate dev --name <migration_name>

# Apply migrations (production)
npx prisma migrate deploy

# Open Prisma Studio (GUI)
npx prisma studio

# Run tests
yarn test

# Type checking
yarn typecheck
```

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `DATABASE_URL` | PostgreSQL connection string | postgresql://postgres:password@localhost:5432/prisma_repro |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |

## Prisma Configuration Notes

### Split Schema Architecture

The Prisma schema is split across multiple files in `prisma/schema/`:
- `schema.prisma`: Generator and datasource configuration
- `user.prisma`: User model definition

### Custom Output Location

The Prisma client is generated to `src/config/database/generated/` for easy importing:

```typescript
import { PrismaClient } from './config/database';
```

### PostgreSQL Adapter

Uses `@prisma/adapter-pg` with the native `pg` driver for connection management:

```typescript
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });
```

render-deployment command
./deploy.sh