import { Request, Response } from 'express';
import pool from '../config/database';

// Create new station information
export const createStationInformation = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            stationCode,
            stationName,
            areaRegion,
            city,
            district,
            street,
            geographicLocation,
            stationTypeCode,
            stationStatusCode
        } = req.body;

        // Validate required fields
        if (!stationCode || !stationName) {
            res.status(400).json({
                error: 'Station code and station name are required'
            });
            return;
        }

        const userId = (req as any).user?.id;

        const query = `
            INSERT INTO station_information (
                station_code, station_name, area_region, city, district, 
                street, geographic_location, station_type_code, station_status_code,
                created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
            RETURNING *
        `;

        const values = [
            stationCode,
            stationName,
            areaRegion || null,
            city || null,
            district || null,
            street || null,
            geographicLocation || null,
            stationTypeCode || null,
            stationStatusCode || null,
            userId
        ];

        const result = await pool.query(query, values);

        res.status(201).json({
            message: 'Station information created successfully',
            data: result.rows[0]
        });
    } catch (error: any) {
        console.error('Error creating station information:', error);

        if (error.code === '23505') { // Unique violation
            res.status(409).json({
                error: 'Station code already exists'
            });
            return;
        }

        res.status(500).json({
            error: 'Failed to create station information'
        });
    }
};

// Get all station information
export const getAllStationInformation = async (_req: Request, res: Response): Promise<void> => {
    try {
        const query = `
            SELECT * FROM station_information 
            ORDER BY created_at DESC
        `;

        const result = await pool.query(query);

        res.status(200).json({
            message: 'Station information retrieved successfully',
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('Error fetching station information:', error);
        res.status(500).json({
            error: 'Failed to fetch station information'
        });
    }
};

// Get station information by code
export const getStationInformationByCode = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;

        const query = `
            SELECT * FROM station_information 
            WHERE id::text = $1 OR station_code = $1
        `;

        const result = await pool.query(query, [stationCode]);

        if (result.rows.length === 0) {
            res.status(404).json({
                error: 'Station not found',
                identifier: stationCode
            });
            return;
        }

        res.status(200).json({
            message: 'Station information retrieved successfully',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching station information:', error);
        res.status(500).json({
            error: 'Failed to fetch station information'
        });
    }
};

// Update station information
export const updateStationInformation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const {
            stationName,
            areaRegion,
            city,
            district,
            street,
            geographicLocation,
            stationTypeCode,
            stationStatusCode
        } = req.body;

        const userId = (req as any).user?.id;

        const query = `
            UPDATE station_information 
            SET 
                station_name = COALESCE($1, station_name),
                area_region = COALESCE($2, area_region),
                city = COALESCE($3, city),
                district = COALESCE($4, district),
                street = COALESCE($5, street),
                geographic_location = COALESCE($6, geographic_location),
                station_type_code = COALESCE($7, station_type_code),
                station_status_code = COALESCE($8, station_status_code),
                updated_by = $9,
                updated_at = CURRENT_TIMESTAMP
            WHERE id::text = $10 OR station_code = $10
            RETURNING *
        `;

        const values = [
            stationName,
            areaRegion,
            city,
            district,
            street,
            geographicLocation,
            stationTypeCode,
            stationStatusCode,
            userId,
            stationCode
        ];

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({
                error: 'Station not found'
            });
            return;
        }

        res.status(200).json({
            message: 'Station information updated successfully',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating station information:', error);
        res.status(500).json({
            error: 'Failed to update station information'
        });
    }
};

// Delete station information
export const deleteStationInformation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;

        const query = `
            DELETE FROM station_information 
            WHERE id::text = $1 OR station_code = $1
            RETURNING *
        `;

        const result = await pool.query(query, [stationCode]);

        if (result.rows.length === 0) {
            res.status(404).json({
                error: 'Station not found'
            });
            return;
        }

        res.status(200).json({
            message: 'Station information deleted successfully',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error deleting station information:', error);
        res.status(500).json({
            error: 'Failed to delete station information'
        });
    }
};

// Bulk create station information
export const bulkCreateStationInformation = async (req: Request, res: Response): Promise<void> => {
    const client = await pool.connect();
    try {
        const stations = req.body;
        if (!Array.isArray(stations)) {
            res.status(400).json({ error: 'Expected an array of stations' });
            return;
        }

        const userId = (req as any).user?.id;
        const results = [];
        const errors = [];

        await client.query('BEGIN');

        for (const station of stations) {
            try {
                const {
                    stationCode,
                    stationName,
                    areaRegion,
                    city,
                    district,
                    street,
                    geographicLocation,
                    stationTypeCode,
                    stationStatusCode
                } = station;

                if (!stationCode || !stationName) {
                    errors.push({ stationCode, error: 'Station code and name are required' });
                    continue;
                }

                const query = `
                    INSERT INTO station_information (
                        station_code, station_name, area_region, city, district, 
                        street, geographic_location, station_type_code, station_status_code,
                        created_by, updated_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
                    ON CONFLICT (station_code) DO UPDATE SET
                        station_name = EXCLUDED.station_name,
                        area_region = EXCLUDED.area_region,
                        city = EXCLUDED.city,
                        district = EXCLUDED.district,
                        street = EXCLUDED.street,
                        geographic_location = EXCLUDED.geographic_location,
                        station_type_code = EXCLUDED.station_type_code,
                        station_status_code = EXCLUDED.station_status_code,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `;

                const values = [
                    stationCode,
                    stationName,
                    areaRegion || null,
                    city || null,
                    district || null,
                    street || null,
                    geographicLocation || null,
                    stationTypeCode || null,
                    stationStatusCode || null,
                    userId
                ];

                const result = await client.query(query, values);
                results.push(result.rows[0]);
            } catch (err: any) {
                errors.push({ stationCode: station.stationCode, error: err.message });
            }
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: `Processed ${stations.length} stations`,
            successCount: results.length,
            errorCount: errors.length,
            data: results,
            errors
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in bulk create:', error);
        res.status(500).json({ error: 'Internal server error during bulk import' });
    } finally {
        client.release();
    }
};
