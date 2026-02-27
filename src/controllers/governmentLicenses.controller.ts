import { Request, Response } from 'express';
import pool from '../config/database';

// ─── SALAMAH LICENSE ──────────────────────────────────────────────────────────
export const createSalamahLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            licenseNo, issuanceDate, licenseExpiryDate, numberOfDays, licenseStatus,
            investorName, ministryOfInteriorNo, nationalAddress, commercialRegister,
            facilityName, branch, area, city, district, street, landNo, shopSpace,
            stationCode, officeCode
        } = req.body;
        if (!licenseNo || !stationCode) { res.status(400).json({ error: 'License No and station code are required' }); return; }
        const userId = (req as any).user?.id;
        const result = await pool.query(`
            INSERT INTO salamah_licenses (
                license_no, issuance_date, license_expiry_date, number_of_days, license_status,
                investor_name, ministry_of_interior_no, national_address, commercial_register,
                facility_name, branch, area, city, district, street, land_no, shop_space,
                station_code, office_code, created_by, updated_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
            RETURNING *`,
            [licenseNo, issuanceDate || null, licenseExpiryDate || null, numberOfDays || 0, licenseStatus,
                investorName, ministryOfInteriorNo, nationalAddress, commercialRegister,
                facilityName, branch, area, city, district, street, landNo, shopSpace || 0,
                stationCode, officeCode, userId]);
        res.status(201).json({ message: 'Salamah License created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating Salamah license:', error);
        if (error.code === '23505') { res.status(409).json({ error: 'License No already exists' }); return; }
        res.status(500).json({ error: 'Failed to create Salamah license', details: error.message });
    }
};

export const getAllSalamahLicenses = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM salamah_licenses ORDER BY created_at DESC');
        res.status(200).json({ message: 'Salamah Licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch Salamah licenses', details: error.message });
    }
};

export const getSalamahLicensesByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM salamah_licenses WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Salamah Licenses retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch Salamah licenses', details: error.message });
    }
};

export const updateSalamahLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id;
        const fields = Object.entries(req.body).filter(([_, v]) => v !== undefined);
        if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
        const setClause = fields.map(([k, _], i) => `${k.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`)} = $${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE salamah_licenses SET ${setClause}, updated_by = $${fields.length + 1}, updated_at = CURRENT_TIMESTAMP WHERE id = $${fields.length + 2} RETURNING *`,
            [...fields.map(([_, v]) => v), userId, id]);
        if (result.rows.length === 0) { res.status(404).json({ error: 'Salamah License not found' }); return; }
        res.status(200).json({ message: 'Salamah License updated successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update Salamah license', details: error.message });
    }
};

export const deleteSalamahLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('DELETE FROM salamah_licenses WHERE id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) { res.status(404).json({ error: 'Salamah License not found' }); return; }
        res.status(200).json({ message: 'Salamah License deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to delete Salamah license', details: error.message });
    }
};

// ─── TAQYEES LICENSE ─────────────────────────────────────────────────────────
export const createTaqyeesLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const { licenseNo, issuanceDate, licenseExpiryDate, numberOfDays, licenseStatus, stationCode, officeCode } = req.body;
        if (!licenseNo || !stationCode) { res.status(400).json({ error: 'License No and station code are required' }); return; }
        const userId = (req as any).user?.id;
        const result = await pool.query(`
            INSERT INTO taqyees_licenses (license_no, issuance_date, license_expiry_date, number_of_days, license_status, station_code, office_code, created_by, updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
            [licenseNo, issuanceDate || null, licenseExpiryDate || null, numberOfDays || 0, licenseStatus, stationCode, officeCode, userId]);
        res.status(201).json({ message: 'Taqyees License created successfully', data: result.rows[0] });
    } catch (error: any) {
        if (error.code === '23505') { res.status(409).json({ error: 'License No already exists' }); return; }
        res.status(500).json({ error: 'Failed to create Taqyees license', details: error.message });
    }
};

export const getAllTaqyeesLicenses = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM taqyees_licenses ORDER BY created_at DESC');
        res.status(200).json({ message: 'Taqyees Licenses retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch Taqyees licenses', details: error.message });
    }
};

export const getTaqyeesLicensesByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM taqyees_licenses WHERE station_code = $1 ORDER BY created_at DESC', [req.params.stationCode]);
        res.status(200).json({ message: 'Taqyees Licenses retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch Taqyees licenses', details: error.message });
    }
};

