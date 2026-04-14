import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';
import { ensureWorkflowSchema, WorkflowTaskFlowType, recordWorkflowTransition } from '../utils/workflow';
import { isSchemaCompatibilityError } from '../utils/dbErrors';
import { recordActivity } from '../utils/activity';

const normalizeDepartment = (
    value: unknown,
):
    | 'investment'
    | 'franchise'
    | 'it'
    | 'project'
    | 'finance'
    | 'operation'
    | 'maintanance'
    | 'hr'
    | 'realestate'
    | 'procurement'
    | 'quality'
    | 'marketing'
    | 'property_management'
    | 'legal'
    | 'government_relations'
    | 'safety'
    | 'ceo'
    | null => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'investment') return 'investment';
    if (normalized === 'franchise' || normalized === 'frenchise') return 'franchise';
    if (normalized === 'it') return 'it';
    if (normalized === 'project') return 'project';
    if (normalized === 'finance') return 'finance';
    if (normalized === 'operation' || normalized === 'operations') return 'operation';
    if (normalized === 'maintanance' || normalized === 'maintenance') return 'maintanance';
    if (normalized === 'hr') return 'hr';
    if (normalized === 'realestate' || normalized === 'real_estate') return 'realestate';
    if (normalized === 'procurement') return 'procurement';
    if (normalized === 'quality') return 'quality';
    if (normalized === 'marketing') return 'marketing';
    if (normalized === 'property_management' || normalized === 'property management') return 'property_management';
    if (normalized === 'legal') return 'legal';
    if (normalized === 'government_relations' || normalized === 'government relations') return 'government_relations';
    if (normalized === 'safety') return 'safety';
    if (normalized === 'ceo') return 'ceo';
    return null;
};

const normalizeStationType = (value: unknown): 'investment' | 'franchise' | 'operation' | 'rent' | 'ownership' => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'frenchise') return 'franchise';
    if (normalized === 'franchise') return 'franchise';
    if (normalized === 'operation') return 'operation';
    if (normalized === 'rent') return 'rent';
    if (normalized === 'ownership') return 'ownership';
    return 'investment';
};

const isValidHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

const upsertStationFromProject = async (projectId: string, userId: string): Promise<void> => {
    const projectResult = await pool.query('SELECT * FROM investment_projects WHERE id = $1 LIMIT 1', [projectId]);
    if (!projectResult.rows.length) {
        return;
    }

    const project = projectResult.rows[0];
    const stationCode = String(project.project_code || '').trim();
    const stationName = String(project.project_name || '').trim();

    if (!stationCode || !stationName) {
        throw new Error('Station creation failed: project code and project name are required');
    }

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
        stationCode,
        stationName,
        project.city,
        project.district,
        project.google_location,
        normalizeStationType(project.department_type),
        project.project_status || 'Active',
        userId,
    ]);
};

