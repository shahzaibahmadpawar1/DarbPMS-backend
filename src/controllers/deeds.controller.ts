import { Request, Response } from 'express';
import pool from '../config/database';
import { recordActivity } from '../utils/activity';

let deedLifecycleReady = false;

const ensureDeedLifecycleSchema = async (): Promise<void> => {
    if (deedLifecycleReady) return;

    await pool.query(`ALTER TABLE deeds ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE deeds ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE deeds ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE deeds ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE deeds ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE deeds
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    deedLifecycleReady = true;
};

export const createDeed = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureDeedLifecycleSchema();

        const {
            deedNo, deedDate, deedIssueBy, realEstateUnitNumber, area,
            nationality, percentage, address, idType, idDate, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode, submit
        } = req.body;

        const shouldSubmit = submit !== false;
        const resolvedDeedNo = String(deedNo || '').trim() || `DEED-DRAFT-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedDeedNo)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires deed number.' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO deeds (
                deed_no, deed_date, deed_issue_by, real_estate_unit_number, area, 
                nationality, percentage, address, id_type, id_date, land_no, 
                block_number, district, city, unit_type, status_code, station_code, 
                created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
            RETURNING *
        `;

        const values = [
            resolvedDeedNo, deedDate || null, deedIssueBy, realEstateUnitNumber, area || 0,
            nationality, percentage || 0, address, idType, idDate || null, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode, userId
        ];
        const result = await pool.query(query, values);

        await pool.query(`
            UPDATE deeds
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE id = $3
        `, [shouldSubmit, userId || null, result.rows[0].id]);

        const refreshed = await pool.query('SELECT * FROM deeds WHERE id = $1 LIMIT 1', [result.rows[0].id]);

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'deed',
            entityId: result.rows[0].id,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} deed document`,
            metadata: {
                deedType: result.rows[0].deed_type,
            },
            sourcePath: '/api/deeds',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Deed information submitted successfully' : 'Deed information saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating deed:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Deed No already exists' });
            return;
        }
        res.status(500).json({
            error: 'Failed to create deed information',
            details: error.message
        });
    }
};

export const getAllDeeds = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin'
            ? 'SELECT * FROM deeds ORDER BY created_at DESC'
            : `
                SELECT d.* FROM deeds d
                INNER JOIN station_information si ON si.station_code = d.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY d.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Deeds retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching deeds:', error);
        res.status(500).json({ error: 'Failed to fetch deeds', details: error.message });
    }
};

export const getDeedsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM deeds WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Deeds retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching deeds:', error);
        res.status(500).json({ error: 'Failed to fetch deeds', details: error.message });
    }
};

export const updateDeed = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureDeedLifecycleSchema();

        const { id } = req.params;
        const {
            deedNo, deedDate, deedIssueBy, realEstateUnitNumber, area,
            nationality, percentage, address, idType, idDate, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode, submit
        } = req.body;
        const shouldSubmit = submit === true || submit === 'true';
        const userId = (req as any).user?.id;

        const query = `
            UPDATE deeds 
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
                is_submitted = $18,
                submitted_at = CASE WHEN $18 THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $18 THEN $19 ELSE submitted_by END,
                last_saved_at = CASE WHEN $18 THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $18 THEN last_saved_by ELSE $19 END,
                updated_by = $19,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $20
            RETURNING *
        `;

        const values = [
            deedNo, deedDate, deedIssueBy, realEstateUnitNumber, area,
            nationality, percentage, address, idType, idDate, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode, shouldSubmit, userId, id
        ];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Deed not found' });
            return;
        }
        res.status(200).json({ message: 'Deed updated successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error updating deed:', error);
        res.status(500).json({
            error: 'Failed to update deed',
            details: error.message
        });
    }
};

export const getLatestSavedDeed = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureDeedLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM deeds
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error: any) {
        console.error('Error fetching latest saved deed:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved deed', details: error.message });
    }
};

export const deleteDeed = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM deeds WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Deed not found' });
            return;
        }
        res.status(200).json({ message: 'Deed deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error deleting deed:', error);
        res.status(500).json({
            error: 'Failed to delete deed',
            details: error.message
        });
    }
};
