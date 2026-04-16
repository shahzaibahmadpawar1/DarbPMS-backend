import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';
import { ensureWorkflowSchema, recordWorkflowTransition } from '../utils/workflow';
import { recordActivity } from '../utils/activity';

export const submitCeoContact = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();

        const userId = req.user?.id;
        const username = req.user?.username || 'Requester';
        const {
            senderName,
            senderEmail,
            senderPhone,
            department,
            category,
            priority,
            subject,
            description,
            attachments,
        } = req.body as {
            senderName?: string;
            senderEmail?: string;
            senderPhone?: string;
            department?: string;
            category?: string;
            priority?: string;
            subject?: string;
            description?: string;
            attachments?: Array<{ name?: string; url?: string }>;
        };

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const trimmedSenderName = String(senderName || username).trim();
        const trimmedSenderEmail = String(senderEmail || '').trim();
        const trimmedSubject = String(subject || '').trim();
        const trimmedDescription = String(description || '').trim();
        if (!trimmedSenderName || !trimmedSenderEmail || !trimmedSubject || !trimmedDescription) {
            res.status(400).json({ error: 'Name, email, subject, and message are required' });
            return;
        }

        const reviewer = await pool.query(
            `SELECT id FROM users WHERE role = 'ceo' ORDER BY created_at ASC LIMIT 1`,
        );

        const fallbackReviewer = reviewer.rows.length ? reviewer : await pool.query(
            `SELECT id FROM users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1`,
        );

        if (!fallbackReviewer.rows.length) {
            res.status(404).json({ error: 'No CEO or super admin found to receive this message' });
            return;
        }

        const metadata = {
            senderName: trimmedSenderName,
            senderEmail: trimmedSenderEmail,
            senderPhone: String(senderPhone || '').trim() || null,
            department: String(department || '').trim() || null,
            category: String(category || '').trim() || null,
            priority: String(priority || '').trim() || null,
            subject: trimmedSubject,
            message: trimmedDescription,
            attachments: Array.isArray(attachments) ? attachments : [],
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
                    'ceo_contact',
                    'assigned',
                    'ceo',
                    'ceo',
                    $3,
                    $4,
                    $4,
                    $5::jsonb
                )
                RETURNING *
            `,
            [
                `CEO Contact - ${trimmedSubject}`,
                trimmedDescription,
                fallbackReviewer.rows[0].id,
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
            note: 'CEO contact submitted for executive review',
            metadata: {
                taskType: 'ceo_contact',
                requesterId: userId,
            },
        });

        void recordActivity({
            actorId: userId,
            action: 'create',
            entityType: 'workflow_task',
            entityId: taskResult.rows[0].id,
            summary: 'created CEO contact task',
            metadata: {
                taskType: 'ceo_contact',
                category: category || null,
                priority: priority || null,
            },
            sourcePath: '/api/ceo-contact/submit',
            requestMethod: 'POST',
        }).catch((error) => console.error('Activity log failed:', error));

        res.status(201).json({
            message: 'CEO contact form submitted successfully',
            data: taskResult.rows[0],
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to submit CEO contact form', details: error.message });
    }
};
