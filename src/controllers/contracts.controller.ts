import { Request, Response } from 'express';
import pool from '../config/database';
import { recordActivity } from '../utils/activity';
import { isSchemaCompatibilityError } from '../utils/dbErrors';
import { ensureWorkflowSchema, recordWorkflowTransition } from '../utils/workflow';

let contractLifecycleReady = false;

const normalizeProjectStationType = (value: unknown): 'investment' | 'franchise' | 'operation' | 'rent' | 'ownership' => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'frenchise') return 'franchise';
    if (normalized === 'franchise') return 'franchise';
    if (normalized === 'operation') return 'operation';
    if (normalized === 'rent') return 'rent';
    if (normalized === 'ownership') return 'ownership';
    return 'investment';
};

const ensureContractLifecycleSchema = async (): Promise<void> => {
    if (contractLifecycleReady) return;

    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_attachment_url TEXT;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_attachment_name VARCHAR(255);`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_attachment_uploaded_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_attachment_uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'Draft';`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS review_comment TEXT;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS workflow_task_id UUID;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contracts_workflow_task_id ON contracts(workflow_task_id);`);

    await pool.query(`
        UPDATE contracts
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    await pool.query(`
        UPDATE contracts
        SET review_status = COALESCE(review_status, CASE WHEN is_submitted THEN 'Pending Review' ELSE 'Draft' END)
        WHERE review_status IS NULL OR review_status = '';
    `);

    contractLifecycleReady = true;
};

const stationExists = async (stationCode: string): Promise<boolean> => {
    const result = await pool.query(
        'SELECT 1 FROM station_information WHERE station_code = $1 LIMIT 1',
        [stationCode],
    );
    return result.rows.length > 0;
};

const upsertStationFromProjectForContract = async (projectId: string, userId: string): Promise<string> => {
    const projectResult = await pool.query(
        `SELECT project_code, project_name, city, district, google_location, department_type, project_status
         FROM investment_projects
         WHERE id = $1
         LIMIT 1`,
        [projectId],
    );

    if (!projectResult.rows.length) {
        throw new Error('Investment project not found for this contract task');
    }

    const project = projectResult.rows[0];
    const stationCode = String(project.project_code || '').trim();
    const stationName = String(project.project_name || '').trim();
    if (!stationCode || !stationName) {
        throw new Error('Station creation failed: project code and project name are required');
    }

    await pool.query(
        `INSERT INTO station_information (
            station_code,
            station_name,
            city,
            district,
            geographic_location,
            station_type_code,
            station_status_code,
            created_by,
            updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        ON CONFLICT (station_code) DO UPDATE
        SET station_name = EXCLUDED.station_name,
            city = EXCLUDED.city,
            district = EXCLUDED.district,
            geographic_location = EXCLUDED.geographic_location,
            station_type_code = EXCLUDED.station_type_code,
            station_status_code = EXCLUDED.station_status_code,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP`,
        [
            stationCode,
            stationName,
            project.city || null,
            project.district || null,
            project.google_location || null,
            normalizeProjectStationType(project.department_type),
            project.project_status || 'Active',
            userId,
        ],
    );

    return stationCode;
};

const truncateValue = (value: string, maxLength: number): string => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
};

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) return normalized;
    }
    return '';
};

type ContractBootstrapDefaults = {
    contractType?: string | null;
    contractSignatureDate?: string | null;
    contractSignatureLocation?: string | null;
    tenancyStartDate?: string | null;
    tenancyEndDate?: string | null;
    lessorName?: string | null;
    nationality?: string | null;
    idType?: string | null;
    idNo?: string | null;
    mobileNo?: string | null;
    email?: string | null;
    tenantName?: string | null;
    tenantNationality?: string | null;
    tenantIdType?: string | null;
    tenantIdNo?: string | null;
    tenantMobileNo?: string | null;
    tenantEmail?: string | null;
    duePeriod?: string | null;
};

const normalizeBootstrapText = (value: unknown): string | null => {
    const normalized = String(value || '').trim();
    return normalized || null;
};

const toIsoDate = (value: unknown): string | null => {
    if (!value) return null;
    return String(value).slice(0, 10) || null;
};

