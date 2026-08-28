#!/bin/sh
set -e

echo "Waiting for database to be ready..."

# Wait for PostgreSQL to be available
# Using DATABASE_URL from environment, extract host and port
DB_HOST=$(echo $DATABASE_URL | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's|.*:\([0-9]*\)/.*|\1|p')

if [ -z "$DB_HOST" ]; then
  DB_HOST="localhost"
fi

if [ -z "$DB_PORT" ]; then
  DB_PORT="5432"
fi

# Wait for PostgreSQL max 60 seconds
echo "Waiting for PostgreSQL at $DB_HOST:$DB_PORT..."
for i in $(seq 1 60); do
  if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null || (echo > /dev/tcp/"$DB_HOST"/"$DB_PORT") 2>/dev/null; then
    echo "PostgreSQL is ready!"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "PostgreSQL did not become ready in time"
    exit 1
  fi
  sleep 1
done

echo "Synchronizing Prisma schema tables..."
npx prisma db push --accept-data-loss

echo "Schema sync completed successfully!"

echo "Running database seed..."
npx tsx prisma/seed/seed.ts || echo "Warning: Seed script failed or tsx is not available."

# Execute the main command
exec "$@"