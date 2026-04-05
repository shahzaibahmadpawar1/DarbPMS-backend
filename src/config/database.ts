import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const poolMaxFromEnv = Number(process.env.DB_POOL_MAX);
const poolMax = Number.isFinite(poolMaxFromEnv) && poolMaxFromEnv > 0
    ? poolMaxFromEnv
    : (process.env.VERCEL ? 1 : 5);

const idleTimeoutMsFromEnv = Number(process.env.DB_IDLE_TIMEOUT_MS);
const idleTimeoutMillis = Number.isFinite(idleTimeoutMsFromEnv) && idleTimeoutMsFromEnv >= 0
    ? idleTimeoutMsFromEnv
    : 10000;

const connectionTimeoutMsFromEnv = Number(process.env.DB_CONN_TIMEOUT_MS);
const connectionTimeoutMillis = Number.isFinite(connectionTimeoutMsFromEnv) && connectionTimeoutMsFromEnv > 0
    ? connectionTimeoutMsFromEnv
    : 10000;

const maxUsesFromEnv = Number(process.env.DB_MAX_USES);
const maxUses = Number.isFinite(maxUsesFromEnv) && maxUsesFromEnv > 0
    ? maxUsesFromEnv
    : 5000;

// PostgreSQL connection pool configuration
// Use DATABASE_URL for Supabase connection pooler
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: poolMax,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    allowExitOnIdle: true,
    maxUses,
});

// Test database connection
pool.on('connect', (_client) => {
    console.log(`✓ Connected to PostgreSQL database (pool max=${poolMax})`);
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    // Do not terminate the process in serverless runtimes.
});

export default pool;
