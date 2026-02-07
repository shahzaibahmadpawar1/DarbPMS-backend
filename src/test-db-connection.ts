import pool from './config/database';

async function testDatabaseConnection() {
    console.log('Testing database connection...\n');

    try {
        // Test basic connection
        const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');

        console.log('✓ Database connection successful!');
        console.log('Current time:', result.rows[0].current_time);
        console.log('PostgreSQL version:', result.rows[0].pg_version);

        // Test if users table exists
        const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);

        if (tableCheck.rows[0].exists) {
            console.log('✓ Users table exists');

            // Get user count
            const countResult = await pool.query('SELECT COUNT(*) as count FROM users');
            console.log(`✓ Current user count: ${countResult.rows[0].count}`);
        } else {
            console.log('⚠ Users table does not exist. Please run the schema.sql file.');
        }

        await pool.end();
        console.log('\n✓ Database connection closed successfully');
        process.exit(0);
    } catch (error: any) {
        console.error('✗ Database connection failed:');
        console.error(error.message);
        process.exit(1);
    }
}

testDatabaseConnection();
