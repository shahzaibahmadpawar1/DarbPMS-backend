import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { CorsOptions } from 'cors';
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
import energyLicensesRoutes from './routes/energyLicenses.routes';
import governmentLicensesRoutes from './routes/governmentLicenses.routes';
import investmentProjectsRoutes from './routes/investmentProjects.routes';
import workflowTasksRoutes from './routes/workflowTasks.routes';
import fileUploadRoutes from './routes/fileUpload.routes';
import translationsRoutes from './routes/translations.routes';
import surveyReportsRoutes from './routes/surveyReports.routes';
import pool from './config/database';
import { authenticateToken } from './middleware/auth';
import { ensureWorkflowSchema } from './utils/workflow';
import { ensureSupabaseBucketExists } from './config/supabase';
import { ensureSurveySchema } from './utils/survey';
import { isSchemaCompatibilityError } from './utils/dbErrors';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const extraOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://stg.pms.darbstations.com.sa',
    'https://pms.darbstations.com.sa',
    ...extraOrigins,
];

const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`CORS blocked for origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};

const normalizeDepartment = (value: unknown): 'investment' | 'franchise' | null => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'investment') return 'investment';
    if (normalized === 'franchise' || normalized === 'frenchise') return 'franchise';
    return null;
};

const normalizeDashboardBucket = (
    value: unknown,
):
    | 'total-stations'
    | 'under-execution'
    | 'not-started'
    | 'operational-stations'
    | 'opening-soon'
    | 'new-stations'
    | 'total-projects'
    | 'pending-review'
    | 'validated'
    | 'approved'
    | 'new-projects'
    | 'contracted'
    | 'documented'
    | 'rejected' => {
    const normalized = String(value || 'total-projects').trim().toLowerCase();
    if (normalized === 'total-stations' || normalized === 'stations') return 'total-stations';
    if (normalized === 'under-execution' || normalized === 'execution') return 'under-execution';
    if (normalized === 'not-started' || normalized === 'not-start') return 'not-started';
    if (normalized === 'operational-stations' || normalized === 'operational') return 'operational-stations';
    if (normalized === 'opening-soon' || normalized === 'opening') return 'opening-soon';
    if (normalized === 'new-stations' || normalized === 'new-station') return 'new-stations';
    if (['total-projects', 'total', 'all'].includes(normalized)) return 'total-projects';
    if (normalized === 'pending-review' || normalized === 'pending') return 'pending-review';
    if (normalized === 'validated') return 'validated';
    if (normalized === 'approved') return 'approved';
    if (normalized === 'new-projects' || normalized === 'new-project') return 'new-projects';
    if (normalized === 'contracted') return 'contracted';
    if (normalized === 'documented' || normalized === 'documents') return 'documented';
    if (normalized === 'rejected' || normalized === 'reject') return 'rejected';
    return 'total-projects';
};

const buildWorkflowScopeQuery = (departmentType: string | null) => {
    const filter = departmentType ? 'WHERE department_type = $1' : '';
    const params = departmentType ? [departmentType] : [];

    return {
        text: `
            WITH scoped_projects AS (
                SELECT id, review_status, department_type
                FROM investment_projects
                ${filter}
            ),
            contract_projects AS (
                SELECT DISTINCT t.investment_project_id AS project_id
                FROM project_workflow_tasks t
                INNER JOIN scoped_projects p ON p.id = t.investment_project_id
                WHERE t.flow_type = 'contract'
                  AND t.status IN ('manager_queue', 'assigned', 'employee_submitted', 'under_super_admin_review')
            ),
            document_projects AS (
                SELECT DISTINCT t.investment_project_id AS project_id
                FROM project_workflow_tasks t
                INNER JOIN scoped_projects p ON p.id = t.investment_project_id
                WHERE t.flow_type = 'documents'
                  AND t.status IN ('manager_queue', 'assigned', 'employee_submitted', 'under_super_admin_review')
            )
            SELECT
                (SELECT COUNT(*) FROM scoped_projects) AS total_projects,
                (SELECT COUNT(*) FROM scoped_projects WHERE review_status = 'Pending Review') AS new_project,
                (SELECT COUNT(*) FROM scoped_projects WHERE review_status = 'Pending Review') AS pending_review,
                (SELECT COUNT(*) FROM scoped_projects WHERE review_status = 'Validated') AS validated,
                (SELECT COUNT(*) FROM contract_projects) AS contracted,
                (SELECT COUNT(*) FROM document_projects) AS documented,
                (SELECT COUNT(*) FROM scoped_projects WHERE review_status = 'Approved') AS approved,
                (SELECT COUNT(*) FROM scoped_projects WHERE review_status = 'Rejected') AS rejected
        `,
        params,
    };
};

const buildDashboardStationQuery = (bucket: ReturnType<typeof normalizeDashboardBucket>, departmentType: string | null) => {
    const stationBuckets = new Set<ReturnType<typeof normalizeDashboardBucket>>([
        'total-stations',
        'under-execution',
        'not-started',
        'operational-stations',
        'opening-soon',
        'new-stations',
    ]);

    if (stationBuckets.has(bucket)) {
        const params: unknown[] = [];
        const whereClauses: string[] = [];

        if (departmentType) {
            params.push(departmentType);
            whereClauses.push(`(CASE WHEN lower(station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(station_type_code) END) = $${params.length}`);
        }

        if (bucket === 'under-execution') {
            whereClauses.push(`(station_status_code ILIKE '%execution%' OR station_status_code ILIKE '%progress%')`);
        }

        if (bucket === 'not-started') {
            whereClauses.push(`(station_status_code ILIKE '%not started%' OR station_status_code IS NULL)`);
        }

        if (bucket === 'operational-stations') {
            whereClauses.push(`(station_status_code ILIKE '%operation%' OR station_status_code ILIKE '%active%')`);
        }

        if (bucket === 'opening-soon') {
            whereClauses.push(`(station_status_code ILIKE '%soon%' OR station_status_code ILIKE '%opening%')`);
        }

        if (bucket === 'new-stations') {
            whereClauses.push(`created_at >= date_trunc('month', CURRENT_DATE)`);
        }

        return {
            text: `
                SELECT
                    id::text AS id,
                    station_code,
                    station_name,
                    city,
                    station_type_code,
                    COALESCE(station_status_code, 'Not Started') AS station_status_code,
                    created_at AS project_created_at
                FROM station_information
                ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
                ORDER BY created_at DESC
            `,
            params,
        };
    }

    const filterClause = departmentType ? 'WHERE 1 = 1 AND p.department_type = $1' : 'WHERE 1 = 1';
    const params = departmentType ? [departmentType] : [];
    const bucketClause = (() => {
        switch (bucket) {
            case 'pending-review':
            case 'new-projects':
                return "AND p.review_status = 'Pending Review'";
            case 'validated':
                return "AND p.review_status = 'Validated'";
            case 'approved':
                return "AND p.review_status = 'Approved'";
            case 'rejected':
                return "AND p.review_status = 'Rejected'";
            case 'contracted':
                return `AND EXISTS (
                    SELECT 1
                    FROM project_workflow_tasks t
                    WHERE t.investment_project_id = p.id
                      AND t.flow_type = 'contract'
                      AND t.status IN ('manager_queue', 'assigned', 'employee_submitted', 'under_super_admin_review')
                )`;
            case 'documented':
                return `AND EXISTS (
                    SELECT 1
                    FROM project_workflow_tasks t
                    WHERE t.investment_project_id = p.id
                      AND t.flow_type = 'documents'
                      AND t.status IN ('manager_queue', 'assigned', 'employee_submitted', 'under_super_admin_review')
                )`;
            case 'total-projects':
            default:
                return '';
        }
    })();

    return {
        text: `
            WITH bucket_projects AS (
                SELECT
                    p.id AS project_id,
                    p.project_code,
                    p.project_name,
                    p.city AS project_city,
                    p.department_type,
                    p.project_status,
                    p.review_status,
                    p.created_at AS project_created_at,
                    COALESCE(NULLIF(p.station_code, ''), p.project_code) AS join_code
                FROM investment_projects p
                ${filterClause}
                ${bucketClause}
            )
            SELECT DISTINCT ON (display_code)
                COALESCE(s.station_code, bp.project_code) AS display_code,
                COALESCE(s.id::text, bp.project_id::text) AS id,
                COALESCE(s.station_code, bp.project_code) AS station_code,
                COALESCE(s.station_name, bp.project_name) AS station_name,
                COALESCE(s.city, bp.project_city) AS city,
                COALESCE(
                    NULLIF(s.station_type_code, ''),
                    CASE
                        WHEN lower(bp.department_type) = 'frenchise' THEN 'franchise'
                        ELSE lower(bp.department_type)
                    END,
                    bp.department_type
                ) AS station_type_code,
                CASE
                    WHEN '${bucket}' = 'contracted' THEN 'Contracted'
                    WHEN '${bucket}' = 'documented' THEN 'Documented'
                    WHEN '${bucket}' = 'validated' THEN 'Validated'
                    WHEN '${bucket}' = 'approved' THEN 'Approved'
                    WHEN '${bucket}' = 'rejected' THEN 'Rejected'
                    WHEN '${bucket}' = 'pending-review' OR '${bucket}' = 'new-projects' THEN 'Pending Review'
                    ELSE COALESCE(s.station_status_code, bp.project_status, bp.review_status, 'Unknown')
                END AS station_status_code,
                bp.review_status,
                bp.project_status,
                bp.project_created_at
            FROM bucket_projects bp
            LEFT JOIN station_information s ON s.station_code = bp.join_code
            ORDER BY COALESCE(s.station_code, bp.project_code), bp.project_created_at DESC
        `,
        params,
    };
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
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
app.use('/api/energy-licenses', energyLicensesRoutes);
app.use('/api/government-licenses', governmentLicensesRoutes);
app.use('/api/investment-projects', investmentProjectsRoutes);
app.use('/api/tasks', workflowTasksRoutes);
app.use('/api/files', fileUploadRoutes);
app.use('/api/translate', translationsRoutes);
app.use('/api/survey-reports', surveyReportsRoutes);

ensureWorkflowSchema().catch((error) => {
    console.error('Workflow schema bootstrap failed:', error);
});

ensureSupabaseBucketExists().catch((error) => {
    console.error('Supabase bucket bootstrap failed:', error);
});

ensureSurveySchema().catch((error) => {
    console.error('Survey schema bootstrap failed:', error);
});

// ── Dashboard stats (authenticated) ──────────────────────────────────────────
app.get('/api/dashboard/stats', authenticateToken, async (req: Request, res: Response) => {
    try {
        const authReq = req as any;
        const userRole = authReq.user?.role;
        const userDepartment = authReq.user?.department;
        const departmentScoped = userRole !== 'super_admin' ? normalizeDepartment(userDepartment) : normalizeDepartment((req.query as any)?.departmentType);

        const workflowScopeQuery = buildWorkflowScopeQuery(departmentScoped);

        const queryOneWithFallback = async <T extends Record<string, unknown>>(
            label: string,
            text: string,
            params: unknown[],
            fallback: T,
        ): Promise<{ rows: T[] }> => {
            try {
                const result = await pool.query(text, params);
                return { rows: [((result.rows[0] || fallback) as T)] };
            } catch (error: any) {
                console.error(`Dashboard stats query failed (${label}):`, error);
                return { rows: [fallback] };
            }
        };

        const queryRowsWithFallback = async <T extends Record<string, unknown>>(
            label: string,
            text: string,
            params: unknown[],
        ): Promise<{ rows: T[] }> => {
            try {
                const result = await pool.query(text, params);
                return { rows: result.rows as T[] };
            } catch (error: any) {
                console.error(`Dashboard stats query failed (${label}):`, error);
                return { rows: [] };
            }
        };

        const [stationsResult, projectsResult, recentResult, stationsListResult, workflowResult] = await Promise.all([
            queryOneWithFallback('stations summary', `
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%execution%' OR station_status_code ILIKE '%progress%') AS under_execution,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%not started%' OR station_status_code IS NULL) AS not_started,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%operation%' OR station_status_code ILIKE '%active%') AS operational,
                    COUNT(*) FILTER (WHERE station_status_code ILIKE '%soon%' OR station_status_code ILIKE '%opening%') AS opening_soon,
                    COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS new_this_month
                FROM station_information
            `, [], {
                total: 0,
                under_execution: 0,
                not_started: 0,
                operational: 0,
                opening_soon: 0,
                new_this_month: 0,
            }),
            queryOneWithFallback('project summary', `
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE review_status = 'Pending Review') AS pending_review,
                    COUNT(*) FILTER (WHERE review_status = 'Validated') AS validated,
                    COUNT(*) FILTER (WHERE review_status = 'Approved') AS approved,
                    COUNT(*) FILTER (WHERE review_status = 'Rejected') AS rejected
                FROM investment_projects
            `, [], {
                total: 0,
                pending_review: 0,
                validated: 0,
                approved: 0,
                rejected: 0,
            }),
            queryRowsWithFallback('recent activities', `
                SELECT project_name, review_status, created_at, department_type
                FROM investment_projects
                ORDER BY created_at DESC
                LIMIT 5
            `, []),
            queryRowsWithFallback('stations list', `
                SELECT station_name, station_status_code, created_at
                FROM station_information
                ORDER BY created_at DESC
                LIMIT 10
            `, []),
            queryOneWithFallback('workflow summary', workflowScopeQuery.text, workflowScopeQuery.params, {
                new_project: 0,
                pending_review: 0,
                validated: 0,
                contracted: 0,
                documented: 0,
                approved: 0,
                rejected: 0,
                total_projects: 0,
            }),
        ]);

        res.status(200).json({
            stations: stationsResult.rows[0],
            projects: projectsResult.rows[0],
            recentActivities: recentResult.rows,
            stationsList: stationsListResult.rows,
            workflow: workflowResult.rows[0],
        });
    } catch (error: any) {
        console.error('Dashboard stats error:', error);
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({
                stations: {
                    total: 0,
                    under_execution: 0,
                    not_started: 0,
                    operational: 0,
                    opening_soon: 0,
                    new_this_month: 0,
                },
                projects: {
                    total: 0,
                    pending_review: 0,
                    validated: 0,
                    approved: 0,
                    rejected: 0,
                },
                recentActivities: [],
                stationsList: [],
                workflow: {
                    new_project: 0,
                    under_review: 0,
                    contracted: 0,
                    documented: 0,
                    approved: 0,
                    rejected: 0,
                    total_projects: 0,
                },
            });
            return;
        }
        res.status(500).json({ error: 'Failed to fetch dashboard stats', details: error.message });
    }
});

app.get('/api/dashboard/stations', authenticateToken, async (req: Request, res: Response) => {
    try {
        const authReq = req as any;
        const userRole = authReq.user?.role;
        const userDepartment = authReq.user?.department;
        const bucket = normalizeDashboardBucket((req.query as any)?.bucket);
        const departmentType = userRole === 'super_admin'
            ? normalizeDepartment((req.query as any)?.departmentType)
            : normalizeDepartment(userDepartment);

        const stationQuery = buildDashboardStationQuery(bucket, departmentType);
        const result = await pool.query(stationQuery.text, stationQuery.params);

        res.status(200).json({
            bucket,
            count: result.rows.length,
            data: result.rows,
        });
    } catch (error: any) {
        console.error('Dashboard station drilldown error:', error);
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ bucket: 'total-projects', count: 0, data: [] });
            return;
        }
        res.status(500).json({ error: 'Failed to fetch dashboard station list', details: error.message });
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
