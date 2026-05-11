-- Post-CEO contract path: station assignment + publish (runtime also applies via ensureInvestmentOpportunitiesSchema).
-- Run manually if you manage schema outside the app boot path.

ALTER TABLE investment_opportunities
    ADD COLUMN IF NOT EXISTS workflow_department_type VARCHAR(20);

ALTER TABLE investment_opportunities
    ADD COLUMN IF NOT EXISTS published_station_code VARCHAR(100);

ALTER TABLE investment_opportunities
    ADD COLUMN IF NOT EXISTS published_station_name VARCHAR(255);

ALTER TABLE investment_opportunities
    ADD COLUMN IF NOT EXISTS investment_project_id UUID;

ALTER TABLE investment_opportunities
    ADD COLUMN IF NOT EXISTS station_published_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE investment_opportunities
    ADD COLUMN IF NOT EXISTS station_published_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Drop/recreate CHECK constraints to match application (see backend/src/utils/investmentOpportunities.ts).
