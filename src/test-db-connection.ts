import pool from './config/database';

async function testDatabaseConnection() {
    console.log('Testing database connection...\n');

    try {
        // Test basic connection
        const [result]: any = await pool.query('SELECT NOW() as current_time, VERSION() as mysql_version');

        console.log('✓ Database connection successful!');
        console.log('Current time:', result[0].current_time);
        console.log('MySQL version:', result[0].mysql_version);

        // Test if users table exists
        const [tableCheck]: any = await pool.query(`
      SELECT COUNT(*) as table_exists
      FROM information_schema.tables 
      WHERE table_schema = DATABASE()
      AND table_name = 'users'
    `);

        if (tableCheck[0].table_exists > 0) {
            console.log('✓ Users table exists');

            // Get user count
            const [countResult]: any = await pool.query('SELECT COUNT(*) as count FROM users');
            console.log(`✓ Current user count: ${countResult[0].count}`);
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
