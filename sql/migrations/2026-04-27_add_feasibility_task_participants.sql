-- Feasibility task participants (single shared task visible to selected managers)

CREATE TABLE IF NOT EXISTS feasibility_task_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES project_workflow_tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(20) NOT NULL CHECK (department IN ('project', 'operation', 'realestate', 'investment', 'finance')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (task_id, department),
    UNIQUE (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feasibility_task_participants_task ON feasibility_task_participants(task_id);
CREATE INDEX IF NOT EXISTS idx_feasibility_task_participants_user ON feasibility_task_participants(user_id);

