import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import stationInformationRoutes from './routes/stationInformation.routes';
import camerasRoutes from './routes/cameras.routes';
import dispensersRoutes from './routes/dispensers.routes';
import nozzlesRoutes from './routes/nozzles.routes';
import tanksRoutes from './routes/tanks.routes';
import areasRoutes from './routes/areas.routes';
import ownersRoutes from './routes/owners.routes';
import deedsRoutes from './routes/deeds.routes';
import buildingPermitsRoutes from './routes/buildingPermits.routes';
import contractsRoutes from './routes/contracts.routes';
import commercialLicensesRoutes from './routes/commercialLicenses.routes';
import governmentLicensesRoutes from './routes/governmentLicenses.routes';
import investmentProjectsRoutes from './routes/investmentProjects.routes';
import translationsRoutes from './routes/translations.routes';
import pool from './config/database';
import { authenticateToken } from './middleware/auth';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// CORS configuration - allow multiple origins
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://stg.pms.darbstations.com.sa',
    process.env.CORS_ORIGIN
].filter(Boolean); // Remove undefined values

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
    try {
        // Test database connection
        await pool.query('SELECT 1');
        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected'
        });
    }
});

// Root route - API information
app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: 'DARB PMS Backend API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                profile: 'GET /api/auth/profile (requires auth)'
            },
            stations: {
                create: 'POST /api/stations',
                getAll: 'GET /api/stations',
                getByCode: 'GET /api/stations/:stationCode',
                update: 'PUT /api/stations/:stationCode',
                delete: 'DELETE /api/stations/:stationCode'
            },
            cameras: {
                create: 'POST /api/cameras',
                getAll: 'GET /api/cameras',
                getByStation: 'GET /api/cameras/station/:stationCode',
                getBySerial: 'GET /api/cameras/:serialNumber',
                update: 'PUT /api/cameras/:serialNumber',
                delete: 'DELETE /api/cameras/:serialNumber'
            },
            dispensers: 'POST/GET/PUT/DELETE /api/dispensers',
            nozzles: 'POST/GET/PUT/DELETE /api/nozzles',
            tanks: 'POST/GET/PUT/DELETE /api/tanks',
            areas: 'POST/GET /api/areas'
        },
        documentation: 'https://github.com/your-repo/docs'
    });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/stations', stationInformationRoutes);
app.use('/api/cameras', camerasRoutes);
app.use('/api/dispensers', dispensersRoutes);
app.use('/api/nozzles', nozzlesRoutes);
app.use('/api/tanks', tanksRoutes);
app.use('/api/areas', areasRoutes);
app.use('/api/owners', ownersRoutes);
app.use('/api/deeds', deedsRoutes);
app.use('/api/building-permits', buildingPermitsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/commercial-licenses', commercialLicensesRoutes);
app.use('/api/government-licenses', governmentLicensesRoutes);
app.use('/api/investment-projects', investmentProjectsRoutes);
app.use('/api/translate', translationsRoutes);

// ── Dashboard stats (authenticated) ──────────────────────────────────────────
app.get('/api/dashboard/stats', authenticateToken, async (_req: Request, res: Response) => {
    try {
        const [stationsResult, projectsResult, recentResult, stationsListResult] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%execution%' OR station_status_code ILIKE '%progress%') AS under_execution,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%not started%' OR station_status_code IS NULL) AS not_started,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%operation%' OR station_status_code ILIKE '%active%') AS operational,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%soon%' OR station_status_code ILIKE '%opening%') AS opening_soon,
                    COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS new_this_month
                FROM station_information
            `),
            pool.query(`
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE review_status = 'Pending Review') AS pending_review,
                    COUNT(*) FILTER (WHERE review_status = 'Validated') AS validated,
                    COUNT(*) FILTER (WHERE review_status = 'Approved') AS approved,
                    COUNT(*) FILTER (WHERE review_status = 'Rejected') AS rejected
                FROM investment_projects
            `),
            pool.query(`
                SELECT project_name, review_status, created_at, department_type
                FROM investment_projects
                ORDER BY created_at DESC
                LIMIT 5
            `),
            pool.query(`
                SELECT station_name, station_status_code, created_at
                FROM station_information
                ORDER BY created_at DESC
                LIMIT 10
            `),
        ]);

        res.status(200).json({
            stations: stationsResult.rows[0],
            projects: projectsResult.rows[0],
            recentActivities: recentResult.rows,
            stationsList: stationsListResult.rows,
        });
    } catch (error: any) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats', details: error.message });
    }
});

// ── Tasks / Activity feed (authenticated) ─────────────────────────────────────
app.get('/api/tasks', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userRole = (req as any).user?.role;

        let query = '';
        if (userRole === 'ceo') {
            query = `SELECT * FROM investment_projects WHERE review_status IN ('Validated', 'Approved', 'Rejected') ORDER BY created_at DESC`;
        } else {
            query = `SELECT * FROM investment_projects ORDER BY created_at DESC`;
        }

        const result = await pool.query(query);
        res.status(200).json({ data: result.rows });
    } catch (error: any) {
        console.error('Tasks fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch tasks', details: error.message });
    }
});

// 404 handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server only if not in Vercel serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log('=================================');
        console.log('🚀 DARB Backend Server Started');
        console.log('=================================');
        console.log(`📍 Server running on port ${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
        console.log('=================================');
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM signal received: closing HTTP server');
        await pool.end();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('SIGINT signal received: closing HTTP server');
        await pool.end();
        process.exit(0);
    });
}

export default app;
