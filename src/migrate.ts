import pool from './config/database';

async function migrate() {
    try {
        console.log('Connected to database');

        // 1. Update UserRole constraint
        console.log('Updating user role constraint...');
        try {
            await pool.query(`
                ALTER TABLE users 
                DROP CONSTRAINT IF EXISTS users_role_check;
            `);
            await pool.query(`
                ALTER TABLE users 
                ADD CONSTRAINT users_role_check 
                CHECK (role IN ('admin', 'user', 'ceo'));
            `);
        } catch (e: any) {
            console.error('Failed at Step 1:', e.message, e);
        }

        // 2. Add review status columns to investment_projects
        console.log('Adding review status columns to investment_projects...');
        try {
            await pool.query(`
                ALTER TABLE investment_projects 
                ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'Pending Review'
                CHECK (review_status IN ('Pending Review', 'Validated', 'Approved', 'Rejected')),
                ADD COLUMN IF NOT EXISTS pm_comment TEXT,
                ADD COLUMN IF NOT EXISTS ceo_comment TEXT;
            `);
        } catch (e: any) {
            console.error('Failed at Step 2:', e.message, e);
        }

        // 3. Create CEO user if not exists
        console.log('Creating CEO user...');
        const ceoExists = await pool.query("SELECT id FROM users WHERE username = 'ceo'");
        if (ceoExists.rows.length === 0) {
            await pool.query(`
                INSERT INTO users (username, password, role) 
                VALUES ('ceo', '123456', 'ceo')
            `);
            console.log('CEO user created');
        } else {
            await pool.query(`
                UPDATE users SET password = '123456', role = 'ceo' WHERE username = 'ceo'
            `);
            console.log('CEO user updated');
        }

        console.log('Migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
