import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL connection pool configuration
// For Vercel serverless, we need smaller pool and shorter timeouts
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'darb_pms',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    // Serverless-friendly settings
    max: isProduction ? 1 : 20, // Use 1 connection for serverless
    idleTimeoutMillis: isProduction ? 1000 : 30000, // Close faster in serverless
    connectionTimeoutMillis: isProduction ? 5000 : 2000, // Longer timeout for serverless
    ssl: isProduction ? { rejectUnauthorized: false } : false, // Enable SSL for production
});

// Test database connection
pool.on('connect', () => {
    console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

export default pool;
