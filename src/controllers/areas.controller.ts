import { Request, Response } from 'express';
import pool from '../config/database';
import { recordActivity } from '../utils/activity';

type CommercialComponentInput = {
    building?: string;
    area?: string | number;
    number?: string | number;
};

let areaLifecycleReady = false;

const ensureAreaLifecycleSchema = async (): Promise<void> => {
    if (areaLifecycleReady) return;

    await pool.query(`ALTER TABLE station_areas ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE station_areas ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE station_areas ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE station_areas ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE station_areas ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE station_areas
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    areaLifecycleReady = true;
};

const normalizeComponents = (components: unknown): CommercialComponentInput[] => {
    if (!Array.isArray(components)) return [];
    return components.filter((component) => component && typeof component === 'object') as CommercialComponentInput[];
};

const replaceAreaComponents = async (client: any, areaId: string, components: CommercialComponentInput[]): Promise<void> => {
    await client.query('DELETE FROM commercial_components WHERE station_area_id = $1', [areaId]);

    for (const component of components) {
        const componentQuery = `
            INSERT INTO commercial_components (station_area_id, building_name, area, component_number)
            VALUES ($1, $2, $3, $4)
        `;
        const componentValues = [
            areaId,
            String(component.building || '').trim() || null,
            component.area === '' || component.area == null ? null : Number(component.area),
            String(component.number || '').trim() || null,
        ];
        await client.query(componentQuery, componentValues);
    }
};

export const createArea = async (req: Request, res: Response): Promise<void> => {
    const client = await pool.connect();
    try {
        await ensureAreaLifecycleSchema();
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
            commercialComponents,
            submit,
        } = req.body;

        const shouldSubmit = submit !== false;
        if (!stationCode) {
            res.status(400).json({ error: 'Station code is required' });
            return;
        }

        const userId = (req as any).user?.id;

        const areaQuery = `
            INSERT INTO station_areas (
                station_code, station_area, construction_area, canopy_area, mosque_area,
                mens_wc_count, women_wc_count, mens_prayer_area, women_prayer_area,
                worker_rooms_count, administration_area, number_of_pumps, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
            RETURNING *
        `;

        const areaValues = [
            stationCode, stationArea || null, constructionArea || null, canopyArea || null, mosqueArea || null,
            mensWcCount || null, womenWcCount || null, mensPrayerArea || null, womenPrayerArea || null,
            workerRoomsCount || null, administrationArea || null, numberOfPumps || null, userId,
        ];

        const areaResult = await client.query(areaQuery, areaValues);
        const areaRow = areaResult.rows[0];
        const areaId = areaRow.id;

        await replaceAreaComponents(client, areaId, normalizeComponents(commercialComponents));

        await client.query(`
            UPDATE station_areas
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE id = $3
        `, [shouldSubmit, userId || null, areaId]);

        const refreshed = await client.query('SELECT * FROM station_areas WHERE id = $1 LIMIT 1', [areaId]);

        await client.query('COMMIT');

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'area',
            entityId: areaId,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} station area`,
            metadata: {
                stationCode: refreshed.rows[0]?.station_code,
            },
            sourcePath: '/api/station-areas',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Area information submitted successfully' : 'Area information saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error creating area:', error);
        res.status(500).json({ error: 'Failed to save area information' });
    } finally {
        client.release();
    }
};

export const updateArea = async (req: Request, res: Response): Promise<void> => {
    const client = await pool.connect();
    try {
        await ensureAreaLifecycleSchema();
        await client.query('BEGIN');

        const { id } = req.params;
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
            commercialComponents,
            submit,
        } = req.body;

        const shouldSubmit = submit === true || submit === 'true';
        const userId = (req as any).user?.id;

        const areaResult = await client.query(`
            UPDATE station_areas
            SET station_code = COALESCE($1, station_code),
                station_area = COALESCE($2, station_area),
                construction_area = COALESCE($3, construction_area),
                canopy_area = COALESCE($4, canopy_area),
                mosque_area = COALESCE($5, mosque_area),
                mens_wc_count = COALESCE($6, mens_wc_count),
                women_wc_count = COALESCE($7, women_wc_count),
                mens_prayer_area = COALESCE($8, mens_prayer_area),
                women_prayer_area = COALESCE($9, women_prayer_area),
                worker_rooms_count = COALESCE($10, worker_rooms_count),
                administration_area = COALESCE($11, administration_area),
                number_of_pumps = COALESCE($12, number_of_pumps),
                is_submitted = $13,
                submitted_at = CASE WHEN $13 THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $13 THEN $14 ELSE submitted_by END,
                last_saved_at = CASE WHEN $13 THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $13 THEN last_saved_by ELSE $14 END,
                updated_by = $14,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $15
            RETURNING *
        `, [
            stationCode || null,
            stationArea || null,
            constructionArea || null,
            canopyArea || null,
            mosqueArea || null,
            mensWcCount || null,
            womenWcCount || null,
            mensPrayerArea || null,
            womenPrayerArea || null,
            workerRoomsCount || null,
            administrationArea || null,
            numberOfPumps || null,
            shouldSubmit,
            userId,
            id,
        ]);

        if (!areaResult.rows.length) {
            await client.query('ROLLBACK');
            res.status(404).json({ error: 'Area record not found' });
            return;
        }

        await replaceAreaComponents(client, id, normalizeComponents(commercialComponents));

        await client.query('COMMIT');
        res.status(200).json({ message: 'Area information updated successfully', data: areaResult.rows[0] });
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error updating area:', error);
        res.status(500).json({ error: 'Failed to update area information' });
    } finally {
        client.release();
    }
};

export const getLatestSavedArea = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureAreaLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const areaResult = await pool.query(`
            SELECT * FROM station_areas
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        const area = areaResult.rows[0];
        if (!area) {
            res.status(200).json({ data: null });
            return;
        }

        const componentsResult = await pool.query(
            'SELECT building_name, area, component_number FROM commercial_components WHERE station_area_id = $1 ORDER BY id ASC',
            [area.id],
        );

        res.status(200).json({
            data: {
                ...area,
                commercial_components: componentsResult.rows,
            },
        });
    } catch (error) {
        console.error('Error fetching latest saved area:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved area' });
    }
};

export const getAllAreas = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;

        const query = userRole === 'super_admin'
            ? `
                SELECT sa.*, 
                COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as commercial_components
                FROM station_areas sa
                LEFT JOIN commercial_components cc ON sa.id = cc.station_area_id
                GROUP BY sa.id
                ORDER BY sa.created_at DESC
            `
            : `
                SELECT sa.*, 
                COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') as commercial_components
                FROM station_areas sa
                LEFT JOIN commercial_components cc ON sa.id = cc.station_area_id
                INNER JOIN station_information si ON si.station_code = sa.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                GROUP BY sa.id
                ORDER BY sa.created_at DESC
            `;

        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
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
