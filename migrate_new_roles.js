// Migration: Add investment_user and franchise_user roles
// Run: node migrate_new_roles.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Running migration: add new roles...');

        // Drop the existing CHECK constraint and recreate with new roles
        await client.query(`
            ALTER TABLE users
            DROP CONSTRAINT IF EXISTS users_role_check;
        `);

        await client.query(`
            ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('admin', 'user', 'ceo', 'investment_user', 'franchise_user'));
        `);

        console.log('✓ Role constraint updated to include: admin, user, ceo, investment_user, franchise_user');
        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
