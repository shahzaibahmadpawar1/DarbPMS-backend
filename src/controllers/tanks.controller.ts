import { Request, Response } from 'express';
import pool from '../config/database';

export const createTank = async (req: Request, res: Response): Promise<void> => {
    try {
        const { tankCode, fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode } = req.body;

        if (!tankCode || !stationCode) {
            res.status(400).json({ error: 'Tank code and station code are required' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO tanks (tank_code, fuel_type, vendor, tank_capacity, tank_size, tank_manufacturer, tank_warranty_certificate, station_code, canopy_code, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
            RETURNING *
        `;

        const values = [tankCode, fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode, userId];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Tank created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating tank:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Tank code already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create tank' });
    }
};

export const getAllTanks = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM tanks ORDER BY created_at DESC');
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
    } catch (error) {
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
        const { tankCode } = req.params;
        const { fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode } = req.body;
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
                updated_by = $9,
                updated_at = CURRENT_TIMESTAMP
            WHERE tank_code = $10
            RETURNING *
        `;

        const values = [fuelType, vendor, tankCapacity, tankSize, tankManufacturer, tankWarrantyCertificate, stationCode, canopyCode, userId, tankCode];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Tank not found' });
            return;
        }
        res.status(200).json({ message: 'Tank updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating tank:', error);
        res.status(500).json({ error: 'Failed to update tank' });
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
