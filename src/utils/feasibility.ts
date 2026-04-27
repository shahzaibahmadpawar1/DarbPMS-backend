import pool from '../config/database';

let feasibilitySchemaReady = false;

export type FeasibilityReviewDepartment = 'project' | 'operation' | 'realestate' | 'investment' | 'finance';

export const FEASIBILITY_REVIEW_DEPARTMENTS: FeasibilityReviewDepartment[] = [
    'project',
    'operation',
    'realestate',
    'investment',
    'finance',
];

export const ensureFeasibilitySchema = async (): Promise<void> => {
    if (feasibilitySchemaReady) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS feasibility_manager_reviews (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            investment_project_id UUID NOT NULL REFERENCES investment_projects(id) ON DELETE CASCADE,
            department VARCHAR(20) NOT NULL CHECK (department IN ('project', 'operation', 'realestate', 'investment', 'finance')),
            suggestions TEXT,
            budget NUMERIC,
            time_duration TEXT,
            percentage INTEGER CHECK (percentage >= 0 AND percentage <= 100),
            requirements TEXT,
            submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
            submitted_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (investment_project_id, department)
        );
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_feasibility_reviews_project ON feasibility_manager_reviews(investment_project_id);
    `);

    feasibilitySchemaReady = true;
};

