import { Request, Response } from 'express';
import pool from '../config/database';

export const createDispenser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { dispenserSerialNumber, dispenserName, model, vendor, numberOfNozzles, status, stationCode, canopyCode } = req.body;

        if (!dispenserSerialNumber || !stationCode) {
            res.status(400).json({ error: 'Dispenser serial number and station code are required' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO dispensers (dispenser_serial_number, dispenser_name, model, vendor, number_of_nozzles, status, station_code, canopy_code, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
            RETURNING *
        `;

        const values = [dispenserSerialNumber, dispenserName, model, vendor, numberOfNozzles, status, stationCode, canopyCode, userId];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Dispenser created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating dispenser:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Dispenser serial number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create dispenser' });
    }
};

export const getAllDispensers = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM dispensers ORDER BY created_at DESC');
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
    } catch (error) {
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
        const { serialNumber } = req.params;
        const { dispenserName, model, vendor, numberOfNozzles, status, stationCode, canopyCode } = req.body;
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
                updated_by = $8,
                updated_at = CURRENT_TIMESTAMP
            WHERE dispenser_serial_number = $9
            RETURNING *
        `;

        const values = [dispenserName, model, vendor, numberOfNozzles, status, stationCode, canopyCode, userId, serialNumber];
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
