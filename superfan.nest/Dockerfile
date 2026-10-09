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

ENV PRISMA_MIGRATE_LOCK_TIMEOUT=60000
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# Generate Prisma Client
RUN pnpm prisma generate

# Build NestJS
RUN pnpm build

# Copy migration and startup scripts
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Production
FROM node:22-slim AS production
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/src/mail/templates ./dist/src/mail/templates
COPY --from=build /app/lables.data.json ./lables.data.json
COPY --from=build /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Use entrypoint script to run migrations before starting the app
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
