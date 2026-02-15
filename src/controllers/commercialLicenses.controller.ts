import { Request, Response } from 'express';
import pool from '../config/database';

export const createCommercialLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            licenseNo, paymentDueDate, issuanceDate, licenseExpiryDate,
            numberOfDays, licenseStatus, ownerName, ownerId,
            isicClassification, municipality, subMunicipality, district,
            street, totalSpace, signSpace, stationCode
        } = req.body;

        if (!licenseNo || !stationCode) {
            res.status(400).json({ error: 'License No and station code are required' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO commercial_licenses (
                license_no, payment_due_date, issuance_date, license_expiry_date, 
                number_of_days, license_status, owner_name, owner_id, 
                isic_classification, municipality, sub_municipality, district, 
                street, total_space, sign_space, station_code, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
            RETURNING *
        `;

        const values = [
            licenseNo, paymentDueDate || null, issuanceDate || null, licenseExpiryDate || null,
            numberOfDays || 0, licenseStatus, ownerName, ownerId,
            isicClassification, municipality, subMunicipality, district,
            street, totalSpace || 0, signSpace || 0, stationCode, userId
        ];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Commercial License created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating commercial license:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'License No already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create commercial license' });
    }
};

export const getAllCommercialLicenses = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM commercial_licenses ORDER BY created_at DESC');
        res.status(200).json({ message: 'Commercial Licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching commercial licenses:', error);
        res.status(500).json({ error: 'Failed to fetch commercial licenses' });
    }
};

export const getCommercialLicensesByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM commercial_licenses WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Commercial Licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching commercial licenses:', error);
        res.status(500).json({ error: 'Failed to fetch commercial licenses' });
    }
};

export const updateCommercialLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const reqBody = req.body;
        const userId = (req as any).user?.id;

        const fields = Object.entries(reqBody).filter(([_, v]) => v !== undefined);
        if (fields.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        const setClause = fields.map(([k, _], i) => `${k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)} = $${i + 1}`).join(', ');
        const query = `
            UPDATE commercial_licenses 
            SET ${setClause}, updated_by = $${fields.length + 1}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${fields.length + 2}
            RETURNING *
        `;

        const values = [...fields.map(([_, v]) => v), userId, id];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Commercial License not found' });
            return;
        }
        res.status(200).json({ message: 'Commercial License updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating commercial license:', error);
        res.status(500).json({ error: 'Failed to update commercial license' });
    }
};

export const deleteCommercialLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM commercial_licenses WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Commercial License not found' });
            return;
        }
        res.status(200).json({ message: 'Commercial License deleted successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error deleting commercial license:', error);
        res.status(500).json({ error: 'Failed to delete commercial license' });
    }
};