export const getWorkflowTasks = async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userDepartment = req.user?.department;

    if (!userId || !userRole) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const parsedLimit = Number.parseInt(String(req.query?.limit || ''), 10);
    const parsedOffset = Number.parseInt(String(req.query?.offset || ''), 10);
    const usePagination = Number.isFinite(parsedLimit) && parsedLimit > 0;
    const safeLimit = usePagination ? Math.min(parsedLimit, 500) : null;
    const safeOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

    const executeTaskQuery = async (): Promise<any[]> => {
        let query = `
            SELECT
                t.*,
                COALESCE(p.project_name, t.title) AS project_name,
                COALESCE(p.project_code, t.id::text) AS project_code,
                p.review_status,
                p.department_type,
                p.workflow_path,
                p.city,
                au.username AS assigned_to_username,
                aby.username AS assigned_by_username,
                aup.username AS attachment_uploaded_by_username,
                acu.username AS created_by_username
            FROM project_workflow_tasks t
            LEFT JOIN investment_projects p ON p.id = t.investment_project_id
            LEFT JOIN users au ON au.id = t.assigned_to
            LEFT JOIN users aby ON aby.id = t.assigned_by
            LEFT JOIN users aup ON aup.id = t.attachment_uploaded_by
            LEFT JOIN users acu ON acu.id = t.created_by
        `;
        const params: unknown[] = [];
        const restrictInvestmentProjectTasks = userRole !== 'super_admin' && normalizeDepartment(userDepartment) !== 'project';
        const investmentProjectTaskVisibilityClause = restrictInvestmentProjectTasks
            ? `
                AND NOT (
                    t.investment_project_id IS NOT NULL
                    AND LOWER(COALESCE(p.department_type, '')) IN ('investment', 'franchise', 'frenchise')
                )
            `
            : '';

        if (userRole !== 'super_admin') {
            const department = normalizeDepartment(userDepartment);
            if (!department && userRole === 'department_manager') {
                throw new Error('Department is required for this action');
            }

            if (userRole === 'department_manager') {
                query += `
                    WHERE (
                        (
                        t.flow_type IN ('request', 'ceo_contact')
                        AND (t.assigned_to = $2 OR t.created_by = $2)
                    )
                    OR (
                        (t.flow_type NOT IN ('request', 'ceo_contact') OR t.flow_type IS NULL)
                        AND (
                            t.origin_department = $1
                            OR t.target_department = $1
                            OR t.assigned_to = $2
                            OR t.created_by = $2
                        )
                    )
                    )
                `;
                params.push(department, userId);
                query += investmentProjectTaskVisibilityClause;
            } else {
                // Supervisors/employees should only see tasks explicitly assigned to them.
                query += ' WHERE (t.assigned_to = $1 OR t.created_by = $1)';
                params.push(userId);
                query += investmentProjectTaskVisibilityClause;
            }
        }

        query += ' ORDER BY t.created_at DESC';

        if (usePagination && safeLimit !== null) {
            params.push(safeLimit, safeOffset);
            query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }

        const result = await pool.query(query, params);
        return result.rows;
    };

    try {
        await ensureWorkflowSchema();
        const rows = await executeTaskQuery();
        res.status(200).json({ data: rows });
    } catch (error: any) {
        if (error?.message === 'Department is required for this action') {
            res.status(403).json({ error: error.message });
            return;
        }

        if (isSchemaCompatibilityError(error)) {
            try {
                await ensureWorkflowSchema();
                const rows = await executeTaskQuery();
                res.status(200).json({ data: rows });
                return;
            } catch (retryError: any) {
                res.status(500).json({ error: 'Failed to fetch workflow tasks', details: retryError.message });
                return;
            }
        }

        res.status(500).json({ error: 'Failed to fetch workflow tasks', details: error.message });
    }
};

