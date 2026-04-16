import pool from '../config/database';

export type WorkflowAction = 'Approve' | 'Contract' | 'Documents' | 'Reject';
export type WorkflowTaskStatus =
    | 'manager_queue'
    | 'assigned'
    | 'complaint_forwarded'
    | 'employee_submitted'
    | 'manager_submitted'
    | 'under_super_admin_review'
    | 'pending_requester_decision'
    | 'approved'
    | 'rejected'
    | 'ceo_rejected'
    | 'requester_accepted'
    | 'requester_declined';
export type WorkflowTaskFlowType = 'contract' | 'documents' | 'request' | 'ceo_contact';
export type WorkflowAuditEntity = 'investment_project' | 'workflow_task';

let workflowSchemaReady = false;

const ensureCheckConstraint = async (tableName: string, constraintName: string, definitionSql: string): Promise<void> => {
    const existing = await pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`,
        [constraintName],
    );

    if (existing.rows.length) {
        return;
    }

    try {
        await pool.query(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definitionSql}`);
    } catch (error: any) {
        // Race-safe: in serverless environments multiple requests may try to add the same constraint.
        // Postgres reports duplicate_object with SQLSTATE 42710.
        if (error?.code === '42710' || String(error?.message || '').toLowerCase().includes('already exists')) {
            return;
        }
        throw error;
    }
};

export const ensureWorkflowSchema = async (): Promise<void> => {
    if (workflowSchemaReady) {
        return;
    }

    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS workflow_path VARCHAR(20)
        CHECK (workflow_path IN ('contract', 'documents'));
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS project_workflow_tasks (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            investment_project_id UUID REFERENCES investment_projects(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            flow_type VARCHAR(20) NOT NULL CHECK (flow_type IN ('contract', 'documents', 'request', 'ceo_contact')),
            status VARCHAR(40) NOT NULL DEFAULT 'manager_queue'
                CHECK (status IN (
                    'manager_queue',
                    'assigned',
                    'complaint_forwarded',
                    'employee_submitted',
                    'manager_submitted',
                    'under_super_admin_review',
                    'pending_requester_decision',
                    'approved',
                    'rejected',
                    'ceo_rejected',
                    'requester_accepted',
                    'requester_declined'
                )),
            origin_department VARCHAR(20) NOT NULL CHECK (origin_department IN ('investment', 'franchise', 'project', 'ceo')),
            target_department VARCHAR(20) NOT NULL CHECK (target_department IN ('investment', 'franchise', 'project', 'ceo')),
            assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
            assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
            metadata JSONB DEFAULT '{}'::jsonb,
            manager_attachment_url TEXT,
            employee_attachment_url TEXT,
            attachment_url TEXT,
            attachment_note TEXT,
            attachment_uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
            attachment_uploaded_at TIMESTAMP WITH TIME ZONE,
            manager_note TEXT,
            employee_note TEXT,
            assignee_note TEXT,
            super_admin_comment TEXT,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        ADD COLUMN IF NOT EXISTS assignee_note TEXT;
    `);

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `);

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        ALTER COLUMN investment_project_id DROP NOT NULL;
    `);

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        DROP CONSTRAINT IF EXISTS project_workflow_tasks_flow_type_check;
    `);

    await ensureCheckConstraint(
        'project_workflow_tasks',
        'project_workflow_tasks_flow_type_check',
        `CHECK (flow_type IN ('contract', 'documents', 'request', 'ceo_contact'))`,
    );

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        DROP CONSTRAINT IF EXISTS project_workflow_tasks_status_check;
    `);
    await ensureCheckConstraint(
        'project_workflow_tasks',
        'project_workflow_tasks_status_check',
        `CHECK (status IN (
            'manager_queue',
            'assigned',
            'complaint_forwarded',
            'employee_submitted',
            'manager_submitted',
            'under_super_admin_review',
            'pending_requester_decision',
            'approved',
            'rejected',
            'ceo_rejected',
            'requester_accepted',
            'requester_declined'
        ))`,
    );

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        ADD COLUMN IF NOT EXISTS attachment_url TEXT;
    `);

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        ADD COLUMN IF NOT EXISTS attachment_note TEXT;
    `);

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        ADD COLUMN IF NOT EXISTS attachment_uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);

    await pool.query(`
        ALTER TABLE project_workflow_tasks
        ADD COLUMN IF NOT EXISTS attachment_uploaded_at TIMESTAMP WITH TIME ZONE;
    `);

    // Normalize legacy check constraints so project and all active departments are accepted.
    await pool.query(`
        ALTER TABLE project_workflow_tasks
        DROP CONSTRAINT IF EXISTS project_workflow_tasks_origin_department_check;
    `);
    await pool.query(`
        ALTER TABLE project_workflow_tasks
        DROP CONSTRAINT IF EXISTS project_workflow_tasks_target_department_check;
    `);
    await ensureCheckConstraint(
        'project_workflow_tasks',
        'project_workflow_tasks_origin_department_check',
        `CHECK (origin_department IN (
            'investment', 'franchise', 'it', 'project', 'finance', 'operation',
            'maintanance', 'hr', 'realestate', 'procurement', 'quality', 'marketing',
            'property_management', 'legal', 'government_relations', 'safety', 'ceo'
        ))`,
    );
    await ensureCheckConstraint(
        'project_workflow_tasks',
        'project_workflow_tasks_target_department_check',
        `CHECK (target_department IN (
            'investment', 'franchise', 'it', 'project', 'finance', 'operation',
            'maintanance', 'hr', 'realestate', 'procurement', 'quality', 'marketing',
            'property_management', 'legal', 'government_relations', 'safety', 'ceo'
        ))`,
    );

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_tasks_project ON project_workflow_tasks(investment_project_id);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON project_workflow_tasks(status);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_tasks_flow_type ON project_workflow_tasks(flow_type);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_tasks_origin_dept ON project_workflow_tasks(origin_department);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_tasks_target_dept ON project_workflow_tasks(target_department);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_tasks_assigned_to ON project_workflow_tasks(assigned_to);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_tasks_created_by ON project_workflow_tasks(created_by);
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_transition_audit (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            entity_type VARCHAR(40) NOT NULL CHECK (entity_type IN ('investment_project', 'workflow_task')),
            entity_id UUID NOT NULL,
            old_state VARCHAR(80),
            new_state VARCHAR(80) NOT NULL,
            changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
            note TEXT,
            metadata JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_audit_entity ON workflow_transition_audit(entity_type, entity_id);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_audit_changed_by ON workflow_transition_audit(changed_by);
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_audit_created_at ON workflow_transition_audit(created_at DESC);
    `);

    workflowSchemaReady = true;
};