const hydrateContractDraftRow = async (contractId: string, defaults: ContractBootstrapDefaults): Promise<any> => {
    const contractType = normalizeBootstrapText(defaults.contractType);
    const contractSignatureDate = toIsoDate(defaults.contractSignatureDate);
    const contractSignatureLocation = normalizeBootstrapText(defaults.contractSignatureLocation);
    const tenancyStartDate = toIsoDate(defaults.tenancyStartDate);
    const tenancyEndDate = toIsoDate(defaults.tenancyEndDate);
    const lessorName = normalizeBootstrapText(defaults.lessorName);
    const nationality = normalizeBootstrapText(defaults.nationality);
    const idType = normalizeBootstrapText(defaults.idType);
    const idNo = normalizeBootstrapText(defaults.idNo);
    const mobileNo = normalizeBootstrapText(defaults.mobileNo);
    const email = normalizeBootstrapText(defaults.email);
    const tenantName = normalizeBootstrapText(defaults.tenantName);
    const tenantNationality = normalizeBootstrapText(defaults.tenantNationality);
    const tenantIdType = normalizeBootstrapText(defaults.tenantIdType);
    const tenantIdNo = normalizeBootstrapText(defaults.tenantIdNo);
    const tenantMobileNo = normalizeBootstrapText(defaults.tenantMobileNo);
    const tenantEmail = normalizeBootstrapText(defaults.tenantEmail);
    const duePeriod = normalizeBootstrapText(defaults.duePeriod);

    const hydrated = await pool.query(
        `UPDATE contracts
         SET contract_type = CASE WHEN NULLIF(contract_type, '') IS NULL AND $1::text IS NOT NULL THEN $1::text ELSE contract_type END,
             contract_signature_date = CASE WHEN contract_signature_date IS NULL AND $2::date IS NOT NULL THEN $2::date ELSE contract_signature_date END,
             contract_signature_location = CASE WHEN NULLIF(contract_signature_location, '') IS NULL AND $3::text IS NOT NULL THEN $3::text ELSE contract_signature_location END,
             tenancy_start_date = CASE WHEN tenancy_start_date IS NULL AND $4::date IS NOT NULL THEN $4::date ELSE tenancy_start_date END,
             tenancy_end_date = CASE WHEN tenancy_end_date IS NULL AND $5::date IS NOT NULL THEN $5::date ELSE tenancy_end_date END,
             lessor_name = CASE WHEN NULLIF(lessor_name, '') IS NULL AND $6::text IS NOT NULL THEN $6::text ELSE lessor_name END,
             nationality = CASE WHEN NULLIF(nationality, '') IS NULL AND $7::text IS NOT NULL THEN $7::text ELSE nationality END,
             id_type = CASE WHEN NULLIF(id_type, '') IS NULL AND $8::text IS NOT NULL THEN $8::text ELSE id_type END,
             id_no = CASE WHEN NULLIF(id_no, '') IS NULL AND $9::text IS NOT NULL THEN $9::text ELSE id_no END,
             mobile_no = CASE WHEN NULLIF(mobile_no, '') IS NULL AND $10::text IS NOT NULL THEN $10::text ELSE mobile_no END,
             email = CASE WHEN NULLIF(email, '') IS NULL AND $11::text IS NOT NULL THEN $11::text ELSE email END,
             tenant_name = CASE WHEN NULLIF(tenant_name, '') IS NULL AND $12::text IS NOT NULL THEN $12::text ELSE tenant_name END,
             tenant_nationality = CASE WHEN NULLIF(tenant_nationality, '') IS NULL AND $13::text IS NOT NULL THEN $13::text ELSE tenant_nationality END,
             tenant_id_type = CASE WHEN NULLIF(tenant_id_type, '') IS NULL AND $14::text IS NOT NULL THEN $14::text ELSE tenant_id_type END,
             tenant_id_no = CASE WHEN NULLIF(tenant_id_no, '') IS NULL AND $15::text IS NOT NULL THEN $15::text ELSE tenant_id_no END,
             tenant_mobile_no = CASE WHEN NULLIF(tenant_mobile_no, '') IS NULL AND $16::text IS NOT NULL THEN $16::text ELSE tenant_mobile_no END,
             tenant_email = CASE WHEN NULLIF(tenant_email, '') IS NULL AND $17::text IS NOT NULL THEN $17::text ELSE tenant_email END,
             due_period = CASE WHEN NULLIF(due_period, '') IS NULL AND $18::text IS NOT NULL THEN $18::text ELSE due_period END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $19
         RETURNING *`,
        [
            contractType,
            contractSignatureDate,
            contractSignatureLocation,
            tenancyStartDate,
            tenancyEndDate,
            lessorName,
            nationality,
            idType,
            idNo,
            mobileNo,
            email,
            tenantName,
            tenantNationality,
            tenantIdType,
            tenantIdNo,
            tenantMobileNo,
            tenantEmail,
            duePeriod,
            contractId,
        ],
    );

    return hydrated.rows[0];
};