export const getAssignableUsers = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userRole = req.user?.role;
        const targetDepartment = normalizeDepartment(req.query?.targetDepartment);

        if (!userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!(userRole === 'department_manager' || userRole === 'super_admin' || userRole === 'supervisor')) {
            res.status(403).json({ error: 'Only department managers, supervisors, or super admin can view assignable users' });
            return;
        }

        let query = `
            SELECT id, username, role, department
            FROM users
            WHERE role IN ('employee', 'supervisor', 'department_manager')
        `;
        const params: unknown[] = [];

        if (targetDepartment) {
            query += ' AND department = $1';
            params.push(targetDepartment);
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
        const { assignedToUserId, targetDepartment, assigneeNote } = req.body as {
            assignedToUserId?: string;
            targetDepartment?: string;
            assigneeNote?: string;
        };
        const actorId = req.user?.id;
        const actorRole = req.user?.role;
        const actorDepartment = normalizeDepartment(req.user?.department);

        if (!actorId || !actorRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!(actorRole === 'department_manager' || actorRole === 'super_admin' || actorRole === 'supervisor')) {
            res.status(403).json({ error: 'Only department managers, supervisors, or super admin can assign tasks' });
            return;
        }

        if (!assignedToUserId) {
            res.status(400).json({ error: 'assignedToUserId is required' });
            return;
        }

        const assignee = await pool.query('SELECT id, role, department FROM users WHERE id = $1 LIMIT 1', [assignedToUserId]);
        if (!assignee.rows.length) {
            res.status(404).json({ error: 'Assignee not found' });
            return;
        }

        const resolvedTargetDepartment = normalizeDepartment(targetDepartment) || normalizeDepartment(assignee.rows[0].department);
        if (!resolvedTargetDepartment) {
            res.status(400).json({ error: 'A valid target department is required' });
            return;
        }

        const taskLookup = await pool.query(`
            SELECT t.status, t.assigned_to, t.origin_department, t.target_department, p.workflow_path
            FROM project_workflow_tasks t
            JOIN investment_projects p ON p.id = t.investment_project_id
            WHERE t.id = $1
            LIMIT 1
        `, [id]);
        if (!taskLookup.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskLookup.rows[0];

        if (actorRole !== 'super_admin') {
            if (!actorDepartment) {
                res.status(403).json({ error: 'Department is required for this action' });
                return;
            }

            const belongsToActorDepartment =
                task.origin_department === actorDepartment || task.target_department === actorDepartment;

            if (!belongsToActorDepartment && task.assigned_to !== actorId) {
                res.status(403).json({ error: 'You are not allowed to assign this task' });
                return;
            }

            if (resolvedTargetDepartment !== actorDepartment) {
                res.status(403).json({ error: 'Department managers and supervisors can only assign within their own department' });
                return;
            }
        }

        if (task.status !== 'manager_queue' || task.assigned_to) {
            res.status(409).json({ error: 'Task is already assigned and cannot be reassigned' });
            return;
        }

        if (normalizeDepartment(assignee.rows[0].department) !== resolvedTargetDepartment) {
            res.status(400).json({ error: 'Assignee department must match target department' });
            return;
        }

        if (actorRole === 'super_admin' && task.workflow_path && assignee.rows[0].role !== 'department_manager') {
            res.status(403).json({ error: 'For contract/document branch, super admin can assign only to department managers' });
            return;
        }

        const result = await pool.query(`
            UPDATE project_workflow_tasks
            SET assigned_to = $1,
                assigned_by = $2,
                target_department = $3,
                assignee_note = $4,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
              AND status = 'manager_queue'
              AND assigned_to IS NULL
            RETURNING *
        `, [assignedToUserId, actorId, resolvedTargetDepartment, String(assigneeNote || '').trim() || null, id]);

        if (!result.rows.length) {
            res.status(409).json({ error: 'Task is already assigned and cannot be reassigned' });
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
                assigneeNote: String(assigneeNote || '').trim() || null,
            },
        });

        // Log activity
        void recordActivity({
            actorId,
            action: 'assign',
            entityType: 'workflow_task',
            entityId: id,
            summary: 'assigned workflow task to employee',
            metadata: {
                assignedToUserId,
                targetDepartment: resolvedTargetDepartment,
            },
            sourcePath: '/api/workflow-tasks/:id/assign',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

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
        const userId = req.user?.id;

        if (!(userRole === 'department_manager' || userRole === 'super_admin')) {
            res.status(403).json({ error: 'Only department managers or super admin can add manager attachment' });
            return;
        }

        if (!attachmentUrl) {
            res.status(400).json({ error: 'attachmentUrl is required' });
            return;
        }

        if (!isValidHttpUrl(attachmentUrl)) {
            res.status(400).json({ error: 'attachmentUrl must be a valid http/https URL' });
            return;
        }

        const result = await pool.query(`
            UPDATE project_workflow_tasks
            SET manager_attachment_url = $1,
                manager_note = $2,
                attachment_url = $1,
                attachment_note = $2,
                attachment_uploaded_by = $3,
                attachment_uploaded_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `, [attachmentUrl, note || null, userId || null, id]);

        if (!result.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        // Log activity
        void recordActivity({
            actorId: userId,
            action: 'upload',
            entityType: 'workflow_task',
            entityId: id,
            summary: 'uploaded manager attachment',
            metadata: {
                hasNote: Boolean(note),
                isUrl: true,
            },
            sourcePath: '/api/workflow-tasks/:id/manager-attachment',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

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

        const normalizedAttachmentUrl = String(attachmentUrl || '').trim();
        if (normalizedAttachmentUrl && !isValidHttpUrl(normalizedAttachmentUrl)) {
            res.status(400).json({ error: 'attachmentUrl must be a valid http/https URL' });
            return;
        }

        const taskLookup = await pool.query(`
            SELECT t.*, p.workflow_path
            FROM project_workflow_tasks t
            JOIN investment_projects p ON p.id = t.investment_project_id
            WHERE t.id = $1
            LIMIT 1
        `, [id]);
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

        const resolvedAttachment =
            normalizedAttachmentUrl
            || task.attachment_url
            || task.employee_attachment_url
            || task.manager_attachment_url;
        const hasAtLeastOneAttachment = Boolean(resolvedAttachment);
        if (!hasAtLeastOneAttachment) {
            res.status(400).json({
                error: 'Attachment is required before submitting.',
            });
            return;
        }

        const nextStatus = task.workflow_path ? 'manager_submitted' : 'employee_submitted';

        const result = await pool.query(`
            UPDATE project_workflow_tasks
            SET employee_attachment_url = $1,
                employee_note = $2,
                attachment_url = $1,
                attachment_note = $2,
                attachment_uploaded_by = $3,
                attachment_uploaded_at = CURRENT_TIMESTAMP,
                status = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `, [resolvedAttachment, note || null, userId, nextStatus, id]);

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: id,
            oldState,
            newState: nextStatus,
            changedBy: userId,
            note: note || 'Employee submitted attachment',
            metadata: {
                attachmentUrl: resolvedAttachment,
                usedExistingAttachment: !normalizedAttachmentUrl,
                branchWorkflow: Boolean(task.workflow_path),
            },
        });

        // Log activity
        void recordActivity({
            actorId: userId,
            action: 'submit',
            entityType: 'workflow_task',
            entityId: id,
            summary: nextStatus === 'manager_submitted' ? 'submitted to manager' : 'submitted attachment',
            metadata: {
                newStatus: nextStatus,
                hasNote: Boolean(note),
                usedExistingAttachment: !normalizedAttachmentUrl,
            },
            sourcePath: '/api/workflow-tasks/:id/submit-attachment',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(200).json({
            message: nextStatus === 'manager_submitted'
                ? 'Branch submission completed and awaiting Super Admin review'
                : 'Submission sent back to department manager for validation',
            data: result.rows[0],
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to submit employee attachment', details: error.message });
    }
};

export const managerValidateWorkflowTask = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const { id } = req.params;
        const { comment } = req.body as { comment?: string };
        const userId = req.user?.id;
        const userRole = req.user?.role;
        const userDepartment = normalizeDepartment(req.user?.department);

        if (!userId || !userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!(userRole === 'department_manager' || userRole === 'super_admin')) {
            res.status(403).json({ error: 'Only department manager or super admin can validate tasks' });
            return;
        }

        const taskLookup = await pool.query(`
            SELECT t.*, p.workflow_path, p.review_status
            FROM project_workflow_tasks t
            JOIN investment_projects p ON p.id = t.investment_project_id
            WHERE t.id = $1
            LIMIT 1
        `, [id]);

        if (!taskLookup.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskLookup.rows[0];

        const projectScopeResult = await pool.query(
            `SELECT LOWER(COALESCE(department_type, '')) AS department_type
             FROM investment_projects
             WHERE id = $1
             LIMIT 1`,
            [task.investment_project_id],
        );
        const projectDepartmentType = String(projectScopeResult.rows[0]?.department_type || '');
        const isProtectedProjectTask = projectDepartmentType === 'investment' || projectDepartmentType === 'franchise' || projectDepartmentType === 'frenchise';

        if (isProtectedProjectTask && userRole !== 'super_admin' && userDepartment !== 'project') {
            res.status(403).json({ error: 'Only project department manager or super admin can validate this project task' });
            return;
        }

        if (userRole !== 'super_admin') {
            if (!userDepartment) {
                res.status(403).json({ error: 'Department is required for this action' });
                return;
            }

            const belongsToActorDepartment =
                task.origin_department === userDepartment || task.target_department === userDepartment;

            if (!belongsToActorDepartment && task.assigned_to !== userId) {
                res.status(403).json({ error: 'You are not allowed to validate this task' });
                return;
            }
        }

        if (task.workflow_path) {
            res.status(409).json({ error: 'Manager validation is only allowed for initial review stage' });
            return;
        }

        if (!(task.status === 'manager_queue' || task.status === 'employee_submitted')) {
            res.status(409).json({ error: 'Task must be in manager queue or employee submitted state before validation' });
            return;
        }

        const hasAttachment = Boolean(task.attachment_url || task.employee_attachment_url || task.manager_attachment_url);
        if (!hasAttachment) {
            res.status(400).json({ error: 'One attachment is required before manager validation.' });
            return;
        }

        const oldTaskState = task.status;

        const taskResult = await pool.query(`
            UPDATE project_workflow_tasks
            SET status = 'under_super_admin_review',
                manager_note = COALESCE($1, manager_note),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [comment || null, id]);

        await pool.query(`
            UPDATE investment_projects
            SET review_status = 'Validated',
                pm_comment = COALESCE($1, pm_comment),
                updated_by = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [comment || null, userId, task.investment_project_id]);

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: id,
            oldState: oldTaskState,
            newState: 'under_super_admin_review',
            changedBy: userId,
            note: comment || 'Department manager validated task',
            metadata: {
                actorRole: userRole,
            },
        });

        await recordWorkflowTransition({
            entityType: 'investment_project',
            entityId: task.investment_project_id,
            oldState: task.review_status,
            newState: 'Validated',
            changedBy: userId,
            note: comment || 'Project validated by department manager',
            metadata: {
                workflowTaskId: id,
                actorRole: userRole,
            },
        });

        // Log activity
        void recordActivity({
            actorId: userId,
            action: 'validate',
            entityType: 'workflow_task',
            entityId: id,
            summary: 'validated task and moved to super admin review',
            metadata: {
                projectId: task.investment_project_id,
                hasComment: Boolean(comment),
            },
            sourcePath: '/api/workflow-tasks/:id/validate',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(200).json({
            message: 'Task validated and moved to super admin review',
            data: taskResult.rows[0],
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to validate workflow task', details: error.message });
    }
};

export const reviewWorkflowTask = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const { id } = req.params;
        const { decision, comment, assignedToUserId, targetDepartment } = req.body as {
            decision?: string;
            comment?: string;
            assignedToUserId?: string;
            targetDepartment?: string;
        };
        const userRole = req.user?.role;
        const userId = req.user?.id;

        if (!userId || !userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const normalizedDecision = String(decision || '').trim().toLowerCase();
        if (!(normalizedDecision === 'approved' || normalizedDecision === 'rejected' || normalizedDecision === 'contract' || normalizedDecision === 'document' || normalizedDecision === 'documents')) {
            res.status(400).json({ error: 'decision must be approved, rejected, contract, or document' });
            return;
        }

        const taskLookup = await pool.query(`
            SELECT t.*, p.workflow_path, p.review_status
            FROM project_workflow_tasks t
            LEFT JOIN investment_projects p ON p.id = t.investment_project_id
            WHERE t.id = $1
            LIMIT 1
        `, [id]);
        if (!taskLookup.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskLookup.rows[0];
        const oldTaskState = task.status;

        const isGenericTask = task.flow_type === 'request' || task.flow_type === 'ceo_contact' || !task.investment_project_id;

        if (isGenericTask) {
            if (!(normalizedDecision === 'approved' || normalizedDecision === 'rejected')) {
                res.status(400).json({ error: 'decision must be approved or rejected for request and CEO contact tasks' });
                return;
            }

            if (!(task.status === 'assigned' || task.status === 'manager_queue')) {
                res.status(409).json({ error: 'Task must be assigned before review' });
                return;
            }

            if (task.flow_type === 'ceo_contact' && userRole !== 'super_admin') {
                res.status(403).json({ error: 'Only super admin can review CEO contact tasks' });
                return;
            }

            if (task.flow_type === 'request' && !(userRole === 'department_manager' || userRole === 'super_admin')) {
                res.status(403).json({ error: 'Only department managers or super admin can review request tasks' });
                return;
            }

            if (userRole !== 'super_admin') {
                const actorDepartment = normalizeDepartment(req.user?.department);
                if (!actorDepartment) {
                    res.status(403).json({ error: 'Department is required for this action' });
                    return;
                }

                const belongsToActorDepartment = task.origin_department === actorDepartment || task.target_department === actorDepartment;
                if (!belongsToActorDepartment && task.assigned_to !== userId) {
                    res.status(403).json({ error: 'You are not allowed to review this task' });
                    return;
                }
            }

            const nextStatus = normalizedDecision as 'approved' | 'rejected';
            const noteColumn = userRole === 'super_admin' ? 'super_admin_comment' : 'manager_note';
            const updatedTask = await pool.query(`
                UPDATE project_workflow_tasks
                SET status = $1,
                    ${noteColumn} = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
                RETURNING *
            `, [nextStatus, comment || null, id]);

            await recordWorkflowTransition({
                entityType: 'workflow_task',
                entityId: id,
                oldState: oldTaskState,
                newState: nextStatus,
                changedBy: userId,
                note: comment || `Task ${nextStatus}`,
                metadata: {
                    taskType: task.flow_type,
                    actorRole: userRole,
                },
            });

            void recordActivity({
                actorId: userId,
                action: normalizedDecision === 'approved' ? 'approve' : 'reject',
                entityType: 'workflow_task',
                entityId: id,
                summary: `${normalizedDecision === 'approved' ? 'approved' : 'rejected'} ${task.flow_type.replace('_', ' ')} task`,
                metadata: {
                    taskType: task.flow_type,
                    hasComment: Boolean(comment),
                },
                sourcePath: '/api/workflow-tasks/:id/review',
                requestMethod: 'POST',
            }).catch((err) => console.error('Activity log failed:', err));

            res.status(200).json({
                message: `Task ${nextStatus} successfully`,
                data: updatedTask.rows[0],
            });
            return;
        }

        if (userRole !== 'super_admin') {
            res.status(403).json({ error: 'Only super admin can review workflow tasks' });
            return;
        }

        if (normalizedDecision === 'contract' || normalizedDecision === 'document' || normalizedDecision === 'documents') {
            const normalizedBranch = normalizedDecision === 'contract' ? 'contract' : 'documents';
            if (!assignedToUserId) {
                res.status(400).json({ error: 'assignedToUserId is required for contract/document routing' });
                return;
            }

            const assignee = await pool.query('SELECT id, role, department FROM users WHERE id = $1 LIMIT 1', [assignedToUserId]);
            if (!assignee.rows.length) {
                res.status(404).json({ error: 'Assignee not found' });
                return;
            }

            const resolvedTargetDepartment = normalizeDepartment(targetDepartment) || normalizeDepartment(assignee.rows[0].department);
            if (!resolvedTargetDepartment) {
                res.status(400).json({ error: 'A valid target department is required' });
                return;
            }

            if (assignee.rows[0].role !== 'department_manager') {
                res.status(403).json({ error: 'Branch tasks can only be assigned to department managers' });
                return;
            }

            if (normalizeDepartment(assignee.rows[0].department) !== resolvedTargetDepartment) {
                res.status(400).json({ error: 'Assignee department must match target department' });
                return;
            }

            const updatedTask = await pool.query(`
                UPDATE project_workflow_tasks
                SET status = 'assigned',
                    flow_type = $1,
                    assigned_to = $2,
                    assigned_by = $3,
                    target_department = $4,
                    super_admin_comment = $5,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $6
                RETURNING *
            `, [normalizedBranch, assignedToUserId, userId, resolvedTargetDepartment, comment || null, id]);

            await pool.query(`
                UPDATE investment_projects
                SET review_status = 'Validated',
                    workflow_path = $1,
                    ceo_comment = $2,
                    updated_by = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
            `, [normalizedBranch, comment || null, userId, task.investment_project_id]);

            await recordWorkflowTransition({
                entityType: 'workflow_task',
                entityId: id,
                oldState: oldTaskState,
                newState: 'assigned',
                changedBy: userId,
                note: comment || `Super admin routed task to ${normalizedBranch} branch`,
                metadata: {
                    branch: normalizedBranch,
                    assignedToUserId,
                    targetDepartment: resolvedTargetDepartment,
                },
            });

            res.status(200).json({
                message: `Task routed to ${normalizedBranch} branch and assigned to manager`,
                data: updatedTask.rows[0],
            });
            return;
        }

        if (!(task.status === 'manager_submitted' || task.status === 'under_super_admin_review')) {
            res.status(409).json({ error: 'Task must be submitted by a manager or be under super admin review before final decision' });
            return;
        }

        const hasAttachment = Boolean(task.attachment_url || task.manager_attachment_url || task.employee_attachment_url);
        if (!hasAttachment) {
            res.status(400).json({
                error: 'Review cannot proceed without an attachment.',
            });
            return;
        }

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

        // Log activity
        void recordActivity({
            actorId: userId,
            action: normalizedDecision === 'approved' ? 'approve' : 'reject',
            entityType: 'workflow_task',
            entityId: id,
            summary: `${normalizedDecision === 'approved' ? 'approved' : 'rejected'} task`,
            metadata: {
                projectId: task.investment_project_id,
                decision: normalizedDecision,
                hasComment: Boolean(comment),
            },
            sourcePath: '/api/workflow-tasks/:id/review',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

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

export const getWorkflowTaskHistory = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const { id } = req.params;
        const userId = req.user?.id;
        const userRole = req.user?.role;

        if (!userId || !userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const taskResult = await pool.query(`
            SELECT
                t.*,
                COALESCE(p.project_name, t.title) AS project_name,
                COALESCE(p.project_code, t.id::text) AS project_code,
                p.review_status,
                p.department_type,
                p.workflow_path,
                au.username AS assigned_to_username,
                aby.username AS assigned_by_username,
                aup.username AS attachment_uploaded_by_username
            FROM project_workflow_tasks t
            LEFT JOIN investment_projects p ON p.id = t.investment_project_id
            LEFT JOIN users au ON au.id = t.assigned_to
            LEFT JOIN users aby ON aby.id = t.assigned_by
            LEFT JOIN users aup ON aup.id = t.attachment_uploaded_by
            WHERE t.id = $1
            LIMIT 1
        `, [id]);

        if (!taskResult.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskResult.rows[0];

        const auditResult = await pool.query(`
            SELECT
                a.id,
                a.entity_type,
                a.entity_id,
                a.old_state,
                a.new_state,
                a.note,
                a.metadata,
                a.created_at,
                u.username AS changed_by_username,
                u.role AS changed_by_role
            FROM workflow_transition_audit a
            LEFT JOIN users u ON u.id = a.changed_by
            WHERE (a.entity_type = 'workflow_task' AND a.entity_id = $1)
               OR (a.entity_type = 'investment_project' AND a.entity_id = $2)
            ORDER BY a.created_at ASC
        `, [task.id, task.investment_project_id]);

        res.status(200).json({
            data: {
                task,
                history: auditResult.rows,
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch workflow task history', details: error.message });
    }
};

export const createInitialReviewTaskForProject = async (
    projectId: string,
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

    const existing = await pool.query(
        'SELECT id FROM project_workflow_tasks WHERE investment_project_id = $1 LIMIT 1',
        [projectId],
    );
    if (existing.rows.length) {
        return;
    }

    const project = projectResult.rows[0];
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
    `, [
        project.id,
        `Initial Review - ${project.project_name}`,
        `Initial manager review created for project ${project.project_code}.`,
        'documents',
        'project',
        'project',
        actorId,
    ]);

    const insertedTask = await pool.query(
        'SELECT id FROM project_workflow_tasks WHERE investment_project_id = $1 ORDER BY created_at DESC LIMIT 1',
        [project.id],
    );

    if (insertedTask.rows.length) {
        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: insertedTask.rows[0].id,
            oldState: null,
            newState: 'manager_queue',
            changedBy: actorId,
            note: 'Initial review task auto-created',
            metadata: {
                projectId,
                stage: 'initial_review',
            },
        });
    }
};

export const submitManagerAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
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

        const normalizedAttachmentUrl = String(attachmentUrl || '').trim();
        if (normalizedAttachmentUrl && !isValidHttpUrl(normalizedAttachmentUrl)) {
            res.status(400).json({ error: 'attachmentUrl must be a valid http/https URL' });
            return;
        }

        const taskLookup = await pool.query(`
            SELECT t.*, p.review_status, p.workflow_path
            FROM project_workflow_tasks t
            JOIN investment_projects p ON p.id = t.investment_project_id
            WHERE t.id = $1
            LIMIT 1
        `, [id]);

        if (!taskLookup.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskLookup.rows[0];
        if (task.status !== 'assigned') {
            res.status(409).json({ error: 'Branch submission can only be completed from assigned status' });
            return;
        }

        const canSubmit = userRole === 'super_admin' || task.assigned_to === userId;
        if (!canSubmit) {
            res.status(403).json({ error: 'Only the assigned manager can submit this branch task' });
            return;
        }

        if (!normalizedAttachmentUrl) {
            res.status(400).json({ error: 'attachmentUrl is required' });
            return;
        }

        const updatedTask = await pool.query(`
            UPDATE project_workflow_tasks
            SET manager_attachment_url = $1,
                manager_note = $2,
                status = 'under_super_admin_review',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [normalizedAttachmentUrl, note || null, id]);

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: id,
            oldState: task.status,
            newState: 'under_super_admin_review',
            changedBy: userId,
            note: note || 'Manager submitted branch attachment',
            metadata: {
                attachmentUrl: normalizedAttachmentUrl,
                workflowPath: task.workflow_path,
            },
        });

        res.status(200).json({ message: 'Branch submission sent to Super Admin review', data: updatedTask.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to submit manager attachment', details: error.message });
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
        normalizeDepartment(project.department_type) || 'investment',
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