export const updateTaqyeesLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id;
        const fields = Object.entries(req.body).filter(([_, v]) => v !== undefined);
        if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
        const setClause = fields.map(([k, _], i) => `${k.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`)} = $${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE taqyees_licenses SET ${setClause}, updated_by = $${fields.length + 1}, updated_at = CURRENT_TIMESTAMP WHERE id = $${fields.length + 2} RETURNING *`,
            [...fields.map(([_, v]) => v), userId, id]);
        if (result.rows.length === 0) { res.status(404).json({ error: 'Taqyees License not found' }); return; }
        res.status(200).json({ message: 'Taqyees License updated successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update Taqyees license', details: error.message });
    }
};

export const deleteTaqyeesLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('DELETE FROM taqyees_licenses WHERE id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) { res.status(404).json({ error: 'Taqyees License not found' }); return; }
        res.status(200).json({ message: 'Taqyees License deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to delete Taqyees license', details: error.message });
    }
};

// ─── ENVIRONMENTAL LICENSE ───────────────────────────────────────────────────
export const createEnvironmentalLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            issuanceNo, issuanceDate, licenseExpiryDate, numberOfDays, licenseStatus,
            facilityName, ownerName, address, facilityNo, geographicLocation,
            commercialRegister, workArea, businessType, orderNumber, orderDate,
            phone, fax, mailBox, boxCode, city, issued, stationCode, officeCode
        } = req.body;
        if (!issuanceNo || !stationCode) { res.status(400).json({ error: 'Issuance No and station code are required' }); return; }
        const userId = (req as any).user?.id;
        const result = await pool.query(`
            INSERT INTO environmental_licenses (
                issuance_no, issuance_date, license_expiry_date, number_of_days, license_status,
                facility_name, owner_name, address, facility_no, geographic_location,
                commercial_register, work_area, business_type, order_number, order_date,
                phone, fax, mail_box, box_code, city, issued, station_code, office_code,
                created_by, updated_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24)
            RETURNING *`,
            [issuanceNo, issuanceDate || null, licenseExpiryDate || null, numberOfDays || 0, licenseStatus,
                facilityName, ownerName, address, facilityNo, geographicLocation,
                commercialRegister, workArea, businessType, orderNumber, orderDate || null,
                phone, fax, mailBox, boxCode, city, issued, stationCode, officeCode, userId]);
        res.status(201).json({ message: 'Environmental License created successfully', data: result.rows[0] });
    } catch (error: any) {
        if (error.code === '23505') { res.status(409).json({ error: 'Issuance No already exists' }); return; }
        res.status(500).json({ error: 'Failed to create Environmental license', details: error.message });
    }
};

export const getAllEnvironmentalLicenses = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM environmental_licenses ORDER BY created_at DESC');
        res.status(200).json({ message: 'Environmental Licenses retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch Environmental licenses', details: error.message });
    }
};

export const getEnvironmentalLicensesByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM environmental_licenses WHERE station_code = $1 ORDER BY created_at DESC', [req.params.stationCode]);
        res.status(200).json({ message: 'Environmental Licenses retrieved', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch Environmental licenses', details: error.message });
    }
};

export const updateEnvironmentalLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id;
        const fields = Object.entries(req.body).filter(([_, v]) => v !== undefined);
        if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
        const setClause = fields.map(([k, _], i) => `${k.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`)} = $${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE environmental_licenses SET ${setClause}, updated_by = $${fields.length + 1}, updated_at = CURRENT_TIMESTAMP WHERE id = $${fields.length + 2} RETURNING *`,
            [...fields.map(([_, v]) => v), userId, id]);
        if (result.rows.length === 0) { res.status(404).json({ error: 'Environmental License not found' }); return; }
        res.status(200).json({ message: 'Environmental License updated successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update Environmental license', details: error.message });
    }
};

export const deleteEnvironmentalLicense = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('DELETE FROM environmental_licenses WHERE id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) { res.status(404).json({ error: 'Environmental License not found' }); return; }
        res.status(200).json({ message: 'Environmental License deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to delete Environmental license', details: error.message });
    }
};

// ─── LICENSE ATTACHMENTS ─────────────────────────────────────────────────────
export const upsertLicenseAttachments = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode, operatingLicenseUrl, petroleumTradeLicenseUrl, civilDefenseCertificateUrl,
            safetyInstallationsCertificateUrl, maintenanceContractUrl, containerContractUrl, municipalLicenseUrl } = req.body;
        if (!stationCode) { res.status(400).json({ error: 'Station code is required' }); return; }
        const userId = (req as any).user?.id;
        const result = await pool.query(`
            INSERT INTO government_license_attachments (
                station_code, operating_license_url, petroleum_trade_license_url,
                civil_defense_certificate_url, safety_installations_certificate_url,
                maintenance_contract_url, container_contract_url, municipal_license_url,
                created_by, updated_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
            ON CONFLICT (station_code) DO UPDATE SET
                operating_license_url = EXCLUDED.operating_license_url,
                petroleum_trade_license_url = EXCLUDED.petroleum_trade_license_url,
                civil_defense_certificate_url = EXCLUDED.civil_defense_certificate_url,
                safety_installations_certificate_url = EXCLUDED.safety_installations_certificate_url,
                maintenance_contract_url = EXCLUDED.maintenance_contract_url,
                container_contract_url = EXCLUDED.container_contract_url,
                municipal_license_url = EXCLUDED.municipal_license_url,
                updated_by = $9,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
            [stationCode, operatingLicenseUrl, petroleumTradeLicenseUrl, civilDefenseCertificateUrl,
                safetyInstallationsCertificateUrl, maintenanceContractUrl, containerContractUrl, municipalLicenseUrl, userId]);
        res.status(200).json({ message: 'License attachments saved successfully', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to save license attachments', details: error.message });
    }
};

export const getLicenseAttachmentsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM government_license_attachments WHERE station_code = $1', [req.params.stationCode]);
        res.status(200).json({ message: 'License attachments retrieved', data: result.rows[0] || null });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch license attachments', details: error.message });
    }
};
