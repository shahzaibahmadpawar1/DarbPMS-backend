import { Request, Response } from 'express';
import pool from '../config/database';
import { createWorkflowTaskForProject } from './workflowTasks.controller';
import { deriveAction, recordWorkflowTransition } from '../utils/workflow';

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

const normalizeStationType = (value: unknown): 'investment' | 'franchise' | 'operation' | 'rent' | 'ownership' => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'frenchise') return 'franchise';
    if (normalized === 'franchise') return 'franchise';
    if (normalized === 'operation') return 'operation';
    if (normalized === 'rent') return 'rent';
    if (normalized === 'ownership') return 'ownership';
    return 'investment';
};

const upsertStationFromProject = async (project: any, userId: string): Promise<void> => {
    const stationCode = String(project.project_code || '').trim();
    const stationName = String(project.project_name || '').trim();

    if (!stationCode || !stationName) {
        throw new Error('Station sync failed: project code and project name are required');
    }

    await pool.query(`
        INSERT INTO station_information (
            station_code, station_name, city, district,
            geographic_location, station_type_code, station_status_code,
            created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        ON CONFLICT (station_code) DO UPDATE SET
            station_name = EXCLUDED.station_name,
            city = EXCLUDED.city,
            district = EXCLUDED.district,
            geographic_location = EXCLUDED.geographic_location,
            station_type_code = EXCLUDED.station_type_code,
            station_status_code = EXCLUDED.station_status_code,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP
    `, [
        stationCode,
        stationName,
        project.city,
        project.district,
        project.google_location,
        normalizeStationType(project.department_type),
        project.project_status || 'Active',
        userId,
    ]);
};

