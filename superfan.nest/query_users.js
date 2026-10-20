const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://lXUKutUgQqE2:nrzDNjAUgT4kb3WrVRNAzHGKu@sea-train.igris.cloud:14223/pipeops'
});

async function main() {
  await client.connect();
  const res = await client.query('SELECT id, email, username, login_method FROM "User"');
  console.log("Registered Users in Database:");
  console.dir(res.rows, { depth: null });
  await client.end();
}

main().catch(console.error);
