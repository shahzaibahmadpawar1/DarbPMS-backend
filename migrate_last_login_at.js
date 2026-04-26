// Migration: Add last_login_at column to users
// Run: node migrate_last_login_at.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Running migration: add users.last_login_at...');

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);
        `);

        console.log('✓ Added users.last_login_at and index idx_users_last_login_at');
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
