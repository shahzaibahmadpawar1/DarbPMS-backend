import { Request, Response } from 'express';
import pool from '../config/database';

let energySchemaReady = false;

const ensureEnergyLicenseSchema = async (): Promise<void> => {
    if (energySchemaReady) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS energy_licenses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            license_number TEXT UNIQUE NOT NULL,
            issuance_date DATE,
            expiry_date DATE,
            number_of_days INTEGER,
            license_status TEXT,
            station_code TEXT NOT NULL,
            office_code TEXT,
            is_submitted BOOLEAN NOT NULL DEFAULT TRUE,
            submitted_at TIMESTAMP WITH TIME ZONE,
            submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
            last_saved_at TIMESTAMP WITH TIME ZONE,
            last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await pool.query(`
        UPDATE energy_licenses
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    energySchemaReady = true;
};

export const createEnergyLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureEnergyLicenseSchema();

        const { licenseNumber, issuanceDate, expiryDate, numberOfDays, licenseStatus, stationCode, officeCode, submit } = req.body;
        const shouldSubmit = submit !== false;
        const resolvedLicenseNumber = String(licenseNumber || '').trim() || `ENR-DRAFT-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedLicenseNumber)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires license number.' });
            return;
        }

        const userId = (req as any).user?.id;
        const result = await pool.query(`
            INSERT INTO energy_licenses (
                license_number, issuance_date, expiry_date, number_of_days, license_status,
                station_code, office_code, created_by, updated_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
            RETURNING *
        `, [
            resolvedLicenseNumber,
            issuanceDate || null,
            expiryDate || null,
            numberOfDays || null,
            licenseStatus || null,
            stationCode,
            officeCode || null,
            userId,
        ]);

        await pool.query(`
            UPDATE energy_licenses
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE id = $3
        `, [shouldSubmit, userId || null, result.rows[0].id]);

        const refreshed = await pool.query('SELECT * FROM energy_licenses WHERE id = $1 LIMIT 1', [result.rows[0].id]);
        res.status(201).json({
            message: shouldSubmit ? 'Energy License submitted successfully' : 'Energy License saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating energy license:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'License number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create energy license', details: error.message });
    }
};

export const getAllEnergyLicenses = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureEnergyLicenseSchema();

        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;

        const query = userRole === 'super_admin'
            ? 'SELECT * FROM energy_licenses ORDER BY created_at DESC'
            : `
                SELECT e.* FROM energy_licenses e
                INNER JOIN station_information si ON si.station_code = e.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY e.created_at DESC
            `;

        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Energy licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching energy licenses:', error);
        res.status(500).json({ error: 'Failed to fetch energy licenses', details: error.message });
    }
};

export const getEnergyLicensesByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureEnergyLicenseSchema();

        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM energy_licenses WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Energy licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching energy licenses by station:', error);
        res.status(500).json({ error: 'Failed to fetch energy licenses', details: error.message });
    }
};

export const updateEnergyLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureEnergyLicenseSchema();

        const { id } = req.params;
        const userId = (req as any).user?.id;
        const submit = (req.body as any)?.submit;
        const shouldSubmit = submit === true || submit === 'true';

        const fields = Object.entries(req.body).filter(([k, v]) => k !== 'submit' && v !== undefined);
        if (!fields.length) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        const setClause = fields
            .map(([k], i) => `${k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)} = $${i + 1}`)
            .join(', ');

        const result = await pool.query(`
            UPDATE energy_licenses
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
        `, [...fields.map(([, v]) => v), shouldSubmit, userId, id]);

        if (!result.rows.length) {
            res.status(404).json({ error: 'Energy license not found' });
            return;
        }

        res.status(200).json({ message: 'Energy license updated successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error updating energy license:', error);
        res.status(500).json({ error: 'Failed to update energy license', details: error.message });
    }
};

export const getLatestSavedEnergyLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureEnergyLicenseSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM energy_licenses
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error: any) {
        console.error('Error fetching latest saved energy license:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved energy license', details: error.message });
    }
};

export const deleteEnergyLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureEnergyLicenseSchema();

        const { id } = req.params;
        const result = await pool.query('DELETE FROM energy_licenses WHERE id = $1 RETURNING *', [id]);
        if (!result.rows.length) {
            res.status(404).json({ error: 'Energy license not found' });
            return;
        }

        res.status(200).json({ message: 'Energy license deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error deleting energy license:', error);
        res.status(500).json({ error: 'Failed to delete energy license', details: error.message });
    }
};