const buildContractBootstrapDefaults = async (task: any, stationCode: string): Promise<ContractBootstrapDefaults> => {
    const metadata = task?.metadata && typeof task.metadata === 'object' ? task.metadata as Record<string, any> : {};
    const storedDefaults = metadata.contractDefaults && typeof metadata.contractDefaults === 'object'
        ? metadata.contractDefaults as Record<string, any>
        : {};

    const [projectResult, stationResult, ownerResult, deedResult] = await Promise.all([
        task.investment_project_id
            ? pool.query(
                `SELECT project_code, project_name, city, district, google_location, contract_type,
                        owner_name, owner_contact_no, id_no, national_address, email, owner_type, order_date
                 FROM investment_projects
                 WHERE id = $1
                 LIMIT 1`,
                [task.investment_project_id],
            )
            : Promise.resolve({ rows: [] } as any),
        pool.query(
            `SELECT station_name, city, district, geographic_location, station_type_code
             FROM station_information
             WHERE station_code = $1
             LIMIT 1`,
            [stationCode],
        ),
        pool.query(
            `SELECT owner_id, owner_name, issue_date, issue_place, owner_mobile, owner_email
             FROM owners
             WHERE station_code = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [stationCode],
        ),
        pool.query(
            `SELECT deed_date, deed_issue_by, nationality, id_type, id_date, city, district, address
             FROM deeds
             WHERE station_code = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [stationCode],
        ),
    ]);

    const project = projectResult.rows[0] || {};
    const station = stationResult.rows[0] || {};
    const owner = ownerResult.rows[0] || {};
    const deed = deedResult.rows[0] || {};

    return {
        contractType: normalizeBootstrapText(storedDefaults.contractType) || normalizeBootstrapText(project.contract_type) || normalizeBootstrapText(station.station_type_code),
        contractSignatureDate: normalizeBootstrapText(storedDefaults.contractSignatureDate) || toIsoDate(project.order_date) || toIsoDate(owner.issue_date) || toIsoDate(deed.deed_date),
        contractSignatureLocation: normalizeBootstrapText(storedDefaults.contractSignatureLocation)
            || normalizeBootstrapText(project.google_location)
            || normalizeBootstrapText(owner.issue_place)
            || normalizeBootstrapText(station.station_name)
            || normalizeBootstrapText(station.city)
            || normalizeBootstrapText(project.project_name),
        tenancyStartDate: normalizeBootstrapText(storedDefaults.tenancyStartDate) || toIsoDate(project.order_date) || toIsoDate(deed.deed_date),
        tenancyEndDate: normalizeBootstrapText(storedDefaults.tenancyEndDate),
        lessorName: normalizeBootstrapText(storedDefaults.lessorName)
            || normalizeBootstrapText(owner.owner_name)
            || normalizeBootstrapText(project.owner_name)
            || normalizeBootstrapText(station.station_name),
        nationality: normalizeBootstrapText(storedDefaults.nationality)
            || normalizeBootstrapText(deed.nationality)
            || normalizeBootstrapText(project.owner_type),
        idType: normalizeBootstrapText(storedDefaults.idType)
            || normalizeBootstrapText(deed.id_type)
            || (normalizeBootstrapText(project.owner_type) === 'company' ? 'Commercial Registration' : 'National ID'),
        idNo: normalizeBootstrapText(storedDefaults.idNo)
            || normalizeBootstrapText(owner.owner_id)
            || normalizeBootstrapText(project.id_no),
        mobileNo: normalizeBootstrapText(storedDefaults.mobileNo)
            || normalizeBootstrapText(owner.owner_mobile)
            || normalizeBootstrapText(project.owner_contact_no),
        email: normalizeBootstrapText(storedDefaults.email)
            || normalizeBootstrapText(owner.owner_email)
            || normalizeBootstrapText(project.email),
        tenantName: normalizeBootstrapText(storedDefaults.tenantName)
            || normalizeBootstrapText(project.project_name)
            || normalizeBootstrapText(station.station_name),
        tenantNationality: normalizeBootstrapText(storedDefaults.tenantNationality)
            || normalizeBootstrapText(project.owner_type)
            || normalizeBootstrapText(deed.nationality),
        tenantIdType: normalizeBootstrapText(storedDefaults.tenantIdType)
            || normalizeBootstrapText(project.owner_type),
        tenantIdNo: normalizeBootstrapText(storedDefaults.tenantIdNo)
            || normalizeBootstrapText(project.project_code)
            || normalizeBootstrapText(stationCode),
        tenantMobileNo: normalizeBootstrapText(storedDefaults.tenantMobileNo)
            || normalizeBootstrapText(project.owner_contact_no)
            || normalizeBootstrapText(owner.owner_mobile),
        tenantEmail: normalizeBootstrapText(storedDefaults.tenantEmail)
            || normalizeBootstrapText(project.email)
            || normalizeBootstrapText(owner.owner_email),
        duePeriod: normalizeBootstrapText(storedDefaults.duePeriod),
    };
};

