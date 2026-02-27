import { Request, Response } from 'express';
import pool from '../config/database';

// ─── CREATE ───────────────────────────────────────────────────────────────────
export const createInvestmentProject = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            departmentType, requestType, projectName, projectCode, city, district, area,
            projectStatus, contractType, googleLocation, priorityLevel, orderDate, requestSender,
            // Elements
            superMarket, fuelStation, kiosks, retailShop, driveThrough, elementArea,
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

        const userId = (req as any).user?.id;
        const result = await pool.query(`
            INSERT INTO investment_projects (
                department_type, request_type, project_name, project_code, city, district, area,
                project_status, contract_type, google_location, priority_level, order_date, request_sender,
                super_market, fuel_station, kiosks, retail_shop, drive_through, element_area,
                owner_name, owner_contact_no, id_no, national_address, email, owner_type,
                design_file_url, documents_url, autocad_url,
                station_code, created_by, updated_by
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                $14,$15,$16,$17,$18,$19,
                $20,$21,$22,$23,$24,$25,
                $26,$27,$28,$29,$30,$30
            ) RETURNING *`,
            [
                departmentType, requestType, projectName, projectCode, city, district, area || 0,
                projectStatus, contractType, googleLocation, priorityLevel, orderDate || null, requestSender,
                superMarket || 0, fuelStation || 0, kiosks || 0, retailShop || 0, driveThrough || 0, elementArea || 0,
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
        const { departmentType } = req.query;
        const query = departmentType
            ? 'SELECT * FROM investment_projects WHERE department_type = $1 ORDER BY created_at DESC'
            : 'SELECT * FROM investment_projects ORDER BY created_at DESC';
        const params = departmentType ? [departmentType] : [];
        const result = await pool.query(query, params);
        res.status(200).json({ message: 'Projects retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch projects', details: error.message });
    }
};

// ─── GET BY STATION ───────────────────────────────────────────────────────────
export const getInvestmentProjectsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const { departmentType } = req.query;
        const query = departmentType
            ? 'SELECT * FROM investment_projects WHERE station_code = $1 AND department_type = $2 ORDER BY created_at DESC'
            : 'SELECT * FROM investment_projects WHERE station_code = $1 ORDER BY created_at DESC';
        const params = departmentType ? [stationCode, departmentType] : [stationCode];
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
            projectStatus: 'project_status', contractType: 'contract_type',
            googleLocation: 'google_location', priorityLevel: 'priority_level',
            orderDate: 'order_date', requestSender: 'request_sender',
            superMarket: 'super_market', fuelStation: 'fuel_station',
            retailShop: 'retail_shop', driveThrough: 'drive_through',
            elementArea: 'element_area', ownerContactNo: 'owner_contact_no',
            ownerName: 'owner_name', idNo: 'id_no', nationalAddress: 'national_address',
            ownerType: 'owner_type', designFileUrl: 'design_file_url',
            documentsUrl: 'documents_url', autocadUrl: 'autocad_url',
            stationCode: 'station_code',
            reviewStatus: 'review_status',
            pmComment: 'pm_comment',
            ceoComment: 'ceo_comment'
        };
        const fields = Object.entries(req.body).filter(([_, v]) => v !== undefined);
        if (!fields.length) { res.status(400).json({ error: 'No fields to update' }); return; }
        const setClauses = fields.map(([k, _], i) => `${fieldMap[k] || k} = $${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE investment_projects SET ${setClauses}, updated_by = $${fields.length + 1}, updated_at = CURRENT_TIMESTAMP WHERE id = $${fields.length + 2} RETURNING *`,
            [...fields.map(([_, v]) => v), userId, id]);
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
        const { departmentType } = req.query;
        const filter = departmentType ? 'WHERE department_type = $1' : '';
        const params = departmentType ? [departmentType] : [];
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
        const { reviewStatus, comment } = req.body;
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;

        if (!reviewStatus) {
            res.status(400).json({ error: 'Review status is required' });
            return;
        }

        let query = '';
        let params: any[] = [];

        if (userRole === 'ceo') {
            query = `UPDATE investment_projects SET review_status = $1, ceo_comment = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *`;
            params = [reviewStatus, comment, userId, id];
        } else {
            // Assume PM/User
            query = `UPDATE investment_projects SET review_status = $1, pm_comment = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *`;
            params = [reviewStatus, comment, userId, id];
        }

        const result = await pool.query(query, params);
        if (!result.rows.length) { res.status(404).json({ error: 'Project not found' }); return; }

        // If approved by CEO, we could potentially do more, but for now just update status
        res.status(200).json({ message: 'Project review status updated', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update review status', details: error.message });
    }
};

// ─── CONTRACT STATS ───────────────────────────────────────────────────────────
export const getContractStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const { departmentType } = req.query;
        const filter = departmentType ? 'WHERE department_type = $1' : '';
        const params = departmentType ? [departmentType] : [];
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
