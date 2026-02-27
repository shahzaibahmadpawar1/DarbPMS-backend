const { Client } = require('pg');

const DATABASE_URL = 'postgresql://postgres.wonhshkznusonptzhhvw:kaiKzO6avegDp8gi@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

async function migrate() {
    const client = new Client({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to database');

        // 1. Update UserRole constraint
        console.log('Updating user role constraint...');
        await client.query(`
            ALTER TABLE users 
            DROP CONSTRAINT IF EXISTS users_role_check;
            
            ALTER TABLE users 
            ADD CONSTRAINT users_role_check 
            CHECK (role IN ('admin', 'user', 'ceo'));
        `);

        // 2. Add review status columns to investment_projects
        console.log('Adding review status columns to investment_projects...');
        await client.query(`
            ALTER TABLE investment_projects 
            ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'Pending Review'
            CHECK (review_status IN ('Pending Review', 'Validated', 'Approved', 'Rejected')),
            ADD COLUMN IF NOT EXISTS pm_comment TEXT,
            ADD COLUMN IF NOT EXISTS ceo_comment TEXT;
        `);

        // 3. Create CEO user if not exists
        console.log('Creating CEO user...');
        const ceoExists = await client.query("SELECT id FROM users WHERE username = 'ceo'");
        if (ceoExists.rows.length === 0) {
            await client.query(`
                INSERT INTO users (username, password, role) 
                VALUES ('ceo', '123456', 'ceo')
            `);
            console.log('CEO user created');
        } else {
            await client.query(`
                UPDATE users SET password = '123456', role = 'ceo' WHERE username = 'ceo'
            `);
            console.log('CEO user updated');
        }

        console.log('Migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await client.end();
    }
}

migrate();
