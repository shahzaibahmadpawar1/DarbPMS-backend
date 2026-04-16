import { Request, Response } from 'express';
import pool from '../config/database';
import { recordActivity } from '../utils/activity';
import { isSchemaCompatibilityError } from '../utils/dbErrors';

let tankLifecycleReady = false;

const ensureTankLifecycleSchema = async (): Promise<void> => {
    if (tankLifecycleReady) return;

    await pool.query(`ALTER TABLE tanks ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE tanks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE tanks ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE tanks ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE tanks ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE tanks
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    tankLifecycleReady = true;
};

export const createTank = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureTankLifecycleSchema();

        const { tankCode, fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode, submit } = req.body;
        const shouldSubmit = submit !== false;
        const resolvedTankCode = String(tankCode || '').trim() || `TNK-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedTankCode)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires tank code.' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO tanks (tank_code, fuel_type, vendor, tank_capacity, tank_size, tank_manufacturer, tank_warranty_certificate, station_code, canopy_code, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
            RETURNING *
        `;

        const values = [resolvedTankCode, fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode, userId];
        const result = await pool.query(query, values);

        await pool.query(`
            UPDATE tanks
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE tank_code = $3
        `, [shouldSubmit, userId || null, result.rows[0].tank_code]);

        const refreshed = await pool.query('SELECT * FROM tanks WHERE tank_code = $1 LIMIT 1', [result.rows[0].tank_code]);

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'tank',
            entityId: result.rows[0].tank_code,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} tank: ${result.rows[0].tank_code}`,
            metadata: {
                tankCode: result.rows[0].tank_code,
                fuelType,
                stationCode,
            },
            sourcePath: '/api/tanks',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Tank submitted successfully' : 'Tank saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating tank:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Tank code already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create tank' });
    }
};

export const getAllTanks = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin' || userRole === 'ceo'
            ? 'SELECT * FROM tanks ORDER BY created_at DESC'
            : `
                SELECT t.* FROM tanks t
                INNER JOIN station_information si ON si.station_code = t.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY t.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' || userRole === 'ceo' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Tanks retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching tanks:', error);
        res.status(500).json({ error: 'Failed to fetch tanks' });
    }
};

export const getTanksByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM tanks WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Tanks retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ message: 'Tanks retrieved successfully', data: [], count: 0 });
            return;
        }
        console.error('Error fetching tanks:', error);
        res.status(500).json({ error: 'Failed to fetch tanks' });
    }
};

export const getTankByCode = async (req: Request, res: Response): Promise<void> => {
    try {
        const { tankCode } = req.params;
        const result = await pool.query('SELECT * FROM tanks WHERE tank_code = $1', [tankCode]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Tank not found' });
            return;
        }
        res.status(200).json({ message: 'Tank retrieved successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error fetching tank:', error);
        res.status(500).json({ error: 'Failed to fetch tank' });
    }
};

export const updateTank = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureTankLifecycleSchema();

        const { tankCode } = req.params;
        const { fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode, submit } = req.body;
        const shouldSubmit = submit === true || submit === 'true';
        const userId = (req as any).user?.id;

        const query = `
            UPDATE tanks 
            SET fuel_type = COALESCE($1, fuel_type),
                vendor = COALESCE($2, vendor),
                tank_capacity = COALESCE($3, tank_capacity),
                tank_size = COALESCE($4, tank_size),
                tank_manufacturer = COALESCE($5, tank_manufacturer),
                tank_warranty_certificate = COALESCE($6, tank_warranty_certificate),
                station_code = COALESCE($7, station_code),
                canopy_code = COALESCE($8, canopy_code),
                is_submitted = $9,
                submitted_at = CASE WHEN $9 THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $9 THEN $10 ELSE submitted_by END,
                last_saved_at = CASE WHEN $9 THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $9 THEN last_saved_by ELSE $10 END,
                updated_by = $10,
                updated_at = CURRENT_TIMESTAMP
            WHERE tank_code = $11
            RETURNING *
        `;

        const values = [fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode, shouldSubmit, userId, tankCode];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Tank not found' });
            return;
        }

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'update',
            entityType: 'tank',
            entityId: result.rows[0].tank_code,
            summary: `${shouldSubmit ? 'submitted' : 'updated'} tank: ${tankCode}`,
            metadata: {
                tankCode,
            },
            sourcePath: `/api/tanks/${tankCode}`,
            requestMethod: 'PUT',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(200).json({ message: 'Tank updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating tank:', error);
        res.status(500).json({ error: 'Failed to update tank' });
    }
};

export const getLatestSavedTank = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureTankLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM tanks
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error) {
        console.error('Error fetching latest saved tank:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved tank' });
    }
};

export const deleteTank = async (req: Request, res: Response): Promise<void> => {
    try {
        const { tankCode } = req.params;
        const result = await pool.query('DELETE FROM tanks WHERE tank_code = $1 RETURNING *', [tankCode]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Tank not found' });
            return;
        }
        res.status(200).json({ message: 'Tank deleted successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error deleting tank:', error);
        res.status(500).json({ error: 'Failed to delete tank' });
    }
};
