import { Request, Response } from 'express';
import pool from '../config/database';
import { recordActivity } from '../utils/activity';
import { isSchemaCompatibilityError } from '../utils/dbErrors';

let buildingPermitLifecycleReady = false;

const ensureBuildingPermitLifecycleSchema = async (): Promise<void> => {
    if (buildingPermitLifecycleReady) return;

    await pool.query(`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE building_permits
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    buildingPermitLifecycleReady = true;
};

export const createBuildingPermit = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureBuildingPermitLifecycleSchema();

        const {
            permitNumber, licenseDate, expiryDate, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea,
            wallsPerimeter, northBorder, eastBorder, southBorder, westBorder,
            northDimensions, eastDimensions, southDimensions, westernDimensions,
            northThrowback, eastThrowback, southThrowback, westThrowback,
            constructionComponents, numberOfUnits, stationStatusCode,
            stationCode, officeCode, submit
        } = req.body;

        const shouldSubmit = submit !== false;
        const resolvedPermitNumber = String(permitNumber || '').trim() || `PERMIT-DRAFT-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedPermitNumber)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires permit number.' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO building_permits (
                permit_number, license_date, expiry_date, license_type, 
                organization_chart_number, construction_type, urban_area, land_area, 
                walls_perimeter, north_border, east_border, south_border, west_border, 
                north_dimensions, east_dimensions, south_dimensions, western_dimensions, 
                north_throwback, east_throwback, south_throwback, west_throwback, 
                construction_components, number_of_units, station_status_code, 
                station_code, office_code, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $27)
            RETURNING *
        `;

        const values = [
            resolvedPermitNumber, licenseDate || null, expiryDate || null, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea || 0,
            wallsPerimeter || 0, northBorder, eastBorder, southBorder, westBorder,
            northDimensions || 0, eastDimensions || 0, southDimensions || 0, westernDimensions || 0,
            northThrowback || 0, eastThrowback || 0, southThrowback || 0, westThrowback || 0,
            constructionComponents, numberOfUnits || 0, stationStatusCode,
            stationCode, officeCode, userId
        ];
        const result = await pool.query(query, values);

        await pool.query(`
            UPDATE building_permits
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE id = $3
        `, [shouldSubmit, userId || null, result.rows[0].id]);

        const refreshed = await pool.query('SELECT * FROM building_permits WHERE id = $1 LIMIT 1', [result.rows[0].id]);

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'building_permit',
            entityId: result.rows[0].id,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} building permit`,
            metadata: {
                permitType: refreshed.rows[0]?.permit_type,
            },
            sourcePath: '/api/building-permits',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Building permit submitted successfully' : 'Building permit saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating building permit:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Permit Number already exists' });
            return;
        }
        res.status(500).json({
            error: 'Failed to create building permit',
            details: error.message
        });
    }
};

export const getAllBuildingPermits = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin' || userRole === 'ceo'
            ? 'SELECT * FROM building_permits ORDER BY created_at DESC'
            : `
                SELECT b.* FROM building_permits b
                INNER JOIN station_information si ON si.station_code = b.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY b.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' || userRole === 'ceo' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Building Permits retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching building permits:', error);
        res.status(500).json({ error: 'Failed to fetch building permits', details: error.message });
    }
};

export const getBuildingPermitsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM building_permits WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Building Permits retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ message: 'Building Permits retrieved successfully', data: [], count: 0 });
            return;
        }
        console.error('Error fetching building permits:', error);
        res.status(500).json({ error: 'Failed to fetch building permits', details: error.message });
    }
};

export const updateBuildingPermit = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureBuildingPermitLifecycleSchema();

        const { id } = req.params;
        const {
            permitNumber, licenseDate, expiryDate, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea,
            wallsPerimeter, northBorder, eastBorder, southBorder, westBorder,
            northDimensions, eastDimensions, southDimensions, westernDimensions,
            northThrowback, eastThrowback, southThrowback, westThrowback,
            constructionComponents, numberOfUnits, stationStatusCode,
            stationCode, officeCode, submit
        } = req.body;
        const shouldSubmit = submit === true || submit === 'true';
        const userId = (req as any).user?.id;

        const query = `
            UPDATE building_permits 
            SET permit_number = COALESCE($1, permit_number),
                license_date = COALESCE($2, license_date),
                expiry_date = COALESCE($3, expiry_date),
                license_type = COALESCE($4, license_type),
                organization_chart_number = COALESCE($5, organization_chart_number),
                construction_type = COALESCE($6, construction_type),
                urban_area = COALESCE($7, urban_area),
                land_area = COALESCE($8, land_area),
                walls_perimeter = COALESCE($9, walls_perimeter),
                north_border = COALESCE($10, north_border),
                east_border = COALESCE($11, east_border),
                south_border = COALESCE($12, south_border),
                west_border = COALESCE($13, west_border),
                north_dimensions = COALESCE($14, north_dimensions),
                east_dimensions = COALESCE($15, east_dimensions),
                south_dimensions = COALESCE($16, south_dimensions),
                western_dimensions = COALESCE($17, western_dimensions),
                north_throwback = COALESCE($18, north_throwback),
                east_throwback = COALESCE($19, east_throwback),
                south_throwback = COALESCE($20, south_throwback),
                west_throwback = COALESCE($21, west_throwback),
                construction_components = COALESCE($22, construction_components),
                number_of_units = COALESCE($23, number_of_units),
                station_status_code = COALESCE($24, station_status_code),
                station_code = COALESCE($25, station_code),
                office_code = COALESCE($26, office_code),
                is_submitted = $27,
                submitted_at = CASE WHEN $27 THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $27 THEN $28 ELSE submitted_by END,
                last_saved_at = CASE WHEN $27 THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $27 THEN last_saved_by ELSE $28 END,
                updated_by = $28,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $29
            RETURNING *
        `;

        const values = [
            permitNumber, licenseDate, expiryDate, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea,
            wallsPerimeter, northBorder, eastBorder, southBorder, westBorder,
            northDimensions, eastDimensions, southDimensions, westernDimensions,
            northThrowback, eastThrowback, southThrowback, westThrowback,
            constructionComponents, numberOfUnits, stationStatusCode,
            stationCode, officeCode, shouldSubmit, userId, id
        ];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Building Permit not found' });
            return;
        }
        res.status(200).json({ message: 'Building Permit updated successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error updating building permit:', error);
        res.status(500).json({
            error: 'Failed to update building permit',
            details: error.message
        });
    }
};

export const getLatestSavedBuildingPermit = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureBuildingPermitLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM building_permits
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error: any) {
        console.error('Error fetching latest saved building permit:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved building permit', details: error.message });
    }
};

export const deleteBuildingPermit = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM building_permits WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Building Permit not found' });
            return;
        }
        res.status(200).json({ message: 'Building Permit deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error deleting building permit:', error);
        res.status(500).json({
            error: 'Failed to delete building permit',
            details: error.message
        });
    }
};
