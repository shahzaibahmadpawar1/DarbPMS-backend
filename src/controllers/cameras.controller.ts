import { Request, Response } from 'express';
import pool from '../config/database';

let cameraLifecycleReady = false;

const ensureCameraLifecycleSchema = async (): Promise<void> => {
    if (cameraLifecycleReady) return;

    await pool.query(`ALTER TABLE cameras ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE cameras ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE cameras ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE cameras ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE cameras ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE cameras
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    cameraLifecycleReady = true;
};

export const createCamera = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureCameraLifecycleSchema();

        const { serialNumber, cameraType, model, size, location, status, stationCode, submit } = req.body;
        const shouldSubmit = submit !== false;
        const resolvedSerialNumber = String(serialNumber || '').trim() || `CAM-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedSerialNumber)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires serial number.' });
            return;
        }

        const userId = (req as any).user?.id;

        const query = `
            INSERT INTO cameras (
                serial_number, camera_type, model, size, location, status, station_code,
                is_submitted, submitted_at, submitted_by, last_saved_at, last_saved_by,
                created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
            RETURNING *
        `;

        const values = [
            resolvedSerialNumber,
            cameraType,
            model,
            size,
            location,
            status,
            stationCode,
            shouldSubmit,
            shouldSubmit ? new Date() : null,
            shouldSubmit ? userId : null,
            shouldSubmit ? null : new Date(),
            shouldSubmit ? null : userId,
            userId,
        ];
        const result = await pool.query(query, values);

        res.status(201).json({
            message: shouldSubmit ? 'Camera submitted successfully' : 'Camera saved successfully',
            data: result.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating camera:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Camera serial number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create camera' });
    }
};

export const getAllCameras = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin'
            ? 'SELECT * FROM cameras ORDER BY created_at DESC'
            : `
                SELECT c.* FROM cameras c
                INNER JOIN station_information si ON si.station_code = c.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY c.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Cameras retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching cameras:', error);
        res.status(500).json({ error: 'Failed to fetch cameras' });
    }
};

export const getCamerasByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM cameras WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Cameras retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching cameras:', error);
        res.status(500).json({ error: 'Failed to fetch cameras' });
    }
};

export const getCameraBySerialNumber = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serialNumber } = req.params;
        const result = await pool.query('SELECT * FROM cameras WHERE serial_number = $1', [serialNumber]);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Camera not found' });
            return;
        }

        res.status(200).json({ message: 'Camera retrieved successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error fetching camera:', error);
        res.status(500).json({ error: 'Failed to fetch camera' });
    }
};

export const updateCamera = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureCameraLifecycleSchema();

        const { serialNumber } = req.params;
        const { cameraType, model, size, location, status, stationCode, submit } = req.body;
        const shouldSubmit = submit === true || submit === 'true';
        const userId = (req as any).user?.id;

        const query = `
            UPDATE cameras 
            SET camera_type = COALESCE($1, camera_type),
                model = COALESCE($2, model),
                size = COALESCE($3, size),
                location = COALESCE($4, location),
                status = COALESCE($5, status),
                station_code = COALESCE($6, station_code),
                is_submitted = $7,
                submitted_at = CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $7 THEN $8 ELSE submitted_by END,
                last_saved_at = CASE WHEN $7 THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $7 THEN last_saved_by ELSE $8 END,
                updated_by = $8,
                updated_at = CURRENT_TIMESTAMP
            WHERE serial_number = $9
            RETURNING *
        `;

        const values = [cameraType, model, size, location, status, stationCode, shouldSubmit, userId, serialNumber];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Camera not found' });
            return;
        }

        res.status(200).json({ message: 'Camera updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating camera:', error);
        res.status(500).json({ error: 'Failed to update camera' });
    }
};

export const getLatestSavedCamera = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureCameraLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM cameras
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error) {
        console.error('Error fetching latest saved camera:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved camera' });
    }
};

export const deleteCamera = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serialNumber } = req.params;
        const result = await pool.query('DELETE FROM cameras WHERE serial_number = $1 RETURNING *', [serialNumber]);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Camera not found' });
            return;
        }

        res.status(200).json({ message: 'Camera deleted successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error deleting camera:', error);
        res.status(500).json({ error: 'Failed to delete camera' });
    }
};
