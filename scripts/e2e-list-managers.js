require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const result = await client.query(`
    SELECT department, username, role, created_at
    FROM users
    WHERE role = 'department_manager'
    ORDER BY department, created_at ASC
  `);
  console.log(result.rows);
  await client.end();
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
