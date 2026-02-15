import { Request, Response } from 'express';
import pool from '../config/database';

export const createBuildingPermit = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            permitNumber, licenseDate, expiryDate, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea,
            wallsPerimeter, northBorder, eastBorder, southBorder, westBorder,
            northDimensions, eastDimensions, southDimensions, westernDimensions,
            northThrowback, eastThrowback, southThrowback, westThrowback,
            constructionComponents, numberOfUnits, stationStatusCode,
            stationCode, officeCode
        } = req.body;

        if (!permitNumber || !stationCode) {
            res.status(400).json({ error: 'Permit Number and station code are required' });
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
            permitNumber, licenseDate || null, expiryDate || null, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea || 0,
            wallsPerimeter || 0, northBorder, eastBorder, southBorder, westBorder,
            northDimensions || 0, eastDimensions || 0, southDimensions || 0, westernDimensions || 0,
            northThrowback || 0, eastThrowback || 0, southThrowback || 0, westThrowback || 0,
            constructionComponents, numberOfUnits || 0, stationStatusCode,
            stationCode, officeCode, userId
        ];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Building Permit created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating building permit:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Permit Number already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create building permit' });
    }
};

export const getAllBuildingPermits = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM building_permits ORDER BY created_at DESC');
        res.status(200).json({ message: 'Building Permits retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching building permits:', error);
        res.status(500).json({ error: 'Failed to fetch building permits' });
    }
};

export const getBuildingPermitsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM building_permits WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Building Permits retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching building permits:', error);
        res.status(500).json({ error: 'Failed to fetch building permits' });
    }
};

export const updateBuildingPermit = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const {
            permitNumber, licenseDate, expiryDate, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea,
            wallsPerimeter, northBorder, eastBorder, southBorder, westBorder,
            northDimensions, eastDimensions, southDimensions, westernDimensions,
            northThrowback, eastThrowback, southThrowback, westThrowback,
            constructionComponents, numberOfUnits, stationStatusCode,
            stationCode, officeCode
        } = req.body;
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
                updated_by = $27,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $28
            RETURNING *
        `;

        const values = [
            permitNumber, licenseDate, expiryDate, licenseType,
            organizationChartNumber, constructionType, urbanArea, landArea,
            wallsPerimeter, northBorder, eastBorder, southBorder, westBorder,
            northDimensions, eastDimensions, southDimensions, westernDimensions,
            northThrowback, eastThrowback, southThrowback, westThrowback,
            constructionComponents, numberOfUnits, stationStatusCode,
            stationCode, officeCode, userId, id
        ];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Building Permit not found' });
            return;
        }
        res.status(200).json({ message: 'Building Permit updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating building permit:', error);
        res.status(500).json({ error: 'Failed to update building permit' });
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
    } catch (error) {
        console.error('Error deleting building permit:', error);
        res.status(500).json({ error: 'Failed to delete building permit' });
    }
};
