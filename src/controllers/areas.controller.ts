import { Request, Response } from 'express';
import pool from '../config/database';

export const createArea = async (req: Request, res: Response): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {
            stationCode,
            stationArea,
            constructionArea,
            canopyArea,
            mosqueArea,
            mensWcCount,
            womenWcCount,
            mensPrayerArea,
            womenPrayerArea,
            workerRoomsCount,
            administrationArea,
            numberOfPumps,
            commercialComponents
        } = req.body;

        if (!stationCode) {
            res.status(400).json({ error: 'Station code is required' });
            return;
        }

        const userId = (req as any).user?.id;

        // Insert into station_areas
        const areaQuery = `
            INSERT INTO station_areas (
                station_code, station_area, construction_area, canopy_area, mosque_area, 
                mens_wc_count, women_wc_count, mens_prayer_area, women_prayer_area, 
                worker_rooms_count, administration_area, number_of_pumps, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
            RETURNING id
        `;

        const areaValues = [
            stationCode, stationArea, constructionArea, canopyArea, mosqueArea,
            mensWcCount, womenWcCount, mensPrayerArea, womenPrayerArea,
            workerRoomsCount, administrationArea, numberOfPumps, userId
        ];

        const areaResult = await client.query(areaQuery, areaValues);
        const areaId = areaResult.rows[0].id;

        // Insert commercial components if any
        if (commercialComponents && Array.isArray(commercialComponents)) {
            for (const component of commercialComponents) {
                const componentQuery = `
                    INSERT INTO commercial_components (station_area_id, building_name, area, component_number)
                    VALUES ($1, $2, $3, $4)
                `;
                const componentValues = [areaId, component.building, component.area, component.number];
                await client.query(componentQuery, componentValues);
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Area information saved successfully', areaId });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error creating area:', error);
        res.status(500).json({ error: 'Failed to save area information' });
    } finally {
        client.release();
    }
};

export const getAllAreas = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query(`
            SELECT sa.*, 
            COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as commercial_components
            FROM station_areas sa
            LEFT JOIN commercial_components cc ON sa.id = cc.station_area_id
            GROUP BY sa.id
            ORDER BY sa.created_at DESC
        `);
        res.status(200).json({ message: 'Areas retrieved successfully', data: result.rows });
    } catch (error) {
        console.error('Error fetching areas:', error);
        res.status(500).json({ error: 'Failed to fetch areas' });
    }
};

export const getAreasByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query(`
            SELECT sa.*, 
            COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as commercial_components
            FROM station_areas sa
            LEFT JOIN commercial_components cc ON sa.id = cc.station_area_id
            WHERE sa.station_code = $1
            GROUP BY sa.id
            ORDER BY sa.created_at DESC
        `, [stationCode]);
        res.status(200).json({ message: 'Areas retrieved successfully', data: result.rows });
    } catch (error) {
        console.error('Error fetching areas:', error);
        res.status(500).json({ error: 'Failed to fetch areas' });
    }
};
