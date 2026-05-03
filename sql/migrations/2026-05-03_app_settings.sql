-- Key/value settings (e.g. sidebar navigation order for All Stations layout)
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(191) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
