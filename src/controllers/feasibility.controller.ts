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
                        owner_name,
                        owner_contact_no,
                        id_no,
                        national_address,
                        email,
                        owner_type,
                        review_status,
                        is_submitted,
                        submitted_at,
                        submitted_by,
                        created_by,
                        updated_by
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                        $14,$15,$16,$17,$18,$19,
                        $20,
                        TRUE,
                        CURRENT_TIMESTAMP,
                        $21,
                        $21,
                        $21
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
                    ownerName || null,
                    ownerContactNo || null,
                    idNo || null,
                    nationalAddress || null,
                    email || null,
                    ownerType,
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

            // Create 5 manager tasks and pre-assign to each selected manager.
            for (const dept of FEASIBILITY_REVIEW_DEPARTMENTS) {
                const managerId = resolvedManagers[dept];
                const task = await pool.query(
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
                            $5,
                            $6,
                            $7,
                            $8::jsonb,
                            $7
                        )
                        RETURNING id
                    `,
                    [
                        project.id,
                        `Feasibility Review - ${project.project_name}`,
                        `Provide feasibility review inputs for ${dept} department.`,
                        departmentType,
                        dept,
                        managerId,
                        actorId,
                        JSON.stringify({
                            feasibility: {
                                department: dept,
                            },
                        }),
                    ],
                );

                await recordWorkflowTransition({
                    entityType: 'workflow_task',
                    entityId: task.rows[0].id,
                    oldState: null,
                    newState: 'assigned',
                    changedBy: actorId,
                    note: 'Feasibility review task created',
                    metadata: {
                        projectId: project.id,
                        department: dept,
                        assignedToUserId: managerId,
                    },
                });
            }

            res.status(201).json({ data: project });
        } catch (error: any) {
            if (error.code === '23505') {
                res.status(409).json({ error: 'Project code already exists' });
                return;
            }
            res.status(500).json({ error: 'Failed to submit feasibility study', details: error.message });
        }
    }
}

