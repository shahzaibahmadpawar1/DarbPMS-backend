import { Request, Response } from 'express';
import pool from '../config/database';
import { createInitialReviewTaskForProject } from './workflowTasks.controller';
import { isSchemaCompatibilityError } from '../utils/dbErrors';
import { recordActivity } from '../utils/activity';

let investmentLifecycleSchemaReady = false;

const ensureInvestmentLifecycleSchema = async (): Promise<void> => {
    if (investmentLifecycleSchemaReady) {
        return;
    }

    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS workflow_path VARCHAR(50);
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;
    `);
    await pool.query(`
        ALTER TABLE investment_projects
        ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);

    await pool.query(`
        UPDATE investment_projects
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    investmentLifecycleSchemaReady = true;
};

const ALLOWED_CONTRACT_TYPES = new Set(['Operation Station', 'Lease Stations', 'Investment', 'Franchise Station']);

const normalizeContractType = (value: unknown): string | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    if (ALLOWED_CONTRACT_TYPES.has(raw)) {
        return raw;
    }

    const lowered = raw.toLowerCase();
    if (lowered === 'operation station') return 'Operation Station';
    if (lowered === 'lease stations' || lowered === 'lease station') return 'Lease Stations';
    if (lowered === 'investment') return 'Investment';
    if (lowered === 'franchise station' || lowered === 'frenchise station') return 'Franchise Station';

    // Known mismatches from UI/workflow statuses should not be written to contract_type.
    if (lowered === 'need_contract' || lowered === 'contracted') {
        return null;
    }

    return null;
};

const DEFAULT_COMMERCIAL_ELEMENT_NAMES = ['Super Market', 'Fuel Station', 'Kiosks', 'Retail Shop', 'Drive Through'];
const ELEMENT_UPDATE_KEYS = new Set([
    'commercialElements',
    'superMarket',
    'fuelStation',
    'kiosks',
    'retailShop',
    'driveThrough',
    'superMarketArea',
    'fuelStationArea',
    'kiosksArea',
    'retailShopArea',
    'driveThroughArea',
    'super_market',
    'fuel_station',
    'retail_shop',
    'drive_through',
    'super_market_area',
    'fuel_station_area',
    'kiosks_area',
    'retail_shop_area',
    'drive_through_area',
]);

const normalizeElementName = (value: unknown): string => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const getMissingDefaultElements = (commercialElements: unknown): string[] => {
    if (!Array.isArray(commercialElements)) {
        return [...DEFAULT_COMMERCIAL_ELEMENT_NAMES];
    }

    const provided = new Set(
        commercialElements.map((el: any) => normalizeElementName(el?.name)).filter(Boolean)
    );

    return DEFAULT_COMMERCIAL_ELEMENT_NAMES.filter((name) => !provided.has(normalizeElementName(name)));
};

// ─── CREATE ───────────────────────────────────────────────────────────────────
export const createInvestmentProject = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureInvestmentLifecycleSchema();
        const userRole = (req as any).user?.role;

        const {
            departmentType, requestType, projectName, projectCode, city, district, area,
            projectStatus, contractType, googleLocation, priorityLevel, orderDate, requestSender,
            // Elements (counts)
            superMarket, fuelStation, kiosks, retailShop, driveThrough,
            // Elements (individual areas)
            superMarketArea, fuelStationArea, kiosksArea, retailShopArea, driveThroughArea,
            // Owner
            ownerName, ownerContactNo, idNo, nationalAddress, email, ownerType,
            // Attachments (URLs after separate upload)
            designFileUrl, documentsUrl, autocadUrl,
            stationCode,
            submit,
        } = req.body;

        const shouldSubmit = submit !== false;
        const trimmedDepartmentType = String(departmentType || '').trim().toLowerCase();
        const fallbackDraftCode = `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const resolvedProjectName = String(projectName || '').trim() || (shouldSubmit ? '' : 'Draft Project');
        const resolvedProjectCode = String(projectCode || '').trim() || (shouldSubmit ? '' : fallbackDraftCode);

        if (!trimmedDepartmentType || (shouldSubmit && (!resolvedProjectName || !resolvedProjectCode))) {
            res.status(400).json({ error: 'Department type is required. Submit also requires project name and project code.' });
            return;
        }

        if (userRole !== 'super_admin') {
            const missingDefaults = getMissingDefaultElements(req.body?.commercialElements);
            if (missingDefaults.length > 0) {
                res.status(400).json({
                    error: `Default station elements are required for non-super-admin users: ${missingDefaults.join(', ')}`,
                });
                return;
            }
        }

        const normalizedContractType = normalizeContractType(contractType);

        const userId = (req as any).user?.id;
        const submittedAt = shouldSubmit ? new Date() : null;
        const submittedBy = shouldSubmit ? userId : null;
        const lastSavedAt = shouldSubmit ? null : new Date();
        const lastSavedBy = shouldSubmit ? null : userId;
        const result = await pool.query(`
            INSERT INTO investment_projects (
                department_type, request_type, project_name, project_code, city, district, area,
                project_status, contract_type, google_location, priority_level, order_date, request_sender,
                super_market, fuel_station, kiosks, retail_shop, drive_through,
                super_market_area, fuel_station_area, kiosks_area, retail_shop_area, drive_through_area,
                owner_name, owner_contact_no, id_no, national_address, email, owner_type,
                design_file_url, documents_url, autocad_url,
                station_code, is_submitted, submitted_at, submitted_by, last_saved_at, last_saved_by, created_by, updated_by
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                $14,$15,$16,$17,$18,
                $19,$20,$21,$22,$23,
                $24,$25,$26,$27,$28,$29,
                $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40
            ) RETURNING *`,
            [
                trimmedDepartmentType, requestType, resolvedProjectName, resolvedProjectCode, city, district, area || 0,
                projectStatus, normalizedContractType, googleLocation, priorityLevel, orderDate || null, requestSender,
                superMarket || 0, fuelStation || 0, kiosks || 0, retailShop || 0, driveThrough || 0,
                superMarketArea || 0, fuelStationArea || 0, kiosksArea || 0, retailShopArea || 0, driveThroughArea || 0,
                ownerName, ownerContactNo, idNo, nationalAddress, email, ownerType || 'individual',
                designFileUrl, documentsUrl, autocadUrl,
                stationCode,
                shouldSubmit,
                submittedAt,
                submittedBy,
                lastSavedAt,
                lastSavedBy,
                userId,
                userId,
            ]
        );

        if (userId && shouldSubmit) {
            await createInitialReviewTaskForProject(result.rows[0].id, userId);
        }

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'investment_project',
            entityId: result.rows[0].id,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} investment project: ${resolvedProjectCode}`,
            metadata: {
                projectName: resolvedProjectName,
                projectCode: resolvedProjectCode,
                departmentType: trimmedDepartmentType,
            },
            sourcePath: '/api/investment-projects',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Investment project submitted successfully' : 'Investment project saved successfully',
            data: result.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating investment project:', error);
        if (error.code === '23505') { res.status(409).json({ error: 'Project code already exists' }); return; }
        res.status(500).json({ error: 'Failed to create investment project', details: error.message });
    }
};

// ─── GET ALL ──────────────────────────────────────────────────────────────────
export const getAllInvestmentProjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const { departmentType, limit, offset } = req.query as {
            departmentType?: string;
            limit?: string;
            offset?: string;
        };
        const normalizedDepartment = String(userDepartment || '').trim().toLowerCase();
        const effectiveDepartmentType = userRole === 'super_admin' || userRole === 'ceo' || normalizedDepartment === 'project'
            ? departmentType
            : userDepartment;

        const parsedLimit = Number.parseInt(String(limit || ''), 10);
        const parsedOffset = Number.parseInt(String(offset || ''), 10);
        const usePagination = Number.isFinite(parsedLimit) && parsedLimit > 0;
        const safeLimit = usePagination ? Math.min(parsedLimit, 500) : null;
        const safeOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

        let query = effectiveDepartmentType
            ? 'SELECT * FROM investment_projects WHERE department_type = $1 ORDER BY created_at DESC'
            : 'SELECT * FROM investment_projects ORDER BY created_at DESC';
        const params: unknown[] = effectiveDepartmentType ? [effectiveDepartmentType] : [];

        if (usePagination && safeLimit !== null) {
            params.push(safeLimit, safeOffset);
            query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }

        const result = await pool.query(query, params);
        res.status(200).json({ message: 'Projects retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ message: 'Projects retrieved', data: [], count: 0 });
            return;
        }
        res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
    }
};

// ─── GET BY STATION ───────────────────────────────────────────────────────────
export const getInvestmentProjectsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const { stationCode } = req.params;
        const { departmentType, limit, offset } = req.query as {
            departmentType?: string;
            limit?: string;
            offset?: string;
        };
        const normalizedDepartment = String(userDepartment || '').trim().toLowerCase();
        const effectiveDepartmentType = userRole === 'super_admin' || userRole === 'ceo' || normalizedDepartment === 'project'
            ? departmentType
            : userDepartment;

        const parsedLimit = Number.parseInt(String(limit || ''), 10);
        const parsedOffset = Number.parseInt(String(offset || ''), 10);
        const usePagination = Number.isFinite(parsedLimit) && parsedLimit > 0;
        const safeLimit = usePagination ? Math.min(parsedLimit, 500) : null;
        const safeOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

        let query = effectiveDepartmentType
            ? 'SELECT * FROM investment_projects WHERE station_code = $1 AND department_type = $2 ORDER BY created_at DESC'
            : 'SELECT * FROM investment_projects WHERE station_code = $1 ORDER BY created_at DESC';
        const params: unknown[] = effectiveDepartmentType ? [stationCode, effectiveDepartmentType] : [stationCode];

        if (usePagination && safeLimit !== null) {
            params.push(safeLimit, safeOffset);
            query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }

        const result = await pool.query(query, params);
        res.status(200).json({ message: 'Projects retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ message: 'Projects retrieved', data: [], count: 0 });
            return;
        }
        res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
    }
};

// ─── GET BY ID ────────────────────────────────────────────────────────────────
export const getInvestmentProjectById = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM investment_projects WHERE id = $1', [req.params.id]);
        if (!result.rows.length) { res.status(404).json({ error: 'Project not found' }); return; }
        res.status(200).json({ message: 'Project retrieved', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch project', details: error.message });
    }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────
export const updateInvestmentProject = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureInvestmentLifecycleSchema();

        const { id } = req.params;
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;
        const fieldMap: Record<string, string> = {
            departmentType: 'department_type', requestType: 'request_type',
            projectName: 'project_name', projectCode: 'project_code',
            city: 'city', district: 'district', area: 'area',
            projectStatus: 'project_status', contractType: 'contract_type',
            googleLocation: 'google_location', priorityLevel: 'priority_level',
            orderDate: 'order_date', requestSender: 'request_sender',
            superMarket: 'super_market', fuelStation: 'fuel_station',
            kiosks: 'kiosks',
            retailShop: 'retail_shop', driveThrough: 'drive_through',
            superMarketArea: 'super_market_area',
            fuelStationArea: 'fuel_station_area',
            kiosksArea: 'kiosks_area',
            retailShopArea: 'retail_shop_area',
            driveThroughArea: 'drive_through_area',
            elementArea: 'element_area', ownerContactNo: 'owner_contact_no',
            ownerName: 'owner_name', idNo: 'id_no', nationalAddress: 'national_address',
            email: 'email',
            ownerType: 'owner_type', designFileUrl: 'design_file_url',
            documentsUrl: 'documents_url', autocadUrl: 'autocad_url',
            stationCode: 'station_code',
            reviewStatus: 'review_status',
            pmComment: 'pm_comment',
            ceoComment: 'ceo_comment'
        };
        const submitFlag = req.body?.submit;
        const shouldSubmit = submitFlag === true || submitFlag === 'true';
        const updatableKeys = new Set<string>([
            ...Object.keys(fieldMap),
            ...Object.values(fieldMap),
        ]);

        const fields = Object.entries(req.body)
            .filter(([k, v]) => k !== 'submit' && v !== undefined && updatableKeys.has(k));
        if (!fields.length) { res.status(400).json({ error: 'No fields to update' }); return; }

        const touchesElements = Object.keys(req.body || {}).some((key) => ELEMENT_UPDATE_KEYS.has(key));
        if (touchesElements && userRole !== 'super_admin') {
            const missingDefaults = getMissingDefaultElements(req.body?.commercialElements);
            if (missingDefaults.length > 0) {
                res.status(400).json({
                    error: `Default station elements are required for non-super-admin users: ${missingDefaults.join(', ')}`,
                });
                return;
            }
        }

        const normalizedFields = fields.map(([key, value]) => {
            if (key === 'contractType' || key === 'contract_type') {
                return [key, normalizeContractType(value)] as const;
            }
            return [key, value] as const;
        });

        const setClauses = normalizedFields.map(([k, _], i) => `${fieldMap[k] || k} = $${i + 1}`).join(', ');
        const submissionClauses = shouldSubmit
            ? ', is_submitted = TRUE, submitted_at = CURRENT_TIMESTAMP, submitted_by = $' + (normalizedFields.length + 2)
            : ', is_submitted = FALSE, last_saved_at = CURRENT_TIMESTAMP, last_saved_by = $' + (normalizedFields.length + 2);
        const result = await pool.query(
            `UPDATE investment_projects SET ${setClauses}, updated_by = $${normalizedFields.length + 1}, updated_at = CURRENT_TIMESTAMP${submissionClauses} WHERE id = $${normalizedFields.length + 3} RETURNING *`,
            [...normalizedFields.map(([_, v]) => v), userId, userId, id]);
        if (!result.rows.length) { res.status(404).json({ error: 'Project not found' }); return; }

        if (shouldSubmit && userId) {
            await createInitialReviewTaskForProject(id, userId);
        }

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'update',
            entityType: 'investment_project',
            entityId: id,
            summary: `${shouldSubmit ? 'submitted' : 'updated'} investment project`,
            metadata: {
                updatedFields: fields.map(([k]) => k),
                columnCount: fields.length,
            },
            sourcePath: `/api/investment-projects/${id}`,
            requestMethod: 'PUT',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(200).json({ message: 'Project updated', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update project', details: error.message });
    }
};

export const getLatestSavedInvestmentProject = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureInvestmentLifecycleSchema();

        const userId = (req as any).user?.id;
        const requestedDepartment = String(req.query?.departmentType || '').trim().toLowerCase();
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const effectiveDepartmentType = userRole === 'super_admin' || userRole === 'ceo' ? requestedDepartment : userDepartment;

        if (!userId || !effectiveDepartmentType) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT *
            FROM investment_projects
            WHERE department_type = $1
              AND is_submitted = FALSE
              AND created_by = $2
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [effectiveDepartmentType, userId]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ data: null });
            return;
        }
        res.status(500).json({ error: 'Failed to fetch latest saved project', details: error.message });
    }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────
export const deleteInvestmentProject = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('DELETE FROM investment_projects WHERE id = $1 RETURNING *', [req.params.id]);
        if (!result.rows.length) { res.status(404).json({ error: 'Project not found' }); return; }
        res.status(200).json({ message: 'Project deleted', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to delete project', details: error.message });
    }
};

// ─── FEASIBILITY STATS ────────────────────────────────────────────────────────
export const getFeasibilityStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const { departmentType } = req.query;
        const effectiveDepartmentType = userRole === 'super_admin' || userRole === 'ceo'
            ? departmentType
            : userDepartment;
        const filter = effectiveDepartmentType ? 'WHERE department_type = $1' : '';
        const params = effectiveDepartmentType ? [effectiveDepartmentType] : [];
        const result = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE feasibility_status = 'approved') AS approved,
                COUNT(*) FILTER (WHERE feasibility_status = 'signed_contract') AS signed_contract,
                COUNT(*) FILTER (WHERE feasibility_status = 'rejected') AS rejected
            FROM investment_projects ${filter}`, params);
        res.status(200).json({ message: 'Stats retrieved', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
    }
};

// ─── UPDATE REVIEW STATUS ────────────────────────────────────────────────────
export const updateInvestmentProjectReviewStatus = async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({
        error: 'Direct project review from this endpoint is deprecated.',
        details: 'Use Tasks workflow endpoints for project approval/rejection.',
    });
};

// ─── CONTRACT STATS ───────────────────────────────────────────────────────────
export const getContractStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const { departmentType } = req.query;
        const effectiveDepartmentType = userRole === 'super_admin' || userRole === 'ceo'
            ? departmentType
            : userDepartment;
        const filter = effectiveDepartmentType ? 'WHERE department_type = $1' : '';
        const params = effectiveDepartmentType ? [effectiveDepartmentType] : [];
        const result = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE contract_status = 'contracted') AS contracted,
                COUNT(*) FILTER (WHERE contract_status = 'need_contract') AS need_contract
            FROM investment_projects ${filter}`, params);
        res.status(200).json({ message: 'Contract stats retrieved', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch contract stats', details: error.message });
    }
};
