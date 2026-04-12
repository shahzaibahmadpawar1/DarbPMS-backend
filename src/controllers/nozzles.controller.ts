import { Request, Response } from 'express';
import pool from '../config/database';
import { recordActivity } from '../utils/activity';

let nozzleLifecycleReady = false;

const ensureNozzleLifecycleSchema = async (): Promise<void> => {
    if (nozzleLifecycleReady) return;

    await pool.query(`ALTER TABLE nozzles ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE nozzles ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE nozzles ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE nozzles ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE nozzles ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE nozzles
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    nozzleLifecycleReady = true;
};

export const createNozzle = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureNozzleLifecycleSchema();

        const { nozzleSerialNumber, fuelType, vendor, dispenserSerialNumber, submit } = req.body;
        const shouldSubmit = submit !== false;
        const resolvedNozzleSerialNumber = String(nozzleSerialNumber || '').trim() || `NOZ-${Date.now()}`;

        if (!dispenserSerialNumber || (shouldSubmit && !resolvedNozzleSerialNumber)) {
            res.status(400).json({ error: 'Dispenser serial number is required. Submit also requires nozzle serial number.' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO nozzles (nozzle_serial_number, fuel_type, vendor, dispenser_serial_number, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING *
        `;

        const values = [resolvedNozzleSerialNumber, fuelType, vendor, dispenserSerialNumber, userId];
        const result = await pool.query(query, values);

        await pool.query(`
            UPDATE nozzles
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE nozzle_serial_number = $3
        `, [shouldSubmit, userId || null, result.rows[0].nozzle_serial_number]);

        const refreshed = await pool.query('SELECT * FROM nozzles WHERE nozzle_serial_number = $1 LIMIT 1', [result.rows[0].nozzle_serial_number]);

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'nozzle',
            entityId: result.rows[0].nozzle_serial_number,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} nozzle: ${result.rows[0].nozzle_serial_number}`,
            metadata: {
                serialNumber: result.rows[0].nozzle_serial_number,
                fuelType,
            },
            sourcePath: '/api/nozzles',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Nozzle submitted successfully' : 'Nozzle saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating nozzle:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Nozzle serial number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create nozzle' });
    }
};

export const getAllNozzles = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin'
            ? 'SELECT * FROM nozzles ORDER BY created_at DESC'
            : `
                SELECT n.* FROM nozzles n
                INNER JOIN dispensers d ON d.dispenser_serial_number = n.dispenser_serial_number
                INNER JOIN station_information si ON si.station_code = d.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY n.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Nozzles retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching nozzles:', error);
        res.status(500).json({ error: 'Failed to fetch nozzles' });
    }
};

export const getNozzlesByDispenser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { dispenserSerialNumber } = req.params;
        const result = await pool.query('SELECT * FROM nozzles WHERE dispenser_serial_number = $1 ORDER BY created_at DESC', [dispenserSerialNumber]);
        res.status(200).json({ message: 'Nozzles retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching nozzles:', error);
        res.status(500).json({ error: 'Failed to fetch nozzles' });
    }
};

export const getNozzleBySerialNumber = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serialNumber } = req.params;
        const result = await pool.query('SELECT * FROM nozzles WHERE nozzle_serial_number = $1', [serialNumber]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Nozzle not found' });
            return;
        }
        res.status(200).json({ message: 'Nozzle retrieved successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error fetching nozzle:', error);
        res.status(500).json({ error: 'Failed to fetch nozzle' });
    }
};

export const updateNozzle = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureNozzleLifecycleSchema();

        const { serialNumber } = req.params;
        const { fuelType, vendor, dispenserSerialNumber, submit } = req.body;
        const shouldSubmit = submit === true || submit === 'true';
        const userId = (req as any).user?.id;

        const query = `
            UPDATE nozzles 
            SET fuel_type = COALESCE($1, fuel_type),
                vendor = COALESCE($2, vendor),
                dispenser_serial_number = COALESCE($3, dispenser_serial_number),
                is_submitted = $4,
                submitted_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $4 THEN $5 ELSE submitted_by END,
                last_saved_at = CASE WHEN $4 THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $4 THEN last_saved_by ELSE $5 END,
                updated_by = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE nozzle_serial_number = $6
            RETURNING *
        `;

        const values = [fuelType, vendor, dispenserSerialNumber, shouldSubmit, userId, serialNumber];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Nozzle not found' });
            return;
        }

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'update',
            entityType: 'nozzle',
            entityId: result.rows[0].nozzle_serial_number,
            summary: `${shouldSubmit ? 'submitted' : 'updated'} nozzle: ${serialNumber}`,
            metadata: {
                serialNumber,
            },
            sourcePath: `/api/nozzles/${serialNumber}`,
            requestMethod: 'PUT',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(200).json({ message: 'Nozzle updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating nozzle:', error);
        res.status(500).json({ error: 'Failed to update nozzle' });
    }
};

export const getLatestSavedNozzle = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureNozzleLifecycleSchema();

        const userId = (req as any).user?.id;
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM nozzles
            WHERE is_submitted = FALSE
              AND created_by = $1
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error) {
        console.error('Error fetching latest saved nozzle:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved nozzle' });
    }
};

export const deleteNozzle = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serialNumber } = req.params;
        const result = await pool.query('DELETE FROM nozzles WHERE nozzle_serial_number = $1 RETURNING *', [serialNumber]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Nozzle not found' });
            return;
        }
        res.status(200).json({ message: 'Nozzle deleted successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error deleting nozzle:', error);
        res.status(500).json({ error: 'Failed to delete nozzle' });
    }
};
