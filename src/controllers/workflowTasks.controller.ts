import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';
import { ensureWorkflowSchema, WorkflowTaskFlowType, recordWorkflowTransition } from '../utils/workflow';

const normalizeDepartment = (value: unknown): 'investment' | 'franchise' | null => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'investment') return 'investment';
    if (normalized === 'franchise' || normalized === 'frenchise') return 'franchise';
    return null;
};

const upsertStationFromProject = async (projectId: string, userId: string): Promise<void> => {
    const projectResult = await pool.query('SELECT * FROM investment_projects WHERE id = $1 LIMIT 1', [projectId]);
    if (!projectResult.rows.length) {
        return;
    }

    const project = projectResult.rows[0];
    await pool.query(`
        INSERT INTO station_information (
            station_code, station_name, city, district,
            geographic_location, station_type_code, station_status_code,
            created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        ON CONFLICT (station_code) DO UPDATE SET
            station_name = EXCLUDED.station_name,
            city = EXCLUDED.city,
            district = EXCLUDED.district,
            geographic_location = EXCLUDED.geographic_location,
            station_type_code = EXCLUDED.station_type_code,
            station_status_code = EXCLUDED.station_status_code,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP
    `, [
        project.project_code,
        project.project_name,
        project.city,
        project.district,
        project.google_location,
        project.department_type?.toUpperCase() || 'INVESTMENT',
        project.project_status || 'Active',
        userId,
    ]);
};

export const getWorkflowTasks = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const userId = req.user?.id;
        const userRole = req.user?.role;
        const userDepartment = req.user?.department;

        if (!userId || !userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        let query = `
            SELECT
                t.*,
                p.project_name,
                p.project_code,
                p.review_status,
                p.department_type,
                p.city,
                au.username AS assigned_to_username,
                aby.username AS assigned_by_username
            FROM project_workflow_tasks t
            JOIN investment_projects p ON p.id = t.investment_project_id
            LEFT JOIN users au ON au.id = t.assigned_to
            LEFT JOIN users aby ON aby.id = t.assigned_by
        `;
        const params: unknown[] = [];

        if (userRole !== 'super_admin') {
            const department = normalizeDepartment(userDepartment);
            if (!department) {
                res.status(403).json({ error: 'Department is required for this action' });
                return;
            }

            if (userRole === 'department_manager') {
                query += `
                    WHERE t.origin_department = $1
                       OR t.target_department = $1
                       OR t.assigned_by = $2
                `;
                params.push(department, userId);
            } else {
                // Employees/supervisors should only see tasks explicitly assigned to them.
                query += ' WHERE t.assigned_to = $1';
                params.push(userId);
            }
        }

        query += ' ORDER BY t.created_at DESC';

        const result = await pool.query(query, params);
        res.status(200).json({ data: result.rows });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch workflow tasks', details: error.message });
    }
};

export const getAssignableUsers = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userRole = req.user?.role;
        const userDepartment = req.user?.department;

        if (!userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        let query = `
            SELECT id, username, role, department
            FROM users
            WHERE role IN ('employee', 'supervisor', 'department_manager')
        `;
        const params: unknown[] = [];

        if (userRole !== 'super_admin') {
            const department = normalizeDepartment(userDepartment);
            if (!department) {
                res.status(403).json({ error: 'Department is required for this action' });
                return;
            }

            query += ' AND (department = $1 OR department IN (\'investment\', \'franchise\'))';
            params.push(department);
        }

        query += ' ORDER BY username';
        const result = await pool.query(query, params);
        res.status(200).json({ data: result.rows });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch assignable users', details: error.message });
    }
};

export const assignWorkflowTask = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const { id } = req.params;
        const { assignedToUserId, targetDepartment } = req.body as { assignedToUserId?: string; targetDepartment?: string };
        const actorId = req.user?.id;
        const actorRole = req.user?.role;

        if (!actorId || !actorRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!(actorRole === 'department_manager' || actorRole === 'super_admin')) {
            res.status(403).json({ error: 'Only department managers or super admin can assign tasks' });
            return;
        }

        if (!assignedToUserId) {
            res.status(400).json({ error: 'assignedToUserId is required' });
            return;
        }

        const assignee = await pool.query('SELECT id, department FROM users WHERE id = $1 LIMIT 1', [assignedToUserId]);
        if (!assignee.rows.length) {
            res.status(404).json({ error: 'Assignee not found' });
            return;
        }

        const resolvedTargetDepartment = normalizeDepartment(targetDepartment) || normalizeDepartment(assignee.rows[0].department);
        if (!resolvedTargetDepartment) {
            res.status(400).json({ error: 'A valid target department is required' });
            return;
        }

        const result = await pool.query(`
            UPDATE project_workflow_tasks
            SET assigned_to = $1,
                assigned_by = $2,
                target_department = $3,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `, [assignedToUserId, actorId, resolvedTargetDepartment, id]);

        if (!result.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: id,
            oldState: 'manager_queue',
            newState: 'assigned',
            changedBy: actorId,
            note: 'Task assigned to employee',
            metadata: {
                assignedToUserId,
                targetDepartment: resolvedTargetDepartment,
            },
        });

        res.status(200).json({ message: 'Task assigned successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to assign task', details: error.message });
    }
};