// ─── CREATE ───────────────────────────────────────────────────────────────────
export const createInvestmentProject = async (req: Request, res: Response): Promise<void> => {
    try {
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
        } = req.body;

        if (!projectName || !projectCode || !departmentType) {
            res.status(400).json({ error: 'Project name, code and department type are required' });
            return;
        }

        const normalizedContractType = normalizeContractType(contractType);

        const userId = (req as any).user?.id;
        const result = await pool.query(`
            INSERT INTO investment_projects (
                department_type, request_type, project_name, project_code, city, district, area,
                project_status, contract_type, google_location, priority_level, order_date, request_sender,
                super_market, fuel_station, kiosks, retail_shop, drive_through,
                super_market_area, fuel_station_area, kiosks_area, retail_shop_area, drive_through_area,
                owner_name, owner_contact_no, id_no, national_address, email, owner_type,
                design_file_url, documents_url, autocad_url,
                station_code, created_by, updated_by
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                $14,$15,$16,$17,$18,
                $19,$20,$21,$22,$23,
                $24,$25,$26,$27,$28,$29,
                $30,$31,$32,$33,$34,$34
            ) RETURNING *`,
            [
                departmentType, requestType, projectName, projectCode, city, district, area || 0,
                projectStatus, normalizedContractType, googleLocation, priorityLevel, orderDate || null, requestSender,
                superMarket || 0, fuelStation || 0, kiosks || 0, retailShop || 0, driveThrough || 0,
                superMarketArea || 0, fuelStationArea || 0, kiosksArea || 0, retailShopArea || 0, driveThroughArea || 0,
                ownerName, ownerContactNo, idNo, nationalAddress, email, ownerType || 'individual',
                designFileUrl, documentsUrl, autocadUrl,
                stationCode, userId,
            ]
        );
        res.status(201).json({ message: 'Investment project created successfully', data: result.rows[0] });
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
        const { departmentType } = req.query;
        const effectiveDepartmentType = userRole === 'super_admin'
            ? departmentType
            : userDepartment;

        const query = effectiveDepartmentType
            ? 'SELECT * FROM investment_projects WHERE department_type = $1 ORDER BY created_at DESC'
            : 'SELECT * FROM investment_projects ORDER BY created_at DESC';
        const params = effectiveDepartmentType ? [effectiveDepartmentType] : [];
        const result = await pool.query(query, params);
        res.status(200).json({ message: 'Projects retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
    }
};

// ─── GET BY STATION ───────────────────────────────────────────────────────────
export const getInvestmentProjectsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const { stationCode } = req.params;
        const { departmentType } = req.query;
        const effectiveDepartmentType = userRole === 'super_admin'
            ? departmentType
            : userDepartment;

        const query = effectiveDepartmentType
            ? 'SELECT * FROM investment_projects WHERE station_code = $1 AND department_type = $2 ORDER BY created_at DESC'
            : 'SELECT * FROM investment_projects WHERE station_code = $1 ORDER BY created_at DESC';
        const params = effectiveDepartmentType ? [stationCode, effectiveDepartmentType] : [stationCode];
        const result = await pool.query(query, params);
        res.status(200).json({ message: 'Projects retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
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
        const { id } = req.params;
        const userId = (req as any).user?.id;
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
        const fields = Object.entries(req.body).filter(([_, v]) => v !== undefined);
        if (!fields.length) { res.status(400).json({ error: 'No fields to update' }); return; }

        const normalizedFields = fields.map(([key, value]) => {
            if (key === 'contractType' || key === 'contract_type') {
                return [key, normalizeContractType(value)] as const;
            }
            return [key, value] as const;
        });

        const setClauses = normalizedFields.map(([k, _], i) => `${fieldMap[k] || k} = $${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE investment_projects SET ${setClauses}, updated_by = $${normalizedFields.length + 1}, updated_at = CURRENT_TIMESTAMP WHERE id = $${normalizedFields.length + 2} RETURNING *`,
            [...normalizedFields.map(([_, v]) => v), userId, id]);
        if (!result.rows.length) { res.status(404).json({ error: 'Project not found' }); return; }
        res.status(200).json({ message: 'Project updated', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update project', details: error.message });
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
        const effectiveDepartmentType = userRole === 'super_admin'
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
export const updateInvestmentProjectReviewStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { reviewStatus, comment, action } = req.body;
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;

        const normalizedAction = deriveAction(action || reviewStatus);
        if (!normalizedAction) {
            res.status(400).json({ error: 'A valid action is required: Approve, Contract, Documents or Reject' });
            return;
        }

        let nextReviewStatus: 'Approved' | 'Rejected' | 'Validated';
        let workflowPath: 'contract' | 'documents' | null = null;

        const previousResult = await pool.query('SELECT review_status FROM investment_projects WHERE id = $1 LIMIT 1', [id]);
        const previousStatus = previousResult.rows[0]?.review_status || null;

        if (normalizedAction === 'Approve') {
            nextReviewStatus = 'Approved';
        } else if (normalizedAction === 'Reject') {
            nextReviewStatus = 'Rejected';
        } else {
            nextReviewStatus = 'Validated';
            workflowPath = normalizedAction === 'Contract' ? 'contract' : 'documents';
        }

        const commentField = userRole === 'super_admin' ? 'ceo_comment' : 'pm_comment';
        const updateResult = await pool.query(
            `UPDATE investment_projects
             SET review_status = $1,
                 workflow_path = $2,
                 ${commentField} = $3,
                 updated_by = $4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING *`,
            [nextReviewStatus, workflowPath, comment || null, userId, id],
        );

        if (!updateResult.rows.length) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        // If approved by CEO, auto-create a station in station_information
        if (nextReviewStatus === 'Approved') {
            const project = updateResult.rows[0];
            await upsertStationFromProject(project, userId);
        }

        if (workflowPath && userId) {
            await createWorkflowTaskForProject(id, workflowPath, userId);
        }

        await recordWorkflowTransition({
            entityType: 'investment_project',
            entityId: id,
            oldState: previousStatus,
            newState: nextReviewStatus,
            changedBy: userId,
            note: comment || `Workflow action: ${normalizedAction}`,
            metadata: {
                action: normalizedAction,
                workflowPath,
                actorRole: userRole,
            },
        });

        res.status(200).json({
            message: 'Project workflow action applied',
            data: updateResult.rows[0],
            action: normalizedAction,
        });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update review status', details: error.message });
    }
};

// ─── CONTRACT STATS ───────────────────────────────────────────────────────────
export const getContractStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const { departmentType } = req.query;
        const effectiveDepartmentType = userRole === 'super_admin'
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
