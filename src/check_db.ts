import pool from './config/database';

async function check() {
    try {
        const result = await pool.query(`
            SELECT conname, pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conrelid = 'users'::regclass;
        `);
        console.log('Constraints on users:', JSON.stringify(result.rows, null, 2));

        const cols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'investment_projects';
        `);
        console.log('Columns on investment_projects:', JSON.stringify(cols.rows, null, 2));

        process.exit(0);
    } catch (error: any) {
        console.error('Check failed:', error.message, error);
        process.exit(1);
    }
}

check();
