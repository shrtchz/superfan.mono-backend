# Step 1: Build stage
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Step 2: Development stage (with hot-reload support)
FROM golang:1.25-alpine AS dev

RUN apk add --no-cache tzdata

WORKDIR /app

RUN go install github.com/air-verse/air@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .

CMD ["air"]

# Step 3: Production stage
FROM alpine:latest AS production

# tzdata required for time.LoadLocation("Africa/Lagos") used by quiz sessions
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /root/

COPY --from=builder /app/main .
COPY --from=builder /app/.env* ./

EXPOSE 7190

CMD ["./main"]
