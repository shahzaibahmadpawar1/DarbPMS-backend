import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
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
import feasibilityRoutes from './routes/feasibility.routes';
import investmentWorkflowRoutes from './routes/investmentWorkflow.routes';
import requestsRoutes from './routes/requests.routes';
import ceoContactRoutes from './routes/ceoContact.routes';
import fileUploadRoutes from './routes/fileUpload.routes';
import translationsRoutes from './routes/translations.routes';
import surveyReportsRoutes from './routes/surveyReports.routes';
import usersRoutes from './routes/users.routes';
import appSettingsRoutes from './routes/appSettings.routes';
import pool from './config/database';
import { authenticateToken } from './middleware/auth';
import { ensureWorkflowSchema } from './utils/workflow';
import { ensureActivitySchema, normalizeActivityScope, recordActivity } from './utils/activity';
import { ensureSupabaseBucketExists } from './config/supabase';
import { ensureSurveySchema } from './utils/survey';
import { isSchemaCompatibilityError } from './utils/dbErrors';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const slowRequestThresholdMs = Number(process.env.SLOW_REQUEST_THRESHOLD_MS || 800);

// Middleware
const extraOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5176',
    'http://localhost:3000',
    'https://stg.pms.darbstations.com.sa',
    'https://pms.darbstations.com.sa',
    ...extraOrigins,
];

const isLocalhostDevOrigin = (origin: string): boolean => {
    // Vite (and other dev tools) can hop ports when 5173 is busy, so we allow
    // any localhost/127.0.0.1 origin with a port, not just a hard-coded list.
    // Examples: http://localhost:5176, http://127.0.0.1:4173
    try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'http:') {
            return false;
        }
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
            return true;
        }
        return false;
    } catch {
        return false;
    }
};