const syncOwnershipAndLegalFromContract = async (contract: any, userId: string): Promise<void> => {
    const stationCode = String(contract.station_code || '').trim();
    if (!stationCode) {
        throw new Error('Station code is required to copy contract data into ownership and legal records');
    }

    const stationResult = await pool.query(
        `SELECT station_name, city, district, station_type_code
         FROM station_information
         WHERE station_code = $1
         LIMIT 1`,
        [stationCode],
    );
    const station = stationResult.rows[0] || {};

    const contractSignatureDate = contract.contract_signature_date || null;
    const contractSignatureLocation = String(contract.contract_signature_location || '').trim() || station.station_name || null;
    const ownerId = truncateValue(
        firstNonEmpty(contract.id_no, contract.tenant_id_no, contract.contract_no, `CON-${String(contract.id || '').slice(0, 8)}`),
        50,
    );
    const ownerName = firstNonEmpty(contract.lessor_name, contract.tenant_name, station.station_name, ownerId);

    const existingOwnerResult = await pool.query(
        `SELECT id
         FROM owners
         WHERE station_code = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [stationCode],
    );

    if (existingOwnerResult.rows.length) {
        await pool.query(
            `UPDATE owners
             SET owner_id = COALESCE($1, owner_id),
                 owner_name = COALESCE($2, owner_name),
                 issue_date = COALESCE($3, issue_date),
                 issue_place = COALESCE($4, issue_place),
                 owner_mobile = COALESCE($5, owner_mobile),
                 owner_address = COALESCE($6, owner_address),
                 owner_email = COALESCE($7, owner_email),
                 station_type_code = COALESCE($8, station_type_code),
                 station_code = COALESCE($9, station_code),
                 updated_by = $10,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $11`,
            [
                ownerId,
                ownerName,
                contractSignatureDate,
                contractSignatureLocation,
                contract.mobile_no || null,
                null,
                contract.email || null,
                station.station_type_code || null,
                stationCode,
                userId,
                existingOwnerResult.rows[0].id,
            ],
        );
    } else {
        await pool.query(
            `INSERT INTO owners (
                owner_id,
                owner_name,
                issue_date,
                issue_place,
                owner_mobile,
                owner_address,
                owner_email,
                station_type_code,
                station_code,
                created_by,
                updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
            [
                ownerId,
                ownerName,
                contractSignatureDate,
                contractSignatureLocation,
                contract.mobile_no || null,
                null,
                contract.email || null,
                station.station_type_code || null,
                stationCode,
                userId,
            ],
        );
    }

    const deedNo = truncateValue(firstNonEmpty(contract.contract_no, `DEED-${String(contract.id || '').slice(0, 8)}`), 100);
    const existingDeedResult = await pool.query(
        `SELECT id
         FROM deeds
         WHERE station_code = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [stationCode],
    );

    const deedValues = [
        deedNo,
        contractSignatureDate,
        contractSignatureLocation,
        stationCode,
        null,
        firstNonEmpty(contract.nationality, contract.tenant_nationality) || null,
        null,
        contractSignatureLocation,
        contract.id_type || null,
        contractSignatureDate,
        stationCode,
        null,
        station.district || contract.district || null,
        station.city || contract.city || null,
        firstNonEmpty(contract.contract_type, station.station_type_code) || null,
        contract.review_status || 'Approved',
        stationCode,
        userId,
    ];

    if (existingDeedResult.rows.length) {
        await pool.query(
            `UPDATE deeds
             SET deed_no = COALESCE($1, deed_no),
                 deed_date = COALESCE($2, deed_date),
                 deed_issue_by = COALESCE($3, deed_issue_by),
                 real_estate_unit_number = COALESCE($4, real_estate_unit_number),
                 area = COALESCE($5, area),
                 nationality = COALESCE($6, nationality),
                 percentage = COALESCE($7, percentage),
                 address = COALESCE($8, address),
                 id_type = COALESCE($9, id_type),
                 id_date = COALESCE($10, id_date),
                 land_no = COALESCE($11, land_no),
                 block_number = COALESCE($12, block_number),
                 district = COALESCE($13, district),
                 city = COALESCE($14, city),
                 unit_type = COALESCE($15, unit_type),
                 status_code = COALESCE($16, status_code),
                 station_code = COALESCE($17, station_code),
                 updated_by = $18,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $19`,
            [...deedValues, existingDeedResult.rows[0].id],
        );
    } else {
        await pool.query(
            `INSERT INTO deeds (
                deed_no,
                deed_date,
                deed_issue_by,
                real_estate_unit_number,
                area,
                nationality,
                percentage,
                address,
                id_type,
                id_date,
                land_no,
                block_number,
                district,
                city,
                unit_type,
                status_code,
                station_code,
                created_by,
                updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)`,
            deedValues,
        );
    }
};

export const createOrGetContractDraftFromTask = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureWorkflowSchema();
        await ensureContractLifecycleSchema();

        const { taskId } = req.params as { taskId?: string };
        const userId = (req as any).user?.id as string | undefined;
        const userRole = (req as any).user?.role as string | undefined;
        const previewRequested = String(req.query?.preview || '').trim() === '1' || String(req.query?.preview || '').trim().toLowerCase() === 'true';

        if (!taskId) {
            res.status(400).json({ error: 'taskId is required' });
            return;
        }

        if (!userId || !userRole) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const taskResult = await pool.query(
            `SELECT id, assigned_to, status, flow_type, metadata, investment_project_id
             FROM project_workflow_tasks
             WHERE id = $1
             LIMIT 1`,
            [taskId],
        );

        if (!taskResult.rows.length) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }

        const task = taskResult.rows[0];

        const isAssignee = task.assigned_to && String(task.assigned_to) === String(userId);
        const canPreview = previewRequested && (userRole === 'super_admin' || userRole === 'ceo' || isAssignee);
        const canStart = !previewRequested && (userRole === 'super_admin' || isAssignee);
        if (!canPreview && !canStart) {
            res.status(403).json({ error: previewRequested ? 'Only assigned user, CEO, or super admin can preview this contract task' : 'Only assigned user (or super admin) can start this contract task' });
            return;
        }

        if (String(task.flow_type || '').trim() !== 'contract') {
            res.status(409).json({ error: 'This task is not a contract task' });
            return;
        }

        const metadata = (task.metadata || {}) as Record<string, any>;
        let stationCode = String(metadata.stationCode || metadata.station_code || metadata.stationcode || '').trim();

        let projectCode = '';
        if (task.investment_project_id) {
            const projectResult = await pool.query(
                'SELECT project_code FROM investment_projects WHERE id = $1 LIMIT 1',
                [task.investment_project_id],
            );
            projectCode = String(projectResult.rows[0]?.project_code || '').trim();
            if (!stationCode && projectCode) {
                stationCode = projectCode;
                await pool.query(
                    `UPDATE project_workflow_tasks
                     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{stationCode}', to_jsonb($1::text), true),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $2`,
                    [stationCode, taskId],
                );
            }
        }

        if (!stationCode) {
            res.status(400).json({ error: 'Task metadata.stationCode is missing' });
            return;
        }

        let hasStation = await stationExists(stationCode);
        if (!hasStation && task.investment_project_id && projectCode && stationCode === projectCode) {
            await upsertStationFromProjectForContract(task.investment_project_id, userId);
            hasStation = await stationExists(stationCode);
        }

        if (!hasStation) {
            res.status(409).json({
                error: `Station code ${stationCode} does not exist in station_information.`,
                details: 'Ensure station exists before starting contract task.',
            });
            return;
        }

        const contractDefaults = await buildContractBootstrapDefaults(task, stationCode);

        const existingContractId = String(metadata.contractId || metadata.contract_id || '').trim();
        if (existingContractId) {
            const existingContract = await pool.query(
                'SELECT * FROM contracts WHERE id = $1 LIMIT 1',
                [existingContractId],
            );
            if (existingContract.rows.length) {
                const hydratedContract = await hydrateContractDraftRow(existingContract.rows[0].id, contractDefaults);
                res.status(200).json({ data: hydratedContract });
                return;
            }
        }

        if (previewRequested) {
            const previewTaskDraft = await pool.query(
                `SELECT *
                 FROM contracts
                 WHERE workflow_task_id = $1
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [taskId],
            );
            if (previewTaskDraft.rows.length) {
                    const hydratedContract = await hydrateContractDraftRow(previewTaskDraft.rows[0].id, contractDefaults);
                    res.status(200).json({ data: hydratedContract });
                return;
            }

            res.status(404).json({ error: 'No contract draft is available yet for preview' });
            return;
        }

        const existingTaskDraft = await pool.query(
            `SELECT *
             FROM contracts
             WHERE workflow_task_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [taskId],
        );
        if (existingTaskDraft.rows.length) {
            const hydratedContract = await hydrateContractDraftRow(existingTaskDraft.rows[0].id, contractDefaults);
            res.status(200).json({ data: hydratedContract });
            return;
        }

        // Create a new draft contract row bound to the task.
        const draftContractNo = `CON-TASK-${String(taskId).slice(0, 8)}-${Date.now()}`;
        const insert = await pool.query(
            `INSERT INTO contracts (
                contract_no,
                review_status,
                station_code,
                created_by,
                updated_by,
                workflow_task_id,
                is_submitted,
                last_saved_at,
                last_saved_by
            ) VALUES ($1, 'Draft', $2, $3, $3, $4, FALSE, CURRENT_TIMESTAMP, $3)
            RETURNING *`,
            [draftContractNo, stationCode, userId, taskId],
        );

        const contract = insert.rows[0];
        const hydratedContract = await hydrateContractDraftRow(contract.id, contractDefaults);

        await pool.query(
            `UPDATE project_workflow_tasks
             SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{contractId}', to_jsonb($1::text), true),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [contract.id, taskId],
        );

        await recordWorkflowTransition({
            entityType: 'workflow_task',
            entityId: taskId,
            oldState: task.status,
            newState: String(task.status || 'assigned'),
            changedBy: userId,
            note: 'Contract draft created from task',
            metadata: {
                stationCode,
                contractId: contract.id,
            },
        });

        res.status(201).json({ data: hydratedContract });
    } catch (error: any) {
        console.error('Error creating contract draft from task:', error);
        if (error?.code === '23503') {
            res.status(409).json({
                error: 'Contract task could not start because station_code is missing in station_information.',
                details: error.message,
            });
            return;
        }
        res.status(500).json({ error: 'Failed to start contract task', details: error.message });
    }
};

export const createContract = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureContractLifecycleSchema();

        const {
            contractNo, contractType, contractSignatureDate, contractSignatureLocation,
            tenancyStartDate, tenancyEndDate, lessorName, nationality, idType,
            idNo, idCopy, mobileNo, email, tenantName, tenantNationality,
            tenantIdType, tenantIdNo, tenantIdCopy, tenantMobileNo, tenantEmail,
            duration, days, propertyValue, installments, dueDate, dueAmount,
            paidAmount, notPaidAmount, duePeriod, stationCode, submit,
            contractAttachmentUrl, contractAttachmentName
        } = req.body;

        const shouldSubmit = submit !== false;
        const resolvedContractNo = String(contractNo || '').trim() || `CON-DRAFT-${Date.now()}`;
        const resolvedAttachmentUrl = String(contractAttachmentUrl || '').trim();
        const resolvedAttachmentName = String(contractAttachmentName || '').trim();

        if (!stationCode || (shouldSubmit && !resolvedContractNo)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires Contract No.' });
            return;
        }

        if (shouldSubmit && !resolvedAttachmentUrl) {
            res.status(400).json({ error: 'Contract attachment is required before submitting.' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO contracts (
                contract_no, contract_type, contract_signature_date, contract_signature_location, 
                tenancy_start_date, tenancy_end_date, lessor_name, nationality, id_type, 
                id_no, id_copy, contract_attachment_url, contract_attachment_name, mobile_no, email, tenant_name, tenant_nationality, 
                tenant_id_type, tenant_id_no, tenant_id_copy, tenant_mobile_no, tenant_email, 
                duration, days, property_value, installments, due_date, due_amount, 
                paid_amount, not_paid_amount, due_period, review_status, station_code, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
            RETURNING *
        `;

        const values = [
            resolvedContractNo, contractType, contractSignatureDate || null, contractSignatureLocation,
            tenancyStartDate || null, tenancyEndDate || null, lessorName, nationality, idType,
            idNo, idCopy || null, resolvedAttachmentUrl || null, resolvedAttachmentName || null,
            mobileNo, email, tenantName, tenantNationality,
            tenantIdType, tenantIdNo, tenantIdCopy || null, tenantMobileNo, tenantEmail,
            duration, days || 0, propertyValue || 0, installments || 0, dueDate || null, dueAmount || 0,
            paidAmount || 0, notPaidAmount || 0, duePeriod, shouldSubmit ? 'Pending Review' : 'Draft', stationCode, userId, userId
        ];
        const result = await pool.query(query, values);

        await pool.query(`
            UPDATE contracts
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END,
                review_status = CASE WHEN $1 THEN 'Pending Review' ELSE 'Draft' END,
                contract_attachment_uploaded_by = CASE WHEN $3 IS NOT NULL AND $3 <> '' THEN $2 ELSE contract_attachment_uploaded_by END,
                contract_attachment_uploaded_at = CASE WHEN $3 IS NOT NULL AND $3 <> '' THEN CURRENT_TIMESTAMP ELSE contract_attachment_uploaded_at END
            WHERE id = $4
        `, [shouldSubmit, userId || null, resolvedAttachmentUrl, result.rows[0].id]);

        const refreshed = await pool.query('SELECT * FROM contracts WHERE id = $1 LIMIT 1', [result.rows[0].id]);

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'contract',
            entityId: result.rows[0].id,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} contract`,
            metadata: {
                contractType: refreshed.rows[0]?.contract_type,
            },
            sourcePath: '/api/contracts',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Contract submitted successfully' : 'Contract saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating contract:', error);
        if (error.code === '23503') {
            res.status(400).json({ error: 'Invalid station code. The station does not exist in station_information.' });
            return;
        }
        if (error.code === '23505') {
            res.status(409).json({ error: 'Contract No already exists' });
            return;
        }
        res.status(500).json({
            error: 'Failed to create contract',
            details: error.message
        });
    }
};

export const getAllContracts = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin' || userRole === 'ceo'
            ? 'SELECT * FROM contracts ORDER BY created_at DESC'
            : `
                SELECT c.* FROM contracts c
                INNER JOIN station_information si ON si.station_code = c.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY c.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' || userRole === 'ceo' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Contracts retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching contracts:', error);
        res.status(500).json({ error: 'Failed to fetch contracts', details: error.message });
    }
};

