require('dotenv').config();
const { Client } = require('pg');

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const users = [
    ['e2e_super_admin', 'Pass123!', 'super_admin', null, 'internal', 'active'],
    ['e2e_project_manager', 'Pass123!', 'department_manager', 'project', 'internal', 'active'],
    ['e2e_project_employee', 'Pass123!', 'employee', 'project', 'internal', 'active'],
    ['e2e_quality_manager', 'Pass123!', 'department_manager', 'quality', 'internal', 'active'],
    ['e2e_quality_employee', 'Pass123!', 'employee', 'quality', 'internal', 'active'],
    ['e2e_requester', 'Pass123!', 'employee', 'finance', 'internal', 'active'],
  ];

  for (const [username, password, role, department, userType, status] of users) {
    await client.query(
      'INSERT INTO users (username, password, role, department, user_type, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, department = EXCLUDED.department, user_type = EXCLUDED.user_type, status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP',
      [username, password, role, department, userType, status],
    );
  }

  const stations = [
    ['E2E-ST-001', 'E2E Station 001', 'Riyadh', 'North', 'operation', 'Active'],
    ['E2E-ST-002', 'E2E Station 002', 'Riyadh', 'East', 'operation', 'Active'],
  ];

  for (const station of stations) {
    await client.query(
      'INSERT INTO station_information (station_code, station_name, city, district, station_type_code, station_status_code) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (station_code) DO UPDATE SET station_name = EXCLUDED.station_name, updated_at = CURRENT_TIMESTAMP',
      station,
    );
  }

  await client.end();
  console.log('Seeded users and stations.');
}

seed().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
