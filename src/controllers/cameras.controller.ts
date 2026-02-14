import { Request, Response } from 'express';
import pool from '../config/database';

export const createCamera = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serialNumber, cameraType, model, size, location, status, stationCode } = req.body;

        if (!serialNumber || !stationCode) {
            res.status(400).json({ error: 'Serial number and station code are required' });
            return;
        }

        const userId = (req as any).user?.id;

        const query = `
            INSERT INTO cameras (serial_number, camera_type, model, size, location, status, station_code, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
            RETURNING *
        `;

        const values = [serialNumber, cameraType, model, size, location, status, stationCode, userId];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Camera created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating camera:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Camera serial number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create camera' });
    }
};

export const getAllCameras = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM cameras ORDER BY created_at DESC');
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
        const { serialNumber } = req.params;
        const { cameraType, model, size, location, status, stationCode } = req.body;
        const userId = (req as any).user?.id;

        const query = `
            UPDATE cameras 
            SET camera_type = COALESCE($1, camera_type),
                model = COALESCE($2, model),
                size = COALESCE($3, size),
                location = COALESCE($4, location),
                status = COALESCE($5, status),
                station_code = COALESCE($6, station_code),
                updated_by = $7,
                updated_at = CURRENT_TIMESTAMP
            WHERE serial_number = $8
            RETURNING *
        `;

        const values = [cameraType, model, size, location, status, stationCode, userId, serialNumber];
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