export const getContractsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM contracts WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Contracts retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ message: 'Contracts retrieved successfully', data: [], count: 0 });
            return;
        }
        console.error('Error fetching contracts:', error);
        res.status(500).json({ error: 'Failed to fetch contracts', details: error.message });
    }
};

export const updateContract = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureContractLifecycleSchema();

        const { id } = req.params;
        const reqBody = req.body;
        const userId = (req as any).user?.id;
        const submit = reqBody?.submit;
        const shouldSubmit = submit === true || submit === 'true';

        const protectedFields = new Set([
            'submit',
            'reviewStatus',
            'review_status',
            'isSubmitted',
            'is_submitted',
            'submittedAt',
            'submitted_at',
            'submittedBy',
            'submitted_by',
            'lastSavedAt',
            'last_saved_at',
            'lastSavedBy',
            'last_saved_by',
            'updatedAt',
            'updated_at',
            'updatedBy',
            'updated_by',
            'createdAt',
            'created_at',
            'createdBy',
            'created_by',
        ]);

        const fields = Object.entries(reqBody).filter(([k, v]) => !protectedFields.has(k) && v !== undefined);
        if (fields.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        const numericColumns = new Set([
            'property_value',
            'due_amount',
            'paid_amount',
            'not_paid_amount',
        ]);
        const integerColumns = new Set([
            'days',
            'installments',
        ]);
        const dateColumns = new Set([
            'contract_signature_date',
            'tenancy_start_date',
            'tenancy_end_date',
            'due_date',
        ]);

        const normalizedFields = fields.map(([key, rawValue]) => {
            const column = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            let value: unknown = rawValue;

            if (typeof value === 'string') {
                value = value.trim();
                if ((numericColumns.has(column) || integerColumns.has(column) || dateColumns.has(column)) && value === '') {
                    value = null;
                }
            }

            return [column, value] as const;
        });

        const hasAttachmentUpdate = Boolean(String(reqBody.contractAttachmentUrl || reqBody.contract_attachment_url || '').trim());

        const setClause = normalizedFields.map(([column], i) => `${column} = $${i + 1}`).join(', ');
        const query = `
            UPDATE contracts 
            SET ${setClause},
                is_submitted = $${fields.length + 1},
                submitted_at = CASE WHEN $${fields.length + 1} THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $${fields.length + 1} THEN $${fields.length + 2} ELSE submitted_by END,
                last_saved_at = CASE WHEN $${fields.length + 1} THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $${fields.length + 1} THEN last_saved_by ELSE $${fields.length + 2} END,
                review_status = CASE WHEN $${fields.length + 1} THEN 'Pending Review' ELSE COALESCE(review_status, 'Draft') END,
                contract_attachment_uploaded_by = CASE WHEN $${fields.length + 3} THEN $${fields.length + 2} ELSE contract_attachment_uploaded_by END,
                contract_attachment_uploaded_at = CASE WHEN $${fields.length + 3} THEN CURRENT_TIMESTAMP ELSE contract_attachment_uploaded_at END,
                updated_by = $${fields.length + 2},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${fields.length + 4}
            RETURNING *
        `;

        const values = [...normalizedFields.map(([_, value]) => value), shouldSubmit, userId, hasAttachmentUpdate, id];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Contract not found' });
            return;
        }

        const updatedContract = result.rows[0];

        if (shouldSubmit && updatedContract.workflow_task_id) {
            await ensureWorkflowSchema();

            const workflowTaskId = String(updatedContract.workflow_task_id);
            const taskLookup = await pool.query(
                `SELECT status
                 FROM project_workflow_tasks
                 WHERE id = $1
                 LIMIT 1`,
                [workflowTaskId],
            );

            const oldTaskState = String(taskLookup.rows[0]?.status || '').trim() || null;
            const contractAttachmentUrl = String(updatedContract.contract_attachment_url || '').trim();

            await pool.query(
                `UPDATE project_workflow_tasks
                 SET status = 'under_super_admin_review',
                     manager_attachment_url = CASE WHEN $1 <> '' THEN $1 ELSE manager_attachment_url END,
                     attachment_url = CASE WHEN $1 <> '' THEN $1 ELSE attachment_url END,
                     manager_note = COALESCE(manager_note, 'Contract submitted from form and sent for Super Admin review'),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [contractAttachmentUrl, workflowTaskId],
            );

            await recordWorkflowTransition({
                entityType: 'workflow_task',
                entityId: workflowTaskId,
                oldState: oldTaskState,
                newState: 'under_super_admin_review',
                changedBy: userId,
                note: 'Contract submitted from form and sent to Super Admin review',
                metadata: {
                    contractId: updatedContract.id,
                    stationCode: updatedContract.station_code,
                    hasAttachment: Boolean(contractAttachmentUrl),
                },
            });
        }

        res.status(200).json({ message: 'Contract updated successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error updating contract:', error);
        if (error.code === '23503') {
            res.status(400).json({ error: 'Invalid station code. The station does not exist in station_information.' });
            return;
        }
        if (error.code === '22P02') {
            res.status(400).json({ error: 'Invalid number/date input in contract form.', details: error.message });
            return;
        }
        res.status(500).json({
            error: 'Failed to update contract',
            details: error.message
        });
    }
};

export const reviewContract = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureContractLifecycleSchema();

        const { id } = req.params;
        const { decision, comment } = req.body as { decision?: string; comment?: string };
        const normalizedDecision = String(decision || '').trim().toLowerCase();
        if (!(normalizedDecision === 'approved' || normalizedDecision === 'rejected')) {
            res.status(400).json({ error: 'decision must be approved or rejected' });
            return;
        }

        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;
        if (!userId || (userRole !== 'super_admin' && userRole !== 'ceo')) {
            res.status(403).json({ error: 'Only super admin or CEO can review contracts' });
            return;
        }

        const existing = await pool.query('SELECT * FROM contracts WHERE id = $1 LIMIT 1', [id]);
        if (!existing.rows.length) {
            res.status(404).json({ error: 'Contract not found' });
            return;
        }

        const contract = existing.rows[0];
        if (!contract.contract_attachment_url) {
            res.status(400).json({ error: 'Contract attachment is required before review.' });
            return;
        }

        const reviewStatus = normalizedDecision === 'approved' ? 'Approved' : 'Rejected';
        const updated = await pool.query(`
            UPDATE contracts
            SET review_status = $1,
                review_comment = $2,
                reviewed_at = CURRENT_TIMESTAMP,
                reviewed_by = $3,
                updated_by = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `, [reviewStatus, comment || null, userId, id]);

        const workflowTaskId = updated.rows[0]?.workflow_task_id as string | null;
        if (workflowTaskId) {
            await ensureWorkflowSchema();
            const taskLookup = await pool.query(
                'SELECT status FROM project_workflow_tasks WHERE id = $1 LIMIT 1',
                [workflowTaskId],
            );
            const oldState = taskLookup.rows[0]?.status ?? null;
            const nextState = normalizedDecision === 'approved' ? 'approved' : 'rejected';

            await pool.query(
                `UPDATE project_workflow_tasks
                 SET status = $1,
                     super_admin_comment = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [nextState, comment || null, workflowTaskId],
            );

            await recordWorkflowTransition({
                entityType: 'workflow_task',
                entityId: workflowTaskId,
                oldState,
                newState: nextState,
                changedBy: userId,
                note: comment || `Contract ${nextState}`,
                metadata: {
                    contractId: id,
                    stationCode: contract.station_code,
                },
            });
        }

        if (normalizedDecision === 'approved') {
            await syncOwnershipAndLegalFromContract(updated.rows[0], userId);
        }

        void recordActivity({
            actorId: userId,
            action: normalizedDecision === 'approved' ? 'approve' : 'reject',
            entityType: 'contract',
            entityId: id,
            summary: `${normalizedDecision === 'approved' ? 'approved' : 'rejected'} contract`,
            metadata: {
                stationCode: contract.station_code,
                hasAttachment: Boolean(contract.contract_attachment_url),
                hasComment: Boolean(comment),
            },
            sourcePath: '/api/contracts/:id/review',
            requestMethod: 'PATCH',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(200).json({ message: `Contract ${reviewStatus.toLowerCase()} successfully`, data: updated.rows[0] });
    } catch (error: any) {
        console.error('Error reviewing contract:', error);
        res.status(500).json({ error: 'Failed to review contract', details: error.message });
    }
};

export const getLatestSavedContract = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureContractLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM contracts
                        WHERE created_by = $1
              AND ($2 = '' OR station_code = $2)
                        ORDER BY COALESCE(reviewed_at, last_saved_at, submitted_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error: any) {
        console.error('Error fetching latest saved contract:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved contract', details: error.message });
    }
};

export const deleteContract = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM contracts WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Contract not found' });
            return;
        }
        res.status(200).json({ message: 'Contract deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error deleting contract:', error);
        res.status(500).json({
            error: 'Failed to delete contract',
            details: error.message
        });
    }
};
