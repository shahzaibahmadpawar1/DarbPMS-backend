import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';
import { recordWorkflowTransition } from '../utils/workflow';
import { recordActivity } from '../utils/activity';
import { isValidRequestTypeForDepartment } from '../utils/requestTypes';

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

export const submitRequest = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        const username = req.user?.username || 'Requester';
        const { requestType, department, priority, subject, dueDate, description, stationCodes } = req.body as {
            requestType?: string;
            department?: string;
            priority?: string;
            subject?: string;
            dueDate?: string;
            description?: string;
            stationCodes?: unknown;
        };

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const normalizedDepartment = normalizeDepartment(department);
        if (!normalizedDepartment || normalizedDepartment === 'ceo') {
            res.status(400).json({ error: 'A valid department is required' });
            return;
        }

        const normalizedRequestType = String(requestType || '').trim().toLowerCase();
        if (!isValidRequestTypeForDepartment(normalizedDepartment, normalizedRequestType)) {
            res.status(400).json({ error: 'Invalid request type for the selected department' });
            return;
        }

        const normalizedStationCodes = Array.isArray(stationCodes)
            ? Array.from(new Set(
                stationCodes
                    .map((code) => String(code || '').trim())
                    .filter((code) => code.length > 0),
            ))
            : [];

        const trimmedSubject = String(subject || '').trim();
        const trimmedDescription = String(description || '').trim();
        if (!trimmedSubject || !trimmedDescription) {
            res.status(400).json({ error: 'Subject and description are required' });
            return;
        }

        const reviewerPromise = pool.query(
            `SELECT id, username FROM users WHERE role = 'department_manager' AND department = $1 ORDER BY created_at ASC LIMIT 1`,
            [normalizedDepartment],
        );

        const stationValidationPromise = normalizedStationCodes.length > 0
            ? pool.query(
                'SELECT station_code FROM station_information WHERE station_code = ANY($1::text[])',
                [normalizedStationCodes],
            )
            : Promise.resolve({ rows: [] as Array<{ station_code: string }> });

        const [reviewer, stationsResult] = await Promise.all([reviewerPromise, stationValidationPromise]);

        if (normalizedStationCodes.length > 0) {
            const existingCodes = new Set<string>(stationsResult.rows.map((row) => String(row.station_code)));
            const missingCodes = normalizedStationCodes.filter((code) => !existingCodes.has(code));
            if (missingCodes.length > 0) {
                res.status(400).json({ error: `Unknown station codes: ${missingCodes.join(', ')}` });
                return;
            }
        }

        if (!reviewer.rows.length) {
            res.status(404).json({ error: 'No department manager found for the selected department' });
            return;
        }

        const metadata = {
            requestType: normalizedRequestType,
            department: normalizedDepartment,
            priority: priority || null,
            subject: trimmedSubject,
            dueDate: dueDate || null,
            description: trimmedDescription,
            stationCodes: normalizedStationCodes,
            requester: {
                id: userId,
                username,
            },
        };

        const taskResult = await pool.query(
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
                    created_by,
                    metadata
                ) VALUES (
                    NULL,
                    $1,
                    $2,
                    'request',
                    'assigned',
                    $3,
                    $3,
                    $4,
                    $5,
                    $5,
                    $6::jsonb
                )
                RETURNING *
            `,
            [
                trimmedSubject,
                trimmedDescription,
                normalizedDepartment,
                reviewer.rows[0].id,
                userId,
                JSON.stringify(metadata),
            ],
        );

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: taskResult.rows[0].id,
            oldState: null,
            newState: 'assigned',
            changedBy: userId,
            note: 'Request submitted for department manager review',
            metadata: {
                taskType: 'request',
                department: normalizedDepartment,
                requesterId: userId,
            },
        });

        void recordActivity({
            actorId: userId,
            action: 'create',
            entityType: 'workflow_task',
            entityId: taskResult.rows[0].id,
            summary: 'created department request task',
            metadata: {
                taskType: 'request',
                department: normalizedDepartment,
                priority: priority || null,
            },
            sourcePath: '/api/requests/submit',
            requestMethod: 'POST',
        }).catch((error) => console.error('Activity log failed:', error));

        res.status(201).json({
            message: 'Request submitted successfully',
            data: taskResult.rows[0],
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to submit request', details: error.message });
    }
};