const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.includes(origin) || isLocalhostDevOrigin(origin)) {
            callback(null, true);
            return;
        }

        console.log(`CORS blocked for origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
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

const DASHBOARD_STATION_TYPES = ['operation', 'rent', 'franchise', 'investment', 'ownership'] as const;
type DashboardStationType = (typeof DASHBOARD_STATION_TYPES)[number];

const normalizeDashboardStationType = (value: unknown): DashboardStationType | null => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();
    const aliases: Record<string, DashboardStationType> = {
        operational: 'operation',
        operation: 'operation',
        '3': 'operation',
        rental: 'rent',
        rented: 'rent',
        lease: 'rent',
        rent: 'rent',
        '2': 'rent',
        frenchise: 'franchise',
        franchise: 'franchise',
        '4': 'franchise',
        investment: 'investment',
        invest: 'investment',
        '5': 'investment',
        ownership: 'ownership',
        owner: 'ownership',
        owned: 'ownership',
        '1': 'ownership',
    };

    return aliases[normalized] || null;
};

const normalizedStationTypeSql = (columnName: string) => `
    CASE
        WHEN lower(COALESCE(${columnName}, '')) IN ('frenchise', 'franchise', '4') THEN 'franchise'
        WHEN lower(COALESCE(${columnName}, '')) IN ('operational', 'operation', '3') THEN 'operation'
        WHEN lower(COALESCE(${columnName}, '')) IN ('rental', 'rented', 'lease', 'rent', '2') THEN 'rent'
        WHEN lower(COALESCE(${columnName}, '')) IN ('investment', 'invest', '5') THEN 'investment'
        WHEN lower(COALESCE(${columnName}, '')) IN ('ownership', 'owner', 'owned', '1') THEN 'ownership'
        ELSE lower(COALESCE(${columnName}, ''))
    END
`;

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

const buildWorkflowScopeQuery = (departmentType: string | null, stationType: DashboardStationType | null) => {
    const params: unknown[] = [];
    const whereClauses: string[] = ['1 = 1'];

    if (departmentType) {
        params.push(departmentType);
        whereClauses.push(`p.department_type = $${params.length}`);
    }

    if (stationType) {
        params.push(stationType);
        whereClauses.push(`${normalizedStationTypeSql('s.station_type_code')} = $${params.length}`);
    }

    return {
        text: `
            WITH scoped_projects AS (
                SELECT p.id, p.review_status, p.department_type
                FROM investment_projects p
                LEFT JOIN station_information s ON s.station_code = COALESCE(NULLIF(p.station_code, ''), p.project_code)
                WHERE ${whereClauses.join(' AND ')}
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
            ),
            project_summary AS (
                SELECT
                    COUNT(*)::bigint AS total_projects,
                    COUNT(*) FILTER (WHERE review_status = 'Pending Review')::bigint AS new_project,
                    COUNT(*) FILTER (WHERE review_status = 'Pending Review')::bigint AS pending_review,
                    COUNT(*) FILTER (WHERE review_status = 'Validated')::bigint AS validated,
                    COUNT(*) FILTER (WHERE review_status = 'Approved')::bigint AS approved,
                    COUNT(*) FILTER (WHERE review_status = 'Rejected')::bigint AS rejected
                FROM scoped_projects
            )
            SELECT
                ps.total_projects,
                ps.new_project,
                ps.pending_review,
                ps.validated,
                (SELECT COUNT(*)::bigint FROM contract_projects) AS contracted,
                (SELECT COUNT(*)::bigint FROM document_projects) AS documented,
                ps.approved,
                ps.rejected
            FROM project_summary ps
        `,
        params,
    };
};

const buildDashboardStationQuery = (
    bucket: ReturnType<typeof normalizeDashboardBucket>,
    departmentType: string | null,
    stationType: DashboardStationType | null,
) => {
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

        // Hide stations that are still in contract/document workflow (not CEO approved yet).
        // These stations may exist because contract/document flows can upsert station_information early,
        // but they should not appear in station views until final CEO approval.
        whereClauses.push(`
            NOT EXISTS (
                SELECT 1
                FROM investment_projects p
                WHERE COALESCE(NULLIF(p.station_code, ''), p.project_code) = station_information.station_code
                  AND (
                    (
                      p.workflow_path IN ('contract', 'documents')
                      AND COALESCE(p.review_status, '') <> 'Approved'
                    )
                    OR EXISTS (
                      SELECT 1
                      FROM project_workflow_tasks t
                      WHERE t.investment_project_id = p.id
                        AND t.flow_type IN ('contract', 'documents')
                        AND t.status IN ('manager_queue', 'assigned', 'employee_submitted', 'manager_submitted', 'under_super_admin_review')
                    )
                  )
            )
        `);

        if (departmentType) {
            params.push(departmentType);
            whereClauses.push(`(CASE WHEN lower(station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(station_type_code) END) = $${params.length}`);
        }

        if (stationType) {
            params.push(stationType);
            whereClauses.push(`${normalizedStationTypeSql('station_type_code')} = $${params.length}`);
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

    const params: unknown[] = [];
    const whereClauses: string[] = ['1 = 1'];
    if (departmentType) {
        params.push(departmentType);
        whereClauses.push(`p.department_type = $${params.length}`);
    }
    if (stationType) {
        params.push(stationType);
        whereClauses.push(`${normalizedStationTypeSql('s_filter.station_type_code')} = $${params.length}`);
    }

    const filterClause = `WHERE ${whereClauses.join(' AND ')}`;
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
                LEFT JOIN station_information s_filter ON s_filter.station_code = COALESCE(NULLIF(p.station_code, ''), p.project_code)
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

const inferEntityTypeFromPath = (path: string): string => {
    if (path.startsWith('/api/stations')) return 'station_information';
    if (path.startsWith('/api/cameras')) return 'cameras';
    if (path.startsWith('/api/dispensers')) return 'dispensers';
    if (path.startsWith('/api/nozzles')) return 'nozzles';
    if (path.startsWith('/api/tanks')) return 'tanks';
    if (path.startsWith('/api/areas')) return 'areas';
    if (path.startsWith('/api/owners')) return 'owners';
    if (path.startsWith('/api/deeds')) return 'deeds';
    if (path.startsWith('/api/building-permits')) return 'building_permits';
    if (path.startsWith('/api/contracts')) return 'contracts';
    if (path.startsWith('/api/commercial-licenses')) return 'commercial_licenses';
    if (path.startsWith('/api/energy-licenses')) return 'energy_licenses';
    if (path.startsWith('/api/government-licenses')) return 'government_licenses';
    if (path.startsWith('/api/investment-projects')) return 'investment_project';
    if (path.startsWith('/api/requests')) return 'workflow_task';
    if (path.startsWith('/api/ceo-contact')) return 'workflow_task';
    if (path.startsWith('/api/tasks')) return 'workflow_task';
    if (path.startsWith('/api/files')) return 'file_upload';
    if (path.startsWith('/api/survey-reports')) return 'survey_report';
    if (path.startsWith('/api/auth')) return 'auth';
    return 'system';
};

const inferActionFromRequest = (method: string, path: string): string => {
    const normalizedMethod = method.toUpperCase();
    const lowerPath = path.toLowerCase();

    if (lowerPath.includes('/manager-validate')) return 'validate';
    if (lowerPath.includes('/review')) return 'review';
    if (lowerPath.includes('/manager-submit') || lowerPath.includes('/employee-submit')) return 'submit';
    if (lowerPath.includes('/assign')) return 'assign';
    if (lowerPath.includes('/manager-attachment') || lowerPath.includes('/upload')) return 'upload';
    if (lowerPath.includes('/bulk')) return 'bulk_import';

    if (normalizedMethod === 'POST') return 'create';
    if (normalizedMethod === 'PUT' || normalizedMethod === 'PATCH') return 'update';
    if (normalizedMethod === 'DELETE') return 'delete';
    return normalizedMethod.toLowerCase();
};

const buildActivitySummary = (action: string, entityType: string): string => {
    const humanAction = action.replace(/_/g, ' ');
    const humanEntity = entityType.replace(/_/g, ' ');
    return `${humanAction} ${humanEntity}`.trim();
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!isProduction) {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    }
    next();
});

// Lightweight request timing focused on known slow user journeys.
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
        const durationMs = Date.now() - start;
        if (durationMs < slowRequestThresholdMs) return;
        if (!req.path.startsWith('/api/')) return;

        console.warn(`Slow request: ${req.method} ${req.path} ${durationMs}ms status=${res.statusCode}`);
    });

    next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
        const method = req.method.toUpperCase();
        const isWriteMethod = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        const path = req.path;

        if (!isWriteMethod) return;
        if (!path.startsWith('/api/')) return;
        if (path.startsWith('/api/dashboard/activities')) return;
        if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register')) return;
        if (res.statusCode < 200 || res.statusCode >= 400) return;

        const authReq = req as any;
        const actorId = authReq.user?.id || null;
        if (!actorId) return;

        const entityType = inferEntityTypeFromPath(path);
        const action = inferActionFromRequest(method, path);

        void recordActivity({
            actorId,
            action,
            entityType,
            entityId: req.params?.id || req.params?.stationCode || null,
            summary: buildActivitySummary(action, entityType),
            metadata: {
                statusCode: res.statusCode,
            },
            sourcePath: path,
            requestMethod: method,
        }).catch((error) => {
            console.error('Activity auto-log failed:', error);
        });
    });

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
app.use('/api/feasibility', feasibilityRoutes);
app.use('/api/investment', investmentWorkflowRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/ceo-contact', ceoContactRoutes);
app.use('/api/files', fileUploadRoutes);
app.use('/api/translate', translationsRoutes);
app.use('/api/survey-reports', surveyReportsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/app-settings', appSettingsRoutes);

ensureWorkflowSchema().catch((error) => {
    console.error('Workflow schema bootstrap failed:', error);
});

ensureActivitySchema().catch((error) => {
    console.error('Activity schema bootstrap failed:', error);
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
        const departmentScoped = (userRole !== 'super_admin' && userRole !== 'ceo')
            ? normalizeDepartment(userDepartment)
            : normalizeDepartment((req.query as any)?.departmentType);
        const stationType = normalizeDashboardStationType((req.query as any)?.stationType);

        const workflowScopeQuery = buildWorkflowScopeQuery(departmentScoped, stationType);

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

        const hideStationsUntilWorkflowApprovedClause = `
            NOT EXISTS (
                SELECT 1
                FROM investment_projects p
                WHERE COALESCE(p.review_status, '') <> 'Approved'
                  AND (
                    COALESCE(NULLIF(p.station_code, ''), p.project_code) = station_information.station_code
                    OR EXISTS (
                      SELECT 1
                      FROM project_workflow_tasks t
                      WHERE t.investment_project_id = p.id
                        AND COALESCE(t.metadata->>'stationCode', '') = station_information.station_code
                    )
                  )
            )
        `;

        const stationSummaryParams: unknown[] = [];
        const stationSummaryWhere = stationType
            ? (() => {
                stationSummaryParams.push(stationType);
                return `WHERE ${hideStationsUntilWorkflowApprovedClause} AND ${normalizedStationTypeSql('station_type_code')} = $${stationSummaryParams.length}`;
            })()
            : `WHERE ${hideStationsUntilWorkflowApprovedClause}`;

        const projectSummaryParams: unknown[] = [];
        const projectSummaryWhere = stationType
            ? (() => {
                projectSummaryParams.push(stationType);
                return `WHERE ${normalizedStationTypeSql('s.station_type_code')} = $${projectSummaryParams.length}`;
            })()
            : '';

        const recentProjectsParams: unknown[] = [];
        const recentProjectsWhere = stationType
            ? (() => {
                recentProjectsParams.push(stationType);
                return `WHERE ${normalizedStationTypeSql('s.station_type_code')} = $${recentProjectsParams.length}`;
            })()
            : '';

        const stationsListParams: unknown[] = [];
        const stationsListWhere = stationType
            ? (() => {
                stationsListParams.push(stationType);
                return `WHERE ${hideStationsUntilWorkflowApprovedClause} AND ${normalizedStationTypeSql('station_type_code')} = $${stationsListParams.length}`;
            })()
            : `WHERE ${hideStationsUntilWorkflowApprovedClause}`;

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
                ${stationSummaryWhere}
            `, stationSummaryParams, {
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
                FROM investment_projects p
                LEFT JOIN station_information s ON s.station_code = COALESCE(NULLIF(p.station_code, ''), p.project_code)
                ${projectSummaryWhere}
            `, projectSummaryParams, {
                total: 0,
                pending_review: 0,
                validated: 0,
                approved: 0,
                rejected: 0,
            }),
            queryRowsWithFallback('recent activities', `
                SELECT p.project_name, p.review_status, p.created_at, p.department_type
                FROM investment_projects p
                LEFT JOIN station_information s ON s.station_code = COALESCE(NULLIF(p.station_code, ''), p.project_code)
                ${recentProjectsWhere}
                ORDER BY p.created_at DESC
                LIMIT 5
            `, recentProjectsParams),
            queryRowsWithFallback('stations list', `
                SELECT station_name, station_status_code, created_at
                FROM station_information
                ${stationsListWhere}
                ORDER BY created_at DESC
                LIMIT 10
            `, stationsListParams),
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

app.get('/api/dashboard/activities', authenticateToken, async (req: Request, res: Response) => {
    try {
        const authReq = req as any;
        const userId = String(authReq.user?.id || '');
        const userRole = String(authReq.user?.role || '');

        if (!userId) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        const requestedScope = normalizeActivityScope((req.query as any)?.scope);
        const scope = (userRole === 'super_admin' || userRole === 'ceo') ? requestedScope : 'mine';

        const limitInput = Number.parseInt(String((req.query as any)?.limit || '20'), 10);
        const offsetInput = Number.parseInt(String((req.query as any)?.offset || '0'), 10);
        const limit = Number.isFinite(limitInput) && limitInput > 0 ? Math.min(limitInput, 200) : 20;
        const offset = Number.isFinite(offsetInput) && offsetInput >= 0 ? offsetInput : 0;

        const whereClause = scope === 'all' ? '' : 'WHERE a.actor_id = $1';
        const params: unknown[] = scope === 'all' ? [] : [userId];

        params.push(limit, offset);
        const limitParam = params.length - 1;
        const offsetParam = params.length;

        const query = `
            SELECT
                a.id,
                a.actor_id,
                COALESCE(NULLIF(u.full_name, ''), u.username, 'System') AS actor_name,
                a.action,
                a.entity_type,
                a.entity_id,
                a.summary,
                a.details,
                a.metadata,
                a.source_path,
                a.request_method,
                a.created_at
            FROM activity_events a
            LEFT JOIN users u ON u.id = a.actor_id
            ${whereClause}
            ORDER BY a.created_at DESC
            LIMIT $${limitParam}
            OFFSET $${offsetParam}
        `;

        const countQuery = `
            SELECT COUNT(*)::int AS total
            FROM activity_events a
            ${whereClause}
        `;

        const [rowsResult, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, scope === 'all' ? [] : [userId]),
        ]);

        res.status(200).json({
            scope,
            limit,
            offset,
            total: countResult.rows[0]?.total || 0,
            data: rowsResult.rows,
        });
    } catch (error: any) {
        console.error('Dashboard activities error:', error);
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ scope: 'mine', limit: 20, offset: 0, total: 0, data: [] });
            return;
        }
        res.status(500).json({ error: 'Failed to fetch activity history', details: error.message });
    }
});

app.get('/api/dashboard/stations', authenticateToken, async (req: Request, res: Response) => {
    try {
        const authReq = req as any;
        const userRole = authReq.user?.role;
        const userDepartment = authReq.user?.department;
        const bucket = normalizeDashboardBucket((req.query as any)?.bucket);
        const stationType = normalizeDashboardStationType((req.query as any)?.stationType);
        const departmentType = (userRole === 'super_admin' || userRole === 'ceo')
            ? normalizeDepartment((req.query as any)?.departmentType)
            : normalizeDepartment(userDepartment);

        const stationQuery = buildDashboardStationQuery(bucket, departmentType, stationType);
        const result = await pool.query(stationQuery.text, stationQuery.params);
        const rows = [...result.rows];

        const bucketAllowsApprovedOpp = bucket === 'total-stations'
            || bucket === 'operational-stations'
            || bucket === 'new-stations';
        if (bucketAllowsApprovedOpp) {
            const oppParams: unknown[] = [];
            const oppWhere: string[] = [`o.workflow_status = 'approved'`];
            if (departmentType) {
                oppParams.push(departmentType);
                oppWhere.push(`lower(o.opportunity_type) = $${oppParams.length}`);
            }
            if (stationType) {
                oppParams.push(stationType);
                oppWhere.push(`lower(o.opportunity_type) = $${oppParams.length}`);
            }
            if (bucket === 'new-stations') {
                oppWhere.push(`o.created_at >= date_trunc('month', CURRENT_DATE)`);
            }
            const approvedOpp = await pool.query(
                `
                    SELECT
                        o.id::text AS display_code,
                        o.id::text AS id,
                        o.id::text AS station_code,
                        COALESCE(NULLIF(o.station_name_if_exists, ''), c.name) AS station_name,
                        o.city,
                        lower(o.opportunity_type) AS station_type_code,
                        'Operational'::text AS station_status_code,
                        'Approved'::text AS review_status,
                        'Approved'::text AS project_status,
                        o.created_at AS project_created_at
                    FROM investment_opportunities o
                    JOIN investment_clients c ON c.id = o.client_id
                    WHERE ${oppWhere.join(' AND ')}
                    ORDER BY o.created_at DESC
                `,
                oppParams,
            );
            rows.push(...approvedOpp.rows);
        }

        res.status(200).json({
            bucket,
            stationType,
            count: rows.length,
            data: rows,
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