export const addManagerAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const { id } = req.params;
        const { attachmentUrl, note } = req.body as { attachmentUrl?: string; note?: string };
        const userRole = req.user?.role;

        if (!(userRole === 'department_manager' || userRole === 'super_admin')) {
            res.status(403).json({ error: 'Only department managers or super admin can add manager attachment' });
            return;
        }

        if (!attachmentUrl) {
            res.status(400).json({ error: 'attachmentUrl is required' });
            return;
        }

        const result = await pool.query(`
            UPDATE project_workflow_tasks
            SET manager_attachment_url = $1,
                manager_note = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [attachmentUrl, note || null, id]);

        if (!result.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        res.status(200).json({ message: 'Manager attachment added', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to add manager attachment', details: error.message });
    }
};

export const submitEmployeeAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const { id } = req.params;
        const { attachmentUrl, note } = req.body as { attachmentUrl?: string; note?: string };
        const userId = req.user?.id;
        const userRole = req.user?.role;

        if (!userId || !userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!attachmentUrl) {
            res.status(400).json({ error: 'attachmentUrl is required' });
            return;
        }

        const taskLookup = await pool.query('SELECT * FROM project_workflow_tasks WHERE id = $1 LIMIT 1', [id]);
        if (!taskLookup.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskLookup.rows[0];
        const oldState = task.status;
        const canSubmit = userRole === 'super_admin' || task.assigned_to === userId;
        if (!canSubmit) {
            res.status(403).json({ error: 'Only assigned employee can submit attachment' });
            return;
        }

        const result = await pool.query(`
            UPDATE project_workflow_tasks
            SET employee_attachment_url = $1,
                employee_note = $2,
                status = 'under_super_admin_review',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [attachmentUrl, note || null, id]);

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: id,
            oldState,
            newState: 'under_super_admin_review',
            changedBy: userId,
            note: note || 'Employee submitted attachment',
            metadata: {
                attachmentUrl,
            },
        });

        res.status(200).json({ message: 'Employee submission sent for Super Admin review', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to submit employee attachment', details: error.message });
    }
};

export const reviewWorkflowTask = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const { id } = req.params;
        const { decision, comment } = req.body as { decision?: string; comment?: string };
        const userRole = req.user?.role;
        const userId = req.user?.id;

        if (userRole !== 'super_admin' || !userId) {
            res.status(403).json({ error: 'Only super admin can review workflow tasks' });
            return;
        }

        const normalizedDecision = String(decision || '').trim().toLowerCase();
        if (!(normalizedDecision === 'approved' || normalizedDecision === 'rejected')) {
            res.status(400).json({ error: 'decision must be approved or rejected' });
            return;
        }

        const taskLookup = await pool.query('SELECT * FROM project_workflow_tasks WHERE id = $1 LIMIT 1', [id]);
        if (!taskLookup.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskLookup.rows[0];
        const oldTaskState = task.status;
        const taskStatus = normalizedDecision as 'approved' | 'rejected';

        const updatedTask = await pool.query(`
            UPDATE project_workflow_tasks
            SET status = $1,
                super_admin_comment = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [taskStatus, comment || null, id]);

        const projectReviewStatus = normalizedDecision === 'approved' ? 'Approved' : 'Rejected';
        await pool.query(`
            UPDATE investment_projects
            SET review_status = $1,
                ceo_comment = $2,
                updated_by = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [projectReviewStatus, comment || null, userId, task.investment_project_id]);

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: id,
            oldState: oldTaskState,
            newState: taskStatus,
            changedBy: userId,
            note: comment || `Super admin marked task ${taskStatus}`,
        });

        await recordWorkflowTransition({
            entityType: 'investment_project',
            entityId: task.investment_project_id,
            oldState: task.review_status,
            newState: projectReviewStatus,
            changedBy: userId,
            note: comment || `Project moved by task review: ${taskStatus}`,
            metadata: {
                workflowTaskId: id,
            },
        });

        if (normalizedDecision === 'approved') {
            await upsertStationFromProject(task.investment_project_id, userId);
        }

        res.status(200).json({
            message: `Task ${taskStatus} successfully`,
            data: updatedTask.rows[0],
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to review workflow task', details: error.message });
    }
};

export const createWorkflowTaskForProject = async (
    projectId: string,
    flowType: WorkflowTaskFlowType,
    actorId: string,
): Promise<void> => {
    await ensureWorkflowSchema();

    const projectResult = await pool.query(
        'SELECT id, project_name, project_code, department_type FROM investment_projects WHERE id = $1 LIMIT 1',
        [projectId],
    );
    if (!projectResult.rows.length) {
        return;
    }

    const project = projectResult.rows[0];
    const existing = await pool.query(
        'SELECT id FROM project_workflow_tasks WHERE investment_project_id = $1 AND flow_type = $2 LIMIT 1',
        [projectId, flowType],
    );
    if (existing.rows.length) {
        return;
    }

    const titlePrefix = flowType === 'contract' ? 'Contract Workflow' : 'Documents Workflow';
    await pool.query(`
        INSERT INTO project_workflow_tasks (
            investment_project_id,
            title,
            description,
            flow_type,
            origin_department,
            target_department,
            created_by,
            assigned_by
        )
        VALUES ($1, $2, $3, $4, $5, $5, $6, $6)
    `, [
        project.id,
        `${titlePrefix} - ${project.project_name}`,
        `${titlePrefix} created for project ${project.project_code}.`,
        flowType,
        project.department_type,
        actorId,
    ]);

    const insertedTask = await pool.query(
        'SELECT id FROM project_workflow_tasks WHERE investment_project_id = $1 AND flow_type = $2 ORDER BY created_at DESC LIMIT 1',
        [project.id, flowType],
    );

    if (insertedTask.rows.length) {
        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: insertedTask.rows[0].id,
            oldState: null,
            newState: 'manager_queue',
            changedBy: actorId,
            note: `${flowType} workflow task auto-created`,
            metadata: {
                projectId,
                flowType,
            },
        });
    }
};
