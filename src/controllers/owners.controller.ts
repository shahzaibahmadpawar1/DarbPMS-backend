import { Request, Response } from 'express';
import pool from '../config/database';

const ALLOWED_STATION_TYPES = ['operation', 'rent', 'franchise', 'investment', 'ownership'] as const;

const normalizeStationType = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();
    const aliases: Record<string, string> = {
        frenchise: 'franchise',
        owned: 'ownership',
        ownership: 'ownership',
        owner: 'ownership',
        rented: 'rent'
    };

    return aliases[normalized] || normalized;
};

const isValidStationType = (value: string | null): value is (typeof ALLOWED_STATION_TYPES)[number] => {
    return value !== null && ALLOWED_STATION_TYPES.includes(value as (typeof ALLOWED_STATION_TYPES)[number]);
};

export const createOwner = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            ownerId, ownerName, issueDate, issuePlace, ownerMobile,
            ownerAddress, ownerEmail, stationTypeCode, stationCode
        } = req.body;
        const normalizedStationTypeCode = normalizeStationType(stationTypeCode);

        if (!ownerId || !ownerName || !stationCode) {
            res.status(400).json({ error: 'Owner ID, Owner Name and station code are required' });
            return;
        }

        if (normalizedStationTypeCode !== null && !isValidStationType(normalizedStationTypeCode)) {
            res.status(400).json({
                error: `Invalid station type. Allowed values: ${ALLOWED_STATION_TYPES.join(', ')}`
            });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO owners (
                owner_id, owner_name, issue_date, issue_place, owner_mobile, 
                owner_address, owner_email, station_type_code, station_code, 
                created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
            RETURNING *
        `;

        const values = [
            ownerId, ownerName, issueDate || null, issuePlace, ownerMobile,
            ownerAddress, ownerEmail, normalizedStationTypeCode, stationCode, userId
        ];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Owner information created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating owner:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Owner ID already exists' });
            return;
        }
        res.status(500).json({
            error: 'Failed to create owner information',
            details: error.message
        });
    }
};

export const getAllOwners = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin'
            ? 'SELECT * FROM owners ORDER BY created_at DESC'
            : `
                SELECT o.* FROM owners o
                INNER JOIN station_information si ON si.station_code = o.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY o.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Owners retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching owners:', error);
        res.status(500).json({ error: 'Failed to fetch owners', details: error.message });
    }
};

export const getOwnersByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM owners WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Owners retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching owners:', error);
        res.status(500).json({ error: 'Failed to fetch owners', details: error.message });
    }
};

export const updateOwner = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const {
            ownerId, ownerName, issueDate, issuePlace, ownerMobile,
            ownerAddress, ownerEmail, stationTypeCode, stationCode
        } = req.body;
        const normalizedStationTypeCode = normalizeStationType(stationTypeCode);

        if (normalizedStationTypeCode !== null && !isValidStationType(normalizedStationTypeCode)) {
            res.status(400).json({
                error: `Invalid station type. Allowed values: ${ALLOWED_STATION_TYPES.join(', ')}`
            });
            return;
        }
        const userId = (req as any).user?.id;

        const query = `
            UPDATE owners 
            SET owner_id = COALESCE($1, owner_id),
                owner_name = COALESCE($2, owner_name),
                issue_date = COALESCE($3, issue_date),
                issue_place = COALESCE($4, issue_place),
                owner_mobile = COALESCE($5, owner_mobile),
                owner_address = COALESCE($6, owner_address),
                owner_email = COALESCE($7, owner_email),
                station_type_code = COALESCE($8, station_type_code),
                station_code = COALESCE($9, station_code),
                updated_by = $10,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING *
        `;

        const values = [
            ownerId, ownerName, issueDate, issuePlace, ownerMobile,
            ownerAddress, ownerEmail, normalizedStationTypeCode, stationCode, userId, id
        ];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Owner not found' });
            return;
        }
        res.status(200).json({ message: 'Owner updated successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error updating owner:', error);
        res.status(500).json({
            error: 'Failed to update owner',
            details: error.message
        });
    }
};

export const deleteOwner = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM owners WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Owner not found' });
            return;
        }
        res.status(200).json({ message: 'Owner deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error deleting owner:', error);
        res.status(500).json({
            error: 'Failed to delete owner',
            details: error.message
        });
    }
};
