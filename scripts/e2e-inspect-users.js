require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const result = await client.query("SELECT username, role, department, user_type, status, LEFT(password, 8) AS pass_prefix FROM users WHERE username LIKE 'e2e_%' ORDER BY username");
  console.log(result.rows);
  await client.end();
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
