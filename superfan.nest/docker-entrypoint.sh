#!/bin/sh
set -e

for env_file in /etc/secrets/.env /etc/secrets/env /app/.env /app/env; do
  if [ -f "$env_file" ]; then
    set -a
    . "$env_file"
    set +a
    break
  fi
done

DATABASE_URL="${DATABASE_URL:-${PROD_DB_URL:-}}"
export DATABASE_URL

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL (or PROD_DB_URL) must be configured before starting the API." >&2
  exit 1
fi

echo "Waiting for database to be ready..."

# Wait for PostgreSQL to be available using Node.js connection check
node -e '
const net = require("net");
const url = process.env.DATABASE_URL;
let host = "localhost", port = 5432;
try {
  const u = new URL(url);
  host = u.hostname || "localhost";
  port = parseInt(u.port || "5432", 10);
} catch (e) {
  console.warn("Could not parse DATABASE_URL, skipping wait:", e.message);
  process.exit(0);
}
console.log("Waiting for PostgreSQL at " + host + ":" + port + "...");
let attempts = 0;
function tryConnect() {
  attempts++;
  const s = net.createConnection({ host, port, timeout: 3000 }, () => {
    console.log("PostgreSQL is ready!");
    s.destroy();
    process.exit(0);
  });
  s.on("error", (err) => {
    s.destroy();
    if (attempts >= 30) {
      console.error("PostgreSQL did not become ready in time (" + err.message + ")");
      process.exit(1);
    }
    setTimeout(tryConnect, 1000);
  });
  s.on("timeout", () => {
    s.destroy();
    if (attempts >= 30) {
      console.error("PostgreSQL connection timed out.");
      process.exit(1);
    }
    setTimeout(tryConnect, 1000);
  });
}
tryConnect();
'

echo "Synchronizing Prisma schema tables..."
npx prisma db push --schema=prisma/schema/schema.prisma --accept-data-loss

echo "Schema sync completed successfully!"

echo "Running database seed..."
npx tsx prisma/seed/seed.ts || echo "Warning: Seed script failed or tsx is not available."

# Execute the main command
exec "$@"