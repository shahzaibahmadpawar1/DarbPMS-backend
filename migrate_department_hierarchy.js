// Migration: move to department-based hierarchy
// Run: node migrate_department_hierarchy.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('Running migration: department hierarchy and super admin reset...');
        await client.query('BEGIN');

        // Ensure department column exists before applying constraints.
        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS department VARCHAR(20);
        `);

        // Keep only existing admin account(s), remove all others.
        await client.query(`
            DELETE FROM users
            WHERE role IS DISTINCT FROM 'admin';
        `);

        // Convert legacy admin role to super_admin.
        await client.query(`
            UPDATE users
            SET role = 'super_admin', department = NULL
            WHERE role = 'admin';
        `);

        await client.query(`
            ALTER TABLE users
            DROP CONSTRAINT IF EXISTS users_role_check;
        `);

        await client.query(`
            ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('super_admin', 'department_manager', 'supervisor', 'employee'));
        `);

        await client.query(`
            ALTER TABLE users
            DROP CONSTRAINT IF EXISTS users_department_check;
        `);

        await client.query(`
            ALTER TABLE users
            ADD CONSTRAINT users_department_check
            CHECK (department IN ('investment', 'franchise') OR department IS NULL);
        `);

        await client.query(`
            ALTER TABLE users
            DROP CONSTRAINT IF EXISTS users_department_required_for_non_super_admin;
        `);

        await client.query(`
            ALTER TABLE users
            ADD CONSTRAINT users_department_required_for_non_super_admin
            CHECK (
                (role = 'super_admin' AND department IS NULL)
                OR
                (role <> 'super_admin' AND department IN ('investment', 'franchise'))
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_department ON users(department);
        `);

        await client.query('COMMIT');

        console.log('Migration completed successfully.');
        console.log('Remaining users were converted to super_admin and all legacy roles were removed.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