export const deriveAction = (input: unknown): WorkflowAction | null => {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'approve' || value === 'approved') return 'Approve';
    if (value === 'contract' || value === 'contracted') return 'Contract';
    if (value === 'documents' || value === 'documented' || value === 'document') return 'Documents';
    if (value === 'reject' || value === 'rejected') return 'Reject';
    return null;
};

export const recordWorkflowTransition = async (params: {
    entityType: WorkflowAuditEntity;
    entityId: string;
    oldState?: string | null;
    newState: string;
    changedBy?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<void> => {
    await ensureWorkflowSchema();

    const {
        entityType,
        entityId,
        oldState = null,
        newState,
        changedBy = null,
        note = null,
        metadata = {},
    } = params;

    const insertSql = `
        INSERT INTO workflow_transition_audit (
            entity_type,
            entity_id,
            old_state,
            new_state,
            changed_by,
            note,
            metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `;
    const serializedMetadata = JSON.stringify(metadata);

    try {
        await pool.query(insertSql, [entityType, entityId, oldState, newState, changedBy, note, serializedMetadata]);
    } catch (error: any) {
        const message = String(error?.message || '').toLowerCase();
        const isChangedByFkViolation =
            error?.code === '23503' &&
            (message.includes('workflow_transition_audit_changed_by_fkey') || message.includes('changed_by'));

        if (changedBy && isChangedByFkViolation) {
            await pool.query(insertSql, [entityType, entityId, oldState, newState, null, note, serializedMetadata]);
            return;
        }

        throw error;
    }
};
