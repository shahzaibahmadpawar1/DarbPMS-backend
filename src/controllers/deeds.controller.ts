import { Request, Response } from 'express';
import pool from '../config/database';

export const createDeed = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            deedNo, deedDate, deedIssueBy, realEstateUnitNumber, area,
            nationality, percentage, address, idType, idDate, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode
        } = req.body;

        if (!deedNo || !stationCode) {
            res.status(400).json({ error: 'Deed No and station code are required' });
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
            deedNo, deedDate || null, deedIssueBy, realEstateUnitNumber, area || 0,
            nationality, percentage || 0, address, idType, idDate || null, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode, userId
        ];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Deed information created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating deed:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Deed No already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create deed information' });
    }
};

export const getAllDeeds = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM deeds ORDER BY created_at DESC');
        res.status(200).json({ message: 'Deeds retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching deeds:', error);
        res.status(500).json({ error: 'Failed to fetch deeds' });
    }
};

export const getDeedsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM deeds WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Deeds retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching deeds:', error);
        res.status(500).json({ error: 'Failed to fetch deeds' });
    }
};

export const updateDeed = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const {
            deedNo, deedDate, deedIssueBy, realEstateUnitNumber, area,
            nationality, percentage, address, idType, idDate, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode
        } = req.body;
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
                updated_by = $18,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $19
            RETURNING *
        `;

        const values = [
            deedNo, deedDate, deedIssueBy, realEstateUnitNumber, area,
            nationality, percentage, address, idType, idDate, landNo,
            blockNumber, district, city, unitType, statusCode, stationCode, userId, id
        ];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Deed not found' });
            return;
        }
        res.status(200).json({ message: 'Deed updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating deed:', error);
        res.status(500).json({ error: 'Failed to update deed' });
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
    } catch (error) {
        console.error('Error deleting deed:', error);
        res.status(500).json({ error: 'Failed to delete deed' });
    }
};
