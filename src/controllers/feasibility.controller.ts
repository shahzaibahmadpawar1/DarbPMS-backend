import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';
import { ensureWorkflowSchema, recordWorkflowTransition } from '../utils/workflow';
import { ensureFeasibilitySchema, FEASIBILITY_REVIEW_DEPARTMENTS, type FeasibilityReviewDepartment } from '../utils/feasibility';

let investmentLifecycleSchemaReady = false;

const ensureInvestmentLifecycleSchema = async (): Promise<void> => {
    if (investmentLifecycleSchemaReady) {
        return;
    }

    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS workflow_path VARCHAR(50);
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);

    investmentLifecycleSchemaReady = true;
};

const normalizeDepartmentType = (value: unknown): 'investment' | 'franchise' | null => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'investment') return 'investment';
    if (normalized === 'franchise' || normalized === 'frenchise') return 'franchise';
    return null;
};

const normalizeReviewDepartment = (value: unknown): FeasibilityReviewDepartment | null => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'project') return 'project';
    if (normalized === 'operation' || normalized === 'operations') return 'operation';
    if (normalized === 'realestate' || normalized === 'real_estate') return 'realestate';
    if (normalized === 'investment') return 'investment';
    if (normalized === 'finance') return 'finance';
    return null;
};

export class FeasibilityController {
    static async getDetails(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureWorkflowSchema();
            await ensureFeasibilitySchema();

            const userId = req.user?.id;
            const userRole = req.user?.role;
            if (!userId || !userRole) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const taskId = String(req.params?.taskId || '').trim();
            if (!taskId) {
                res.status(400).json({ error: 'taskId is required' });
                return;
            }

            const taskResult = await pool.query(
                `
                    SELECT t.*,
                           acu.username AS created_by_username
                    FROM project_workflow_tasks t
                    LEFT JOIN users acu ON acu.id = t.created_by
                    WHERE t.id = $1
                      AND t.flow_type = 'feasibility'
                    LIMIT 1
                `,
                [taskId],
            );

            if (!taskResult.rows.length) {
                res.status(404).json({ error: 'Feasibility task not found' });
                return;
            }

            const task = taskResult.rows[0];
            const projectId = task.investment_project_id as string | null;
            if (!projectId) {
                res.status(400).json({ error: 'Feasibility task is missing investment_project_id' });
                return;
            }

            const isExecutive = userRole === 'super_admin' || userRole === 'ceo';
            if (!isExecutive) {
                const participant = await pool.query(
                    `
                        SELECT 1
                        FROM feasibility_task_participants fp
                        WHERE fp.task_id = $1 AND fp.user_id = $2
                        LIMIT 1
                    `,
                    [taskId, userId],
                );
                const isSubmitter = task.created_by === userId;
                if (!participant.rows.length && !isSubmitter) {
                    res.status(403).json({ error: 'You are not allowed to view this feasibility task' });
                    return;
                }
            }

            const projectResult = await pool.query(
                `SELECT * FROM investment_projects WHERE id = $1 LIMIT 1`,
                [projectId],
            );
            const project = projectResult.rows[0] || null;

            const participantsResult = await pool.query(
                `
                    SELECT fp.department, fp.user_id, u.username
                    FROM feasibility_task_participants fp
                    LEFT JOIN users u ON u.id = fp.user_id
                    WHERE fp.task_id = $1
                    ORDER BY fp.department
                `,
                [taskId],
            );

            const reviewsResult = await pool.query(
                `
                    SELECT *
                    FROM feasibility_manager_reviews
                    WHERE investment_project_id = $1
                    ORDER BY department
                `,
                [projectId],
            );

            res.status(200).json({
                data: {
                    task,
                    project,
                    participants: participantsResult.rows,
                    reviews: reviewsResult.rows,
                    requiredDepartments: FEASIBILITY_REVIEW_DEPARTMENTS,
                },
            });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch feasibility details', details: error.message });
        }
    }

    static async submit(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureWorkflowSchema();
            await ensureFeasibilitySchema();
            await ensureInvestmentLifecycleSchema();

            const actorId = req.user?.id;
            if (!actorId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const departmentType = normalizeDepartmentType(req.body?.departmentType);
            if (!departmentType) {
                res.status(400).json({ error: 'departmentType is required' });
                return;
            }

            const requestType = 'Feasibility Study';

            const projectName = String(req.body?.projectName || '').trim();
            const projectCode = String(req.body?.projectCode || '').trim();
            const city = String(req.body?.city || '').trim();
            const district = String(req.body?.district || '').trim();
            const area = req.body?.area ?? 0;
            const projectStatus = String(req.body?.projectStatus || '').trim();
            const contractType = String(req.body?.contractType || '').trim();
            const googleLocation = String(req.body?.googleLocation || '').trim();
            const priorityLevel = String(req.body?.priorityLevel || '').trim();
            const orderDate = req.body?.orderDate || null;
            const requestSender = String(req.body?.requestSender || '').trim();

            const ownerName = String(req.body?.ownerName || '').trim();
            const ownerContactNo = String(req.body?.ownerContactNo || '').trim();
            const idNo = String(req.body?.idNo || '').trim();
            const nationalAddress = String(req.body?.nationalAddress || '').trim();
            const email = String(req.body?.email || '').trim();
            const ownerType = String(req.body?.ownerType || 'individual').trim() || 'individual';

            const superMarket = Number(req.body?.superMarket ?? 0) || 0;
            const fuelStation = Number(req.body?.fuelStation ?? 0) || 0;
            const kiosks = Number(req.body?.kiosks ?? 0) || 0;
            const retailShop = Number(req.body?.retailShop ?? 0) || 0;
            const driveThrough = Number(req.body?.driveThrough ?? 0) || 0;

            const superMarketArea = Number(req.body?.superMarketArea ?? 0) || 0;
            const fuelStationArea = Number(req.body?.fuelStationArea ?? 0) || 0;
            const kiosksArea = Number(req.body?.kiosksArea ?? 0) || 0;
            const retailShopArea = Number(req.body?.retailShopArea ?? 0) || 0;
            const driveThroughArea = Number(req.body?.driveThroughArea ?? 0) || 0;

            const designFileUrl = String(req.body?.designFileUrl || '').trim() || null;
            const documentsUrl = String(req.body?.documentsUrl || '').trim() || null;
            const autocadUrl = String(req.body?.autocadUrl || '').trim() || null;

            if (!projectName || !projectCode) {
                res.status(400).json({ error: 'projectName and projectCode are required' });
                return;
            }

            const selectedManagers = req.body?.selectedManagers as Record<string, unknown> | undefined;
            const resolvedManagers = {} as Record<FeasibilityReviewDepartment, string>;
            for (const dept of FEASIBILITY_REVIEW_DEPARTMENTS) {
                const userId = String(selectedManagers?.[dept] || '').trim();
                if (!userId) {
                    res.status(400).json({ error: `selectedManagers.${dept} is required` });
                    return;
                }
                resolvedManagers[dept] = userId;
            }

            // Validate all selected managers exist and are department managers of matching department
            for (const dept of FEASIBILITY_REVIEW_DEPARTMENTS) {
                const expectedDept = normalizeReviewDepartment(dept);
                const lookup = await pool.query(
                    `SELECT id, role, department FROM users WHERE id = $1 LIMIT 1`,
                    [resolvedManagers[dept]],
                );
                if (!lookup.rows.length) {
                    res.status(404).json({ error: `Manager for ${dept} not found` });
                    return;
                }
                const user = lookup.rows[0];
                if (String(user.role) !== 'department_manager') {
                    res.status(400).json({ error: `Selected user for ${dept} is not a department manager` });
                    return;
                }
                const actualDept = normalizeReviewDepartment(user.department);
                if (!expectedDept || actualDept !== expectedDept) {
                    res.status(400).json({ error: `Selected manager for ${dept} must belong to ${dept} department` });
                    return;
                }
            }

            // NOTE: `review_status` is constrained in many deployments to:
            // ('Pending Review','Validated','Approved','Rejected').
            // We store feasibility state via request_type + feasibility tasks until CEO approval.
            const inserted = await pool.query(
                `
                    INSERT INTO investment_projects (
                        department_type,
                        request_type,
                        project_name,
                        project_code,
                        city,
                        district,
                        area,
                        project_status,
                        contract_type,
                        google_location,
                        priority_level,
                        order_date,
                        request_sender,
                        super_market,
                        fuel_station,
                        kiosks,
                        retail_shop,
                        drive_through,
                        super_market_area,
                        fuel_station_area,
                        kiosks_area,
                        retail_shop_area,
                        drive_through_area,
                        owner_name,
                        owner_contact_no,
                        id_no,
                        national_address,
                        email,
                        owner_type,
                        design_file_url,
                        documents_url,
                        autocad_url,
                        review_status,
                        is_submitted,
                        submitted_at,
                        submitted_by,
                        created_by,
                        updated_by
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                        $14,$15,$16,$17,$18,
                        $19,$20,$21,$22,$23,
                        $24,$25,$26,$27,$28,$29,
                        $30,$31,$32,
                        $33,
                        TRUE,
                        CURRENT_TIMESTAMP,
                        $34,
                        $34,
                        $34
                    )
                    RETURNING *
                `,
                [
                    departmentType,
                    requestType,
                    projectName,
                    projectCode,
                    city,
                    district,
                    Number(area) || 0,
                    projectStatus,
                    contractType || null,
                    googleLocation || null,
                    priorityLevel || null,
                    orderDate || null,
                    requestSender || null,
                    superMarket,
                    fuelStation,
                    kiosks,
                    retailShop,
                    driveThrough,
                    superMarketArea,
                    fuelStationArea,
                    kiosksArea,
                    retailShopArea,
                    driveThroughArea,
                    ownerName || null,
                    ownerContactNo || null,
                    idNo || null,
                    nationalAddress || null,
                    email || null,
                    ownerType,
                    designFileUrl,
                    documentsUrl,
                    autocadUrl,
                    'Pending Review',
                    actorId,
                ],
            );

            const project = inserted.rows[0];

            await recordWorkflowTransition({
                entityType: 'investment_project',
                entityId: project.id,
                oldState: null,
                newState: 'Pending Review',
                changedBy: actorId,
                note: 'Feasibility study submitted',
                metadata: {
                    requestType,
                    departmentType,
                    feasibilityStage: 'manager_review',
                },
            });

            // Create ONE shared feasibility task (visible via feasibility_task_participants).
            const insertedTask = await pool.query(
                `
                    INSERT INTO project_workflow_tasks (
                        investment_project_id,
                        title,
                        description,
                        flow_type,
                        status,
                        origin_department,
                        target_department,
                        assigned_to,
                        assigned_by,
                        metadata,
                        created_by
                    ) VALUES (
                        $1,
                        $2,
                        $3,
                        'feasibility',
                        'assigned',
                        $4,
                        $4,
                        NULL,
                        $5,
                        $6::jsonb,
                        $5
                    )
                    RETURNING id
                `,
                [
                    project.id,
                    `Feasibility Study - ${project.project_name}`,
                    `Feasibility study shared review task for project ${project.project_code}.`,
                    departmentType,
                    actorId,
                    JSON.stringify({
                        feasibility: {
                            stage: 'manager_review',
                            departments: FEASIBILITY_REVIEW_DEPARTMENTS,
                        },
                    }),
                ],
            );

            const taskId = insertedTask.rows[0].id as string;

            // Register participants (one per required department).
            for (const dept of FEASIBILITY_REVIEW_DEPARTMENTS) {
                await pool.query(
                    `
                        INSERT INTO feasibility_task_participants (task_id, user_id, department)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (task_id, department) DO UPDATE
                        SET user_id = EXCLUDED.user_id
                    `,
                    [taskId, resolvedManagers[dept], dept],
                );
            }

            await recordWorkflowTransition({
                entityType: 'workflow_task',
                entityId: taskId,
                oldState: null,
                newState: 'assigned',
                changedBy: actorId,
                note: 'Shared feasibility task created',
                metadata: {
                    projectId: project.id,
                    participants: resolvedManagers,
                },
            });

            res.status(201).json({ data: { project, taskId } });
        } catch (error: any) {
            if (error.code === '23505') {
                res.status(409).json({ error: 'Project code already exists' });
                return;
            }
            res.status(500).json({ error: 'Failed to submit feasibility study', details: error.message });
        }
    }
}

