# ==========================================
# STAGE 1: GO SERVICE STAGES
# ==========================================
 
# Go Builder
FROM golang:1.25-alpine AS go-builder
RUN apk add --no-cache git
WORKDIR /app
COPY superfan.go/go.mod superfan.go/go.sum ./
RUN go mod download
COPY superfan.go/ .
COPY lables.data.json ./lables.data.json
RUN CGO_ENABLED=0 GOOS=linux go build -o main .
 
# Go Development stage
FROM golang:1.25-alpine AS go-dev
WORKDIR /app
RUN go install github.com/air-verse/air@v1.61.7
COPY superfan.go/go.mod superfan.go/go.sum ./
RUN go mod download
COPY superfan.go/ .
COPY lables.data.json ./lables.data.json
CMD ["air"]
 
# Go Production stage (Target name: go-production)
FROM alpine:latest AS go-production
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=go-builder /app/main .
COPY --from=go-builder /app/lables.data.json ./lables.data.json
COPY --from=go-builder /app/.env* ./
EXPOSE 7190
CMD ["./main"]
 
 
# ==========================================
# STAGE 2: NESTJS SERVICE STAGES
# ==========================================
 
# Base Nest
FROM node:20-alpine AS nest-base
WORKDIR /app
RUN npm install -g pnpm
 
# Nest Dependencies
FROM nest-base AS nest-deps
WORKDIR /app
COPY superfan.nest/package.json superfan.nest/pnpm-lock.yaml ./
COPY superfan.nest/prisma ./prisma
RUN pnpm install --no-frozen-lockfile
 
# Nest Build
FROM nest-deps AS nest-build
WORKDIR /app
COPY superfan.nest/ .
# Create dummy credentials.json if missing to satisfy TypeScript compilation
RUN [ -f credentials.json ] || echo '{"web":{"client_id":"dummy","client_secret":"dummy","redirect_uris":["http://localhost:3000"]}}' > credentials.json
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN pnpm prisma generate
RUN pnpm build
 
# Nest Production stage (Target name: nest-production)
FROM node:22-slim AS nest-production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=nest-build /app/package.json ./
COPY --from=nest-build /app/node_modules ./node_modules
COPY --from=nest-build /app/dist ./dist
COPY --from=nest-build /app/prisma ./prisma
COPY --from=nest-build /app/src/mail/templates ./dist/src/mail/templates
CMD ["node", "dist/src/main.js"]