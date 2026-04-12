import pool from '../config/database';

let activitySchemaReady = false;

export type ActivityScope = 'mine' | 'all';

export interface ActivityLogInput {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    details?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    sourcePath?: string | null;
    requestMethod?: string | null;
}

export const ensureActivitySchema = async (): Promise<void> => {
    if (activitySchemaReady) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS activity_events (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(60) NOT NULL,
            entity_type VARCHAR(80) NOT NULL,
            entity_id TEXT,
            summary TEXT NOT NULL,
            details JSONB,
            metadata JSONB,
            source_path TEXT,
            request_method VARCHAR(10),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_activity_events_actor_created_at
        ON activity_events(actor_id, created_at DESC);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_activity_events_created_at
        ON activity_events(created_at DESC);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_activity_events_entity
        ON activity_events(entity_type, entity_id);
    `);

    activitySchemaReady = true;
};

export const recordActivity = async (params: ActivityLogInput): Promise<void> => {
    await ensureActivitySchema();

    await pool.query(
        `
            INSERT INTO activity_events (
                actor_id,
                action,
                entity_type,
                entity_id,
                summary,
                details,
                metadata,
                source_path,
                request_method
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
        `,
        [
            params.actorId || null,
            params.action,
            params.entityType,
            params.entityId || null,
            params.summary,
            JSON.stringify(params.details || {}),
            JSON.stringify(params.metadata || {}),
            params.sourcePath || null,
            params.requestMethod || null,
        ],
    );
};

export const normalizeActivityScope = (value: unknown): ActivityScope => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'all' ? 'all' : 'mine';
};