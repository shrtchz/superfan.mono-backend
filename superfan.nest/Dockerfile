# Base
FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

# Dependencies
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --no-frozen-lockfile

# Build
FROM deps AS build
WORKDIR /app

COPY . .

# Create dummy credentials.json if missing to satisfy TypeScript compilation
RUN [ -f credentials.json ] || echo '{"web":{"client_id":"dummy","client_secret":"dummy","redirect_uris":["http://localhost:3000"]}}' > credentials.json

ENV DATABASE_URL="postgresql://1TdILekB7Rc5:cZei5SOTDSNA5yQsM1bxMBjXu@marine-ship.igris.cloud:14999/pipeops"

ENV NODE_OPTIONS="--max-old-space-size=4096"

# Apply existing migrations safely
RUN pnpm prisma migrate deploy


# Generate Prisma Client
RUN pnpm prisma generate
# Build NestJS
RUN pnpm build

# Production
FROM node:22-slim AS production
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://1TdILekB7Rc5:cZei5SOTDSNA5yQsM1bxMBjXu@marine-ship.igris.cloud:14999/pipeops"

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src/mail/templates ./dist/src/mail/templates

CMD ["node", "dist/src/main.js"]

# CMD sh -c "pnpm prisma migrate deploy && node dist/src/main.js"