import { Request, Response } from 'express';
import pool from '../config/database';
import { isSchemaCompatibilityError } from '../utils/dbErrors';

let dispenserLifecycleReady = false;

const ensureDispenserLifecycleSchema = async (): Promise<void> => {
    if (dispenserLifecycleReady) return;

    await pool.query(`ALTER TABLE dispensers ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE dispensers ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE dispensers ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE dispensers ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE dispensers ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE dispensers
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    dispenserLifecycleReady = true;
};

export const createDispenser = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureDispenserLifecycleSchema();

        const { dispenserSerialNumber, dispenserName, model, vendor, numberOfNozzles, status, stationCode, canopyCode, submit } = req.body;
        const shouldSubmit = submit !== false;
        const resolvedDispenserSerial = String(dispenserSerialNumber || '').trim() || `DSP-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedDispenserSerial)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires dispenser serial number.' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO dispensers (
                dispenser_serial_number, dispenser_name, model, vendor, number_of_nozzles, status, station_code, canopy_code,
                is_submitted, submitted_at, submitted_by, last_saved_at, last_saved_by,
                created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
            RETURNING *
        `;

        const values = [
            resolvedDispenserSerial,
            dispenserName,
            model,
            vendor,
            numberOfNozzles,
            status,
            stationCode,
            canopyCode,
            shouldSubmit,
            shouldSubmit ? new Date() : null,
            shouldSubmit ? userId : null,
            shouldSubmit ? null : new Date(),
            shouldSubmit ? null : userId,
            userId,
        ];
        const result = await pool.query(query, values);

        res.status(201).json({
            message: shouldSubmit ? 'Dispenser submitted successfully' : 'Dispenser saved successfully',
            data: result.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating dispenser:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Dispenser serial number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create dispenser' });
    }
};

export const getAllDispensers = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin'
            ? 'SELECT * FROM dispensers ORDER BY created_at DESC'
            : `
                SELECT d.* FROM dispensers d
                INNER JOIN station_information si ON si.station_code = d.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY d.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Dispensers retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching dispensers:', error);
        res.status(500).json({ error: 'Failed to fetch dispensers' });
    }
};

export const getDispensersByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM dispensers WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Dispensers retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ message: 'Dispensers retrieved successfully', data: [], count: 0 });
            return;
        }
        console.error('Error fetching dispensers:', error);
        res.status(500).json({ error: 'Failed to fetch dispensers' });
    }
};

export const getDispenserBySerialNumber = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serialNumber } = req.params;
        const result = await pool.query('SELECT * FROM dispensers WHERE dispenser_serial_number = $1', [serialNumber]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Dispenser not found' });
            return;
        }
        res.status(200).json({ message: 'Dispenser retrieved successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error fetching dispenser:', error);
        res.status(500).json({ error: 'Failed to fetch dispenser' });
    }
};

export const updateDispenser = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureDispenserLifecycleSchema();

        const { serialNumber } = req.params;
        const { dispenserName, model, vendor, numberOfNozzles, status, stationCode, canopyCode, submit } = req.body;
        const shouldSubmit = submit === true || submit === 'true';
        const userId = (req as any).user?.id;

        const query = `
            UPDATE dispensers 
            SET dispenser_name = COALESCE($1, dispenser_name),
                model = COALESCE($2, model),
                vendor = COALESCE($3, vendor),
                number_of_nozzles = COALESCE($4, number_of_nozzles),
                status = COALESCE($5, status),
                station_code = COALESCE($6, station_code),
                canopy_code = COALESCE($7, canopy_code),
                is_submitted = $8,
                submitted_at = CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $8 THEN $9 ELSE submitted_by END,
                last_saved_at = CASE WHEN $8 THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $8 THEN last_saved_by ELSE $9 END,
                updated_by = $9,
                updated_at = CURRENT_TIMESTAMP
            WHERE dispenser_serial_number = $10
            RETURNING *
        `;

        const values = [dispenserName, model, vendor, numberOfNozzles, status, stationCode, canopyCode, shouldSubmit, userId, serialNumber];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Dispenser not found' });
            return;
        }
        res.status(200).json({ message: 'Dispenser updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating dispenser:', error);
        res.status(500).json({ error: 'Failed to update dispenser' });
    }
};

export const getLatestSavedDispenser = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureDispenserLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM dispensers
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error) {
        console.error('Error fetching latest saved dispenser:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved dispenser' });
    }
};

export const deleteDispenser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serialNumber } = req.params;
        const result = await pool.query('DELETE FROM dispensers WHERE dispenser_serial_number = $1 RETURNING *', [serialNumber]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Dispenser not found' });
            return;
        }
        res.status(200).json({ message: 'Dispenser deleted successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error deleting dispenser:', error);
        res.status(500).json({ error: 'Failed to delete dispenser' });
    }
};
