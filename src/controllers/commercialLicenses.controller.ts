import { Request, Response } from 'express';
import pool from '../config/database';

let commercialLicenseLifecycleReady = false;

const ensureCommercialLicenseLifecycleSchema = async (): Promise<void> => {
    if (commercialLicenseLifecycleReady) return;

    await pool.query(`ALTER TABLE commercial_licenses ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE commercial_licenses ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE commercial_licenses ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE commercial_licenses ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE commercial_licenses ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE commercial_licenses
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    commercialLicenseLifecycleReady = true;
};

export const createCommercialLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureCommercialLicenseLifecycleSchema();

        const {
            licenseNo, paymentDueDate, issuanceDate, licenseExpiryDate,
            numberOfDays, licenseStatus, ownerName, ownerId,
            isicClassification, municipality, subMunicipality, district,
            street, totalSpace, signSpace, stationCode, submit
        } = req.body;

        const shouldSubmit = submit !== false;
        const resolvedLicenseNo = String(licenseNo || '').trim() || `COM-DRAFT-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedLicenseNo)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires License No.' });
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
            resolvedLicenseNo, paymentDueDate || null, issuanceDate || null, licenseExpiryDate || null,
            numberOfDays || 0, licenseStatus, ownerName, ownerId,
            isicClassification, municipality, subMunicipality, district,
            street, totalSpace || 0, signSpace || 0, stationCode, userId
        ];
        const result = await pool.query(query, values);

        await pool.query(`
            UPDATE commercial_licenses
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE id = $3
        `, [shouldSubmit, userId || null, result.rows[0].id]);

        const refreshed = await pool.query('SELECT * FROM commercial_licenses WHERE id = $1 LIMIT 1', [result.rows[0].id]);

        res.status(201).json({
            message: shouldSubmit ? 'Commercial License submitted successfully' : 'Commercial License saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating commercial license:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'License No already exists' });
            return;
        }
        res.status(500).json({
            error: 'Failed to create commercial license',
            details: error.message
        });
    }
};

export const getAllCommercialLicenses = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin'
            ? 'SELECT * FROM commercial_licenses ORDER BY created_at DESC'
            : `
                SELECT c.* FROM commercial_licenses c
                INNER JOIN station_information si ON si.station_code = c.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY c.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Commercial Licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching commercial licenses:', error);
        res.status(500).json({ error: 'Failed to fetch commercial licenses', details: error.message });
    }
};

export const getCommercialLicensesByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM commercial_licenses WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Commercial Licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching commercial licenses:', error);
        res.status(500).json({ error: 'Failed to fetch commercial licenses', details: error.message });
    }
};

export const updateCommercialLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureCommercialLicenseLifecycleSchema();

        const { id } = req.params;
        const reqBody = req.body;
        const userId = (req as any).user?.id;
        const submit = reqBody?.submit;
        const shouldSubmit = submit === true || submit === 'true';

        const fields = Object.entries(reqBody).filter(([k, v]) => k !== 'submit' && v !== undefined);
        if (fields.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        const setClause = fields.map(([k, _], i) => `${k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)} = $${i + 1}`).join(', ');
        const query = `
            UPDATE commercial_licenses 
            SET ${setClause},
                is_submitted = $${fields.length + 1},
                submitted_at = CASE WHEN $${fields.length + 1} THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $${fields.length + 1} THEN $${fields.length + 2} ELSE submitted_by END,
                last_saved_at = CASE WHEN $${fields.length + 1} THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $${fields.length + 1} THEN last_saved_by ELSE $${fields.length + 2} END,
                updated_by = $${fields.length + 2},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${fields.length + 3}
            RETURNING *
        `;

        const values = [...fields.map(([_, v]) => v), shouldSubmit, userId, id];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Commercial License not found' });
            return;
        }
        res.status(200).json({ message: 'Commercial License updated successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error updating commercial license:', error);
        res.status(500).json({
            error: 'Failed to update commercial license',
            details: error.message
        });
    }
};

export const getLatestSavedCommercialLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureCommercialLicenseLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM commercial_licenses
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error: any) {
        console.error('Error fetching latest saved commercial license:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved commercial license', details: error.message });
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
    } catch (error: any) {
        console.error('Error deleting commercial license:', error);
        res.status(500).json({
            error: 'Failed to delete commercial license',
            details: error.message
        });
    }
};
