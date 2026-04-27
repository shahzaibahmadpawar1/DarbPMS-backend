import { Request, Response } from 'express';
import pool from '../config/database';
import { normalizeUserRole } from '../utils/roles';
import { isSchemaCompatibilityError } from '../utils/dbErrors';
import { UserModel } from '../models/user.model';
import { recordActivity } from '../utils/activity';

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

        const normalizedStationTypeCode = normalizeStationType(stationTypeCode);

        // Validate required fields
        if (!stationCode || !stationName) {
            res.status(400).json({
                error: 'Station code and station name are required'
            });
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
            normalizedStationTypeCode,
            stationStatusCode || null,
            userId
        ];

        const result = await pool.query(query, values);

        // Log activity
        void recordActivity({
            actorId: userId,
            action: 'create',
            entityType: 'station',
            entityId: result.rows[0].id,
            summary: `created station: ${stationName} (${stationCode})`,
            metadata: {
                stationCode,
                stationName,
                stationType: normalizedStationTypeCode,
            },
            sourcePath: '/api/stations',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

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
export const getAllStationInformation = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = normalizeUserRole((req as any).user?.role);
        const userDepartment = (req as any).user?.department;
        const userType = String((req as any).user?.user_type || 'internal').toLowerCase();
        const userId = (req as any).user?.id;
        const statusFilter = req.query?.status;
        const typeFilter = req.query?.type;
        const cityFilter = req.query?.city;
        const limitFilter = req.query?.limit;
        const offsetFilter = req.query?.offset;

        const parsedLimit = Number.parseInt(String(limitFilter || ''), 10);
        const parsedOffset = Number.parseInt(String(offsetFilter || ''), 10);
        const usePagination = Number.isFinite(parsedLimit) && parsedLimit > 0;
        const safeLimit = usePagination ? Math.min(parsedLimit, 500) : null;
        const safeOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

        const conditions: string[] = [];
        const params: unknown[] = [];

        // Hide stations while any associated project is not CEO-approved yet.
        // Only show on Stations pages when the linked investment_project is Approved.
        conditions.push(`
            NOT EXISTS (
                SELECT 1
                FROM investment_projects p
                WHERE COALESCE(NULLIF(p.station_code, ''), p.project_code) = station_information.station_code
                  AND COALESCE(p.review_status, '') <> 'Approved'
            )
        `);

        if (userType === 'external' && userId) {
            const assignedCodes = await UserModel.getStationCodesByUserId(userId);
            if (assignedCodes.length === 0) {
                res.status(200).json({
                    message: 'Station information retrieved successfully',
                    data: [],
                    count: 0
                });
                return;
            }

            params.push(assignedCodes);
            conditions.push(`station_code = ANY($${params.length})`);
        }

        if (userRole !== 'super_admin' && userRole !== 'ceo' && userDepartment && String(userDepartment).trim().toLowerCase() !== 'project') {
            params.push(userDepartment);
            conditions.push(`(CASE WHEN lower(station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(station_type_code) END) = $${params.length}`);
        }

        if (statusFilter) {
            params.push(String(statusFilter).trim().toLowerCase());
            conditions.push(`lower(COALESCE(station_status_code, '')) = $${params.length}`);
        }

        if (typeFilter) {
            const normalizedType = normalizeStationType(typeFilter);
            if (normalizedType) {
                params.push(normalizedType);
                conditions.push(`(CASE WHEN lower(station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(station_type_code) END) = $${params.length}`);
            }
        }

        if (cityFilter) {
            params.push(`%${String(cityFilter).trim()}%`);
            conditions.push(`city ILIKE $${params.length}`);
        }

        let query = `
            SELECT * FROM station_information
            ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
            ORDER BY created_at DESC
        `;

        if (usePagination && safeLimit !== null) {
            params.push(safeLimit, safeOffset);
            query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }

        const result = await pool.query(query, params);

        res.status(200).json({
            message: 'Station information retrieved successfully',
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({
                message: 'Station information retrieved successfully',
                data: [],
                count: 0
            });
            return;
        }
        console.error('Error fetching station information:', error);
        res.status(500).json({
            error: 'Failed to fetch station information'
        });
    }
};

// Get station information by code
export const getStationInformationByCode = async (req: Request, res: Response): Promise<void> => {
    const { stationCode } = req.params;

    try {
        const query = `
            SELECT * FROM station_information 
            WHERE (id::text = $1 OR station_code = $1)
              AND NOT EXISTS (
                SELECT 1
                FROM investment_projects p
                WHERE COALESCE(NULLIF(p.station_code, ''), p.project_code) = station_information.station_code
                  AND COALESCE(p.review_status, '') <> 'Approved'
              )
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
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(404).json({ error: 'Station not found', identifier: stationCode });
            return;
        }
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

        const normalizedStationTypeCode = normalizeStationType(stationTypeCode);

        if (normalizedStationTypeCode !== null && !isValidStationType(normalizedStationTypeCode)) {
            res.status(400).json({
                error: `Invalid station type. Allowed values: ${ALLOWED_STATION_TYPES.join(', ')}`
            });
            return;
        }

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
            normalizedStationTypeCode,
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
        console.log(`Bulk import: Received ${stations?.length} stations`);

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

                const normalizedStationTypeCode = normalizeStationType(stationTypeCode);

                if (!stationCode || !stationName) {
                    console.warn('Bulk import: Missing required fields for row:', station);
                    errors.push({
                        stationCode: stationCode || 'Unknown',
                        error: 'Station code and name are required',
                        receivedData: station
                    });
                    continue;
                }

                if (normalizedStationTypeCode !== null && !isValidStationType(normalizedStationTypeCode)) {
                    errors.push({
                        stationCode,
                        error: `Invalid station type '${stationTypeCode}'. Allowed values: ${ALLOWED_STATION_TYPES.join(', ')}`
                    });
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
                    normalizedStationTypeCode,
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
