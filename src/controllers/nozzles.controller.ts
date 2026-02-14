import { Request, Response } from 'express';
import pool from '../config/database';

export const createNozzle = async (req: Request, res: Response): Promise<void> => {
    try {
        const { nozzleSerialNumber, fuelType, vendor, dispenserSerialNumber } = req.body;

        if (!nozzleSerialNumber || !dispenserSerialNumber) {
            res.status(400).json({ error: 'Nozzle serial number and dispenser serial number are required' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO nozzles (nozzle_serial_number, fuel_type, vendor, dispenser_serial_number, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING *
        `;

        const values = [nozzleSerialNumber, fuelType, vendor, dispenserSerialNumber, userId];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Nozzle created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating nozzle:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Nozzle serial number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create nozzle' });
    }
};

export const getAllNozzles = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM nozzles ORDER BY created_at DESC');
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
        const { serialNumber } = req.params;
        const { fuelType, vendor, dispenserSerialNumber } = req.body;
        const userId = (req as any).user?.id;

        const query = `
            UPDATE nozzles 
            SET fuel_type = COALESCE($1, fuel_type),
                vendor = COALESCE($2, vendor),
                dispenser_serial_number = COALESCE($3, dispenser_serial_number),
                updated_by = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE nozzle_serial_number = $5
            RETURNING *
        `;

        const values = [fuelType, vendor, dispenserSerialNumber, userId, serialNumber];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Nozzle not found' });
            return;
        }
        res.status(200).json({ message: 'Nozzle updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating nozzle:', error);
        res.status(500).json({ error: 'Failed to update nozzle' });
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
