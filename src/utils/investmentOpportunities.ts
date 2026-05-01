import pool from '../config/database';

let investmentOpportunitiesSchemaReady = false;

export type OpportunityType = 'rent' | 'operation' | 'investment' | 'ownership';
export type ClientType = 'individual' | 'establishment' | 'company';
export type StreetType = 'main' | 'secondary' | 'neighbourhood';
export type LocationStatus = 'ready' | 'underconstruction' | 'renovation' | 'land';
export type OpportunityStatus = 'draft' | 'forwarded_to_specialist';
export type StudyStatus = 'draft' | 'submitted_to_committee';
export type CommitteeDepartment = 'project' | 'operation' | 'realestate' | 'investment' | 'finance';
export type OpportunityWorkflowStatus =
    | 'new'
    | 'under_study'
    | 'awaiting_ceo_decision'
    | 'contract_in_progress'
    | 'awaiting_ceo_final_approval'
    | 'approved';

export const COMMITTEE_DEPARTMENTS: CommitteeDepartment[] = ['project', 'operation', 'realestate', 'investment', 'finance'];

export const ensureInvestmentOpportunitiesSchema = async (): Promise<void> => {
    if (investmentOpportunitiesSchemaReady) return;

    const runSafeAlter = async (sql: string): Promise<void> => {
        try {
            await pool.query(sql);
        } catch (error: any) {
            // In some hosted environments the DB role may not have ALTER privilege.
            // Do not block request paths; keep backward-compatible behavior.
            console.warn('[investment schema] non-fatal alter skipped:', error?.message || error);
        }
    };

    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // Location settings (regions/cities) used by Opportunities form
    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_location_regions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(120) NOT NULL UNIQUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_location_cities (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            region_id UUID NOT NULL REFERENCES investment_location_regions(id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (region_id, name)
        );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_location_cities_region ON investment_location_cities(region_id);`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_clients (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(255) NOT NULL,
            id_cr_number VARCHAR(100) NOT NULL,
            client_type VARCHAR(20) NOT NULL CHECK (client_type IN ('individual','establishment','company')),
            phone VARCHAR(50),
            contact_person_name VARCHAR(255),
            contact_person_mobile VARCHAR(50),
            email VARCHAR(255),
            address TEXT,
            note TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            updated_by UUID REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_investment_clients_name ON investment_clients(name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_investment_clients_idcr ON investment_clients(id_cr_number);`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_opportunities (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            opportunity_date DATE NOT NULL,
            opportunity_type VARCHAR(20) NOT NULL CHECK (opportunity_type IN ('rent','operation','investment','ownership')),
            client_id UUID NOT NULL REFERENCES investment_clients(id) ON DELETE RESTRICT,
            region VARCHAR(100),
            city VARCHAR(100),
            district VARCHAR(100),
            street VARCHAR(255),
            street_type VARCHAR(20) CHECK (street_type IN ('main','secondary','neighbourhood')),
            station_name_if_exists VARCHAR(255),
            location_status VARCHAR(20) CHECK (location_status IN ('ready','underconstruction','renovation','land')),
            area_m2 DECIMAL(12,2),
            frontage_m DECIMAL(12,2),
            depth_m DECIMAL(12,2),
            location_url TEXT,
            issued_licenses TEXT,
            pending_licenses TEXT,
            investment_specialist_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            notes TEXT,
            status VARCHAR(30) NOT NULL DEFAULT 'forwarded_to_specialist'
                CHECK (status IN ('draft','forwarded_to_specialist')),
            workflow_status VARCHAR(40) NOT NULL DEFAULT 'new'
                CHECK (workflow_status IN (
                    'new',
                    'under_study',
                    'awaiting_ceo_decision',
                    'contract_in_progress',
                    'awaiting_ceo_final_approval',
                    'approved'
                )),
            contract_department VARCHAR(20)
                CHECK (contract_department IN ('project','operation','realestate','investment','finance')),
            contract_manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            contract_submitted_at TIMESTAMP WITH TIME ZONE,
            contract_form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
            ceo_decision_at TIMESTAMP WITH TIME ZONE,
            ceo_approved_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            updated_by UUID REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opps_date ON investment_opportunities(opportunity_date);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opps_type ON investment_opportunities(opportunity_type);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opps_client ON investment_opportunities(client_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opps_specialist ON investment_opportunities(investment_specialist_user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opps_workflow_status ON investment_opportunities(workflow_status);`);

    // Migration-safe alters for existing deployments
    await runSafeAlter(`
        ALTER TABLE investment_opportunities
            ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(40) NOT NULL DEFAULT 'new'
                CHECK (workflow_status IN (
                    'new',
                    'under_study',
                    'awaiting_ceo_decision',
                    'contract_in_progress',
                    'awaiting_ceo_final_approval',
                    'approved'
                ));
    `);
    await runSafeAlter(`
        ALTER TABLE investment_opportunities
            ADD COLUMN IF NOT EXISTS contract_department VARCHAR(20)
                CHECK (contract_department IN ('project','operation','realestate','investment','finance'));
    `);
    await runSafeAlter(`ALTER TABLE investment_opportunities ADD COLUMN IF NOT EXISTS contract_manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await runSafeAlter(`ALTER TABLE investment_opportunities ADD COLUMN IF NOT EXISTS contract_submitted_at TIMESTAMP WITH TIME ZONE;`);
    await runSafeAlter(`ALTER TABLE investment_opportunities ADD COLUMN IF NOT EXISTS contract_form_data JSONB NOT NULL DEFAULT '{}'::jsonb;`);
    await runSafeAlter(`ALTER TABLE investment_opportunities ADD COLUMN IF NOT EXISTS ceo_decision_at TIMESTAMP WITH TIME ZONE;`);
    await runSafeAlter(`ALTER TABLE investment_opportunities ADD COLUMN IF NOT EXISTS ceo_approved_at TIMESTAMP WITH TIME ZONE;`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_opportunity_attachments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE CASCADE,
            kind VARCHAR(30) NOT NULL CHECK (kind IN (
                'id_photo','commercial_register','tax_number','national_address','deed',
                'licenses','certificates','contracts','other'
            )),
            file_name VARCHAR(255),
            file_url TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opp_attach_opp ON investment_opportunity_attachments(opportunity_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opp_attach_kind ON investment_opportunity_attachments(kind);`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_feasibility_studies (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE CASCADE,
            study_status VARCHAR(50) NOT NULL DEFAULT 'Initial',
            expected_property_income JSONB NOT NULL DEFAULT '{}'::jsonb,
            product_sales JSONB NOT NULL DEFAULT '{}'::jsonb,
            expenses JSONB NOT NULL DEFAULT '{}'::jsonb,
            final_result JSONB NOT NULL DEFAULT '{}'::jsonb,
            initial_agreement_notes TEXT,
            status VARCHAR(30) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted_to_committee')),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            updated_by UUID REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_studies_opp ON investment_feasibility_studies(opportunity_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_studies_status ON investment_feasibility_studies(status);`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_feasibility_attachments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            study_id UUID NOT NULL REFERENCES investment_feasibility_studies(id) ON DELETE CASCADE,
            file_name VARCHAR(255),
            file_url TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_study_attach_study ON investment_feasibility_attachments(study_id);`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS investment_committee_opinions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            study_id UUID NOT NULL REFERENCES investment_feasibility_studies(id) ON DELETE CASCADE,
            department VARCHAR(20) NOT NULL CHECK (department IN ('project','operation','realestate','investment','finance')),
            opinion_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
            submitted_at TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (study_id, department)
        );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opinions_study ON investment_committee_opinions(study_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_opinions_dept ON investment_committee_opinions(department);`);

    investmentOpportunitiesSchemaReady = true;
};

