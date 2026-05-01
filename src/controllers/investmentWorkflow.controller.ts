import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest, Department } from '../types';
import { ensureInvestmentOpportunitiesSchema, COMMITTEE_DEPARTMENTS, type CommitteeDepartment } from '../utils/investmentOpportunities';

const normalizeDepartment = (value: unknown): Department | null => {
    const raw = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!raw) return null;
    return raw as Department;
};

const requireInvestmentOrSuperAdmin = (req: AuthRequest): boolean => {
    const role = req.user?.role;
    const dept = req.user?.department;
    return role === 'super_admin' || role === 'ceo' || dept === 'investment';
};

/** Investment or Franchise department, or executives (for opportunities / shared workflow). */
const requireInvestmentFranchiseOrExec = (req: AuthRequest): boolean => {
    const role = req.user?.role;
    const dept = req.user?.department;
    return role === 'super_admin' || role === 'ceo' || dept === 'investment' || dept === 'franchise';
};

const requireCommitteeDmOrSuperAdmin = (req: AuthRequest): boolean => {
    const role = req.user?.role;
    const dept = req.user?.department;
    if (role === 'super_admin' || role === 'ceo') return true;
    return role === 'department_manager' && COMMITTEE_DEPARTMENTS.includes(dept as any);
};

const normalizeCommitteeDepartment = (value: unknown): CommitteeDepartment | null => {
    const raw = String(value ?? '').trim().toLowerCase();
    return COMMITTEE_DEPARTMENTS.includes(raw as any) ? (raw as CommitteeDepartment) : null;
};

const requireSuperAdminOnly = (req: AuthRequest): boolean => {
    const role = req.user?.role;
    return role === 'super_admin';
};

export class InvestmentWorkflowController {
    // -------------------- Location settings (Regions/Cities) --------------------
    static async listRegions(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();
            const result = await pool.query(
                `SELECT id, name FROM investment_location_regions ORDER BY name ASC`,
            );
            res.status(200).json({ data: result.rows });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to list regions', details: error.message });
        }
    }

    static async createRegion(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            if (!requireSuperAdminOnly(req)) {
                res.status(403).json({ error: 'Only Super Admin can manage regions' });
                return;
            }
            const name = String(req.body?.name || '').trim();
            if (!name) {
                res.status(400).json({ error: 'name is required' });
                return;
            }
            const inserted = await pool.query(
                `
                    INSERT INTO investment_location_regions (name, created_by)
                    VALUES ($1, $2)
                    ON CONFLICT (name) DO NOTHING
                    RETURNING id, name
                `,
                [name, userId],
            );
            if (!inserted.rows.length) {
                const existing = await pool.query(`SELECT id, name FROM investment_location_regions WHERE name = $1 LIMIT 1`, [name]);
                res.status(200).json({ data: existing.rows[0] });
                return;
            }
            res.status(201).json({ data: inserted.rows[0] });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to create region', details: error.message });
        }
    }

    static async deleteRegion(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            if (!requireSuperAdminOnly(req)) {
                res.status(403).json({ error: 'Only Super Admin can manage regions' });
                return;
            }
            const id = String(req.params?.id || '').trim();
            if (!id) {
                res.status(400).json({ error: 'id is required' });
                return;
            }
            await pool.query(`DELETE FROM investment_location_regions WHERE id = $1`, [id]);
            res.status(200).json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to delete region', details: error.message });
        }
    }

    static async listCities(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();
            const regionId = String(req.query?.regionId || '').trim();
            if (!regionId) {
                res.status(400).json({ error: 'regionId is required' });
                return;
            }
            const result = await pool.query(
                `SELECT id, name, region_id FROM investment_location_cities WHERE region_id = $1 ORDER BY name ASC`,
                [regionId],
            );
            res.status(200).json({ data: result.rows });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to list cities', details: error.message });
        }
    }

    static async createCity(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            if (!requireSuperAdminOnly(req)) {
                res.status(403).json({ error: 'Only Super Admin can manage cities' });
                return;
            }
            const regionId = String(req.body?.regionId || '').trim();
            const name = String(req.body?.name || '').trim();
            if (!regionId || !name) {
                res.status(400).json({ error: 'regionId and name are required' });
                return;
            }
            const inserted = await pool.query(
                `
                    INSERT INTO investment_location_cities (region_id, name, created_by)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (region_id, name) DO NOTHING
                    RETURNING id, name, region_id
                `,
                [regionId, name, userId],
            );
            if (!inserted.rows.length) {
                const existing = await pool.query(
                    `SELECT id, name, region_id FROM investment_location_cities WHERE region_id = $1 AND name = $2 LIMIT 1`,
                    [regionId, name],
                );
                res.status(200).json({ data: existing.rows[0] });
                return;
            }
            res.status(201).json({ data: inserted.rows[0] });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to create city', details: error.message });
        }
    }

    static async deleteCity(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            if (!requireSuperAdminOnly(req)) {
                res.status(403).json({ error: 'Only Super Admin can manage cities' });
                return;
            }
            const id = String(req.params?.id || '').trim();
            if (!id) {
                res.status(400).json({ error: 'id is required' });
                return;
            }
            await pool.query(`DELETE FROM investment_location_cities WHERE id = $1`, [id]);
            res.status(200).json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to delete city', details: error.message });
        }
    }

    // -------------------- Clients --------------------
    static async listClients(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const search = String(req.query?.search || '').trim();
            const params: any[] = [];
            let sql = `
                SELECT id, name, id_cr_number, client_type, phone, email
                FROM investment_clients
            `;

            if (search) {
                params.push(`%${search.toLowerCase()}%`);
                sql += ` WHERE lower(name) LIKE $1 OR lower(id_cr_number) LIKE $1 `;
            }

            sql += ` ORDER BY created_at DESC LIMIT 200`;

            const result = await pool.query(sql, params);
            res.status(200).json({ data: result.rows });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to list clients', details: error.message });
        }
    }

    static async createClient(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!requireInvestmentFranchiseOrExec(req)) {
                res.status(403).json({ error: 'Only Investment or Franchise department can create clients' });
                return;
            }

            const name = String(req.body?.name || '').trim();
            const idCrNumber = String(req.body?.idCrNumber || '').trim();
            const clientType = String(req.body?.clientType || '').trim().toLowerCase();

            if (!name || !idCrNumber || !clientType) {
                res.status(400).json({ error: 'name, idCrNumber, clientType are required' });
                return;
            }

            if (!['individual', 'establishment', 'company'].includes(clientType)) {
                res.status(400).json({ error: 'clientType must be individual, establishment, or company' });
                return;
            }

            const payload = {
                phone: String(req.body?.phone || '').trim() || null,
                contactPersonName: String(req.body?.contactPersonName || '').trim() || null,
                contactPersonMobile: String(req.body?.contactPersonMobile || '').trim() || null,
                email: String(req.body?.email || '').trim() || null,
                address: String(req.body?.address || '').trim() || null,
                note: String(req.body?.note || '').trim() || null,
            };

            const result = await pool.query(
                `
                    INSERT INTO investment_clients (
                        name, id_cr_number, client_type,
                        phone, contact_person_name, contact_person_mobile,
                        email, address, note,
                        created_by, updated_by
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10
                    )
                    RETURNING *
                `,
                [
                    name,
                    idCrNumber,
                    clientType,
                    payload.phone,
                    payload.contactPersonName,
                    payload.contactPersonMobile,
                    payload.email,
                    payload.address,
                    payload.note,
                    userId,
                ],
            );

            res.status(201).json({ data: result.rows[0] });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to create client', details: error.message });
        }
    }

    // -------------------- Opportunities --------------------
    static async listOpportunities(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const role = req.user?.role;
            const baseParams: any[] = [];
            let where = '';
            if (!(role === 'super_admin' || role === 'ceo' || req.user?.department === 'investment')) {
                // Specialists: only see those assigned to them
                where = `WHERE o.investment_specialist_user_id = $1`;
                baseParams.push(userId);
            }

            const result = await pool.query(
                `
                    SELECT
                        o.*,
                        c.name AS client_name,
                        c.id_cr_number AS client_id_cr_number,
                        c.client_type AS client_type,
                        su.username AS specialist_username,
                        COALESCE(NULLIF(TRIM(su.full_name), ''), su.username) AS specialist_display_name,
                        su.email AS specialist_email,
                        cb.username AS created_by_username,
                        cb.email AS created_by_email,
                        (
                            SELECT COUNT(*)::int
                            FROM investment_feasibility_studies s
                            WHERE s.opportunity_id = o.id
                        ) AS studies_count,
                        (
                            SELECT COUNT(*)::int
                            FROM investment_feasibility_studies s2
                            WHERE s2.opportunity_id = o.id AND s2.status = 'submitted_to_committee'
                        ) AS submitted_studies_count
                    FROM investment_opportunities o
                    JOIN investment_clients c ON c.id = o.client_id
                    LEFT JOIN users su ON su.id = o.investment_specialist_user_id
                    LEFT JOIN users cb ON cb.id = o.created_by
                    ${where}
                    ORDER BY o.created_at DESC
                    LIMIT 500
                `,
                baseParams,
            );
            res.status(200).json({ data: result.rows });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to list opportunities', details: error.message });
        }
    }

    static async getOpportunity(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const id = String(req.params?.id || '').trim();
            if (!id) {
                res.status(400).json({ error: 'id is required' });
                return;
            }

            const opp = await pool.query(
                `
                    SELECT
                        o.*,
                        c.name AS client_name,
                        c.id_cr_number AS client_id_cr_number,
                        c.client_type AS client_type,
                        c.phone AS client_phone,
                        c.contact_person_name AS client_contact_person_name,
                        c.contact_person_mobile AS client_contact_person_mobile,
                        c.email AS client_email,
                        c.address AS client_address,
                        c.note AS client_note,
                        su.username AS specialist_username,
                        COALESCE(NULLIF(TRIM(su.full_name), ''), su.username) AS specialist_display_name,
                        su.email AS specialist_email,
                        cb.username AS created_by_username,
                        cb.email AS created_by_email
                    FROM investment_opportunities o
                    JOIN investment_clients c ON c.id = o.client_id
                    LEFT JOIN users su ON su.id = o.investment_specialist_user_id
                    LEFT JOIN users cb ON cb.id = o.created_by
                    WHERE o.id = $1
                    LIMIT 1
                `,
                [id],
            );

            if (!opp.rows.length) {
                res.status(404).json({ error: 'Opportunity not found' });
                return;
            }

            const opportunity = opp.rows[0];

            // Access: investment dept + executive + assigned specialist
            const role = req.user?.role;
            const allowed = role === 'super_admin'
                || role === 'ceo'
                || req.user?.department === 'investment'
                || String(opportunity.investment_specialist_user_id || '') === userId;
            if (!allowed) {
                res.status(403).json({ error: 'Not allowed' });
                return;
            }

            const attachments = await pool.query(
                `
                    SELECT *
                    FROM investment_opportunity_attachments
                    WHERE opportunity_id = $1
                    ORDER BY created_at ASC
                `,
                [id],
            );

            const studies = await pool.query(
                `
                    SELECT *
                    FROM investment_feasibility_studies
                    WHERE opportunity_id = $1
                    ORDER BY created_at DESC
                `,
                [id],
            );

            res.status(200).json({
                data: {
                    opportunity,
                    attachments: attachments.rows,
                    studies: studies.rows,
                },
            });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch opportunity', details: error.message });
        }
    }

    static async createOpportunity(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!requireInvestmentFranchiseOrExec(req)) {
                res.status(403).json({ error: 'Only Investment or Franchise department can create opportunities' });
                return;
            }

            const opportunityDate = String(req.body?.opportunityDate || '').trim();
            const opportunityType = String(req.body?.opportunityType || '').trim().toLowerCase();
            const clientId = String(req.body?.clientId || '').trim();

            if (!opportunityDate || !opportunityType || !clientId) {
                res.status(400).json({ error: 'opportunityDate, opportunityType, clientId are required' });
                return;
            }

            if (!['rent', 'operation', 'investment', 'ownership'].includes(opportunityType)) {
                res.status(400).json({ error: 'opportunityType invalid' });
                return;
            }

            const specialistUserId = String(req.body?.investmentSpecialistUserId || '').trim() || null;
            if (!specialistUserId) {
                res.status(400).json({ error: 'investmentSpecialistUserId is required' });
                return;
            }
            const streetType = String(req.body?.streetType || '').trim().toLowerCase() || null;
            const locationStatus = String(req.body?.locationStatus || '').trim().toLowerCase() || null;

            const inserted = await pool.query(
                `
                    INSERT INTO investment_opportunities (
                        opportunity_date, opportunity_type, client_id,
                        region, city, district, street, street_type,
                        station_name_if_exists, location_status,
                        area_m2, frontage_m, depth_m,
                        location_url, issued_licenses, pending_licenses,
                        investment_specialist_user_id,
                        notes, status,
                        created_by, updated_by
                    ) VALUES (
                        $1,$2,$3,
                        $4,$5,$6,$7,$8,
                        $9,$10,
                        $11,$12,$13,
                        $14,$15,$16,
                        $17,
                        $18,$19,
                        $20,$20
                    )
                    RETURNING *
                `,
                [
                    opportunityDate,
                    opportunityType,
                    clientId,
                    String(req.body?.region || '').trim() || null,
                    String(req.body?.city || '').trim() || null,
                    String(req.body?.district || '').trim() || null,
                    String(req.body?.street || '').trim() || null,
                    streetType,
                    String(req.body?.stationNameIfExists || '').trim() || null,
                    locationStatus,
                    req.body?.areaM2 ?? null,
                    req.body?.frontageM ?? null,
                    req.body?.depthM ?? null,
                    String(req.body?.locationUrl || '').trim() || null,
                    String(req.body?.issuedLicenses || '').trim() || null,
                    String(req.body?.pendingLicenses || '').trim() || null,
                    specialistUserId,
                    String(req.body?.notes || '').trim() || null,
                    'forwarded_to_specialist',
                    userId,
                ],
            );

            const opportunityId = inserted.rows[0].id as string;
            const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
            for (const att of attachments) {
                const kind = String(att?.kind || '').trim();
                const fileUrl = String(att?.fileUrl || '').trim();
                const fileName = String(att?.fileName || '').trim() || null;
                if (!kind || !fileUrl) continue;
                await pool.query(
                    `
                        INSERT INTO investment_opportunity_attachments (opportunity_id, kind, file_name, file_url, created_by)
                        VALUES ($1,$2,$3,$4,$5)
                    `,
                    [opportunityId, kind, fileName, fileUrl, userId],
                );
            }

            res.status(201).json({ data: { opportunity: inserted.rows[0] } });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to create opportunity', details: error.message });
        }
    }

    // -------------------- Studies --------------------
    static async listStudies(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const role = req.user?.role;
            const dept = req.user?.department;
            const baseParams: any[] = [];
            let where = '';
            if (!(role === 'super_admin' || role === 'ceo' || dept === 'investment')) {
                where = 'WHERE o.investment_specialist_user_id = $1';
                baseParams.push(userId);
            }

            const result = await pool.query(
                `
                    SELECT
                        s.*,
                        o.opportunity_type,
                        o.opportunity_date,
                        c.name AS client_name,
                        o.city,
                        o.region,
                        (
                            SELECT fa.file_url
                            FROM investment_feasibility_attachments fa
                            WHERE fa.study_id = s.id
                            ORDER BY fa.created_at ASC
                            LIMIT 1
                        ) AS first_attachment_url,
                        (
                            SELECT fa.file_name
                            FROM investment_feasibility_attachments fa
                            WHERE fa.study_id = s.id
                            ORDER BY fa.created_at ASC
                            LIMIT 1
                        ) AS first_attachment_name
                    FROM investment_feasibility_studies s
                    JOIN investment_opportunities o ON o.id = s.opportunity_id
                    JOIN investment_clients c ON c.id = o.client_id
                    ${where}
                    ORDER BY s.created_at DESC
                    LIMIT 500
                `,
                baseParams,
            );
            res.status(200).json({ data: result.rows });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to list studies', details: error.message });
        }
    }

    static async createOrUpdateStudy(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const id = String(req.body?.id || '').trim() || null;
            const opportunityId = String(req.body?.opportunityId || '').trim();
            if (!opportunityId) {
                res.status(400).json({ error: 'opportunityId is required' });
                return;
            }

            const opp = await pool.query(
                `SELECT investment_specialist_user_id FROM investment_opportunities WHERE id = $1 LIMIT 1`,
                [opportunityId],
            );
            if (!opp.rows.length) {
                res.status(404).json({ error: 'Opportunity not found' });
                return;
            }
            const specialistId = String(opp.rows[0]?.investment_specialist_user_id || '');
            const role = req.user?.role;
            const exec = role === 'super_admin' || role === 'ceo';
            const assigneeMatch = Boolean(specialistId && specialistId === String(userId));
            if (!exec && !assigneeMatch) {
                res.status(403).json({ error: 'Only the assigned investment specialist or an executive can save this study' });
                return;
            }

            const studyStatus = String(req.body?.studyStatus || 'Initial').trim() || 'Initial';
            const expectedPropertyIncome = req.body?.expectedPropertyIncome ?? {};
            const productSales = req.body?.productSales ?? {};
            const expenses = req.body?.expenses ?? {};
            const finalResult = req.body?.finalResult ?? {};
            const initialAgreementNotes = String(req.body?.initialAgreementNotes || '').trim() || null;

            const upsert = await pool.query(
                `
                    INSERT INTO investment_feasibility_studies (
                        id, opportunity_id,
                        study_status,
                        expected_property_income, product_sales, expenses, final_result,
                        initial_agreement_notes,
                        status,
                        created_by, updated_by
                    ) VALUES (
                        COALESCE($1, uuid_generate_v4()),
                        $2,
                        $3,
                        $4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,
                        $8,
                        'draft',
                        $9,$9
                    )
                    ON CONFLICT (id)
                    DO UPDATE SET
                        opportunity_id = EXCLUDED.opportunity_id,
                        study_status = EXCLUDED.study_status,
                        expected_property_income = EXCLUDED.expected_property_income,
                        product_sales = EXCLUDED.product_sales,
                        expenses = EXCLUDED.expenses,
                        final_result = EXCLUDED.final_result,
                        initial_agreement_notes = EXCLUDED.initial_agreement_notes,
                        updated_by = $9,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `,
                [
                    id,
                    opportunityId,
                    studyStatus,
                    JSON.stringify(expectedPropertyIncome),
                    JSON.stringify(productSales),
                    JSON.stringify(expenses),
                    JSON.stringify(finalResult),
                    initialAgreementNotes,
                    userId,
                ],
            );

            const studyId = upsert.rows[0].id as string;

            const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
            if (attachments.length) {
                // Append-only for now; frontend can show history.
                for (const att of attachments) {
                    const fileUrl = String(att?.fileUrl || '').trim();
                    const fileName = String(att?.fileName || '').trim() || null;
                    if (!fileUrl) continue;
                    await pool.query(
                        `
                            INSERT INTO investment_feasibility_attachments (study_id, file_name, file_url, created_by)
                            VALUES ($1,$2,$3,$4)
                        `,
                        [studyId, fileName, fileUrl, userId],
                    );
                }
            }

            res.status(201).json({ data: upsert.rows[0] });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to save study', details: error.message });
        }
    }

    static async submitStudyToCommittee(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const id = String(req.params?.id || '').trim();
            if (!id) {
                res.status(400).json({ error: 'id is required' });
                return;
            }

            const lookup = await pool.query(
                `
                    SELECT s.opportunity_id, o.investment_specialist_user_id
                    FROM investment_feasibility_studies s
                    JOIN investment_opportunities o ON o.id = s.opportunity_id
                    WHERE s.id = $1
                    LIMIT 1
                `,
                [id],
            );
            if (!lookup.rows.length) {
                res.status(404).json({ error: 'Study not found' });
                return;
            }
            const specialistId = String(lookup.rows[0]?.investment_specialist_user_id || '');
            const role = req.user?.role;
            const exec = role === 'super_admin' || role === 'ceo';
            const assigneeMatch = Boolean(specialistId && specialistId === String(userId));
            if (!exec && !assigneeMatch) {
                res.status(403).json({ error: 'Only the assigned investment specialist or an executive can submit this study' });
                return;
            }

            const updated = await pool.query(
                `
                    UPDATE investment_feasibility_studies
                    SET status = 'submitted_to_committee',
                        updated_by = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                    RETURNING *
                `,
                [userId, id],
            );

            if (!updated.rows.length) {
                res.status(404).json({ error: 'Study not found' });
                return;
            }

            res.status(200).json({ data: updated.rows[0] });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to submit study', details: error.message });
        }
    }

    static async getStudyDetails(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const id = String(req.params?.id || '').trim();
            if (!id) {
                res.status(400).json({ error: 'id is required' });
                return;
            }

            const studyRes = await pool.query(
                `
                    SELECT s.*,
                           o.*,
                           c.name AS client_name,
                           c.id_cr_number AS client_id_cr_number,
                           c.client_type AS client_type,
                           c.phone AS client_phone,
                           c.contact_person_name AS client_contact_person_name,
                           c.contact_person_mobile AS client_contact_person_mobile,
                           c.email AS client_email,
                           c.address AS client_address,
                           c.note AS client_note,
                           su.username AS specialist_username,
                           COALESCE(NULLIF(TRIM(su.full_name), ''), su.username) AS specialist_display_name
                    FROM investment_feasibility_studies s
                    JOIN investment_opportunities o ON o.id = s.opportunity_id
                    JOIN investment_clients c ON c.id = o.client_id
                    LEFT JOIN users su ON su.id = o.investment_specialist_user_id
                    WHERE s.id = $1
                    LIMIT 1
                `,
                [id],
            );

            if (!studyRes.rows.length) {
                res.status(404).json({ error: 'Study not found' });
                return;
            }

            const row = studyRes.rows[0];
            const userId = req.user?.id;
            const role = req.user?.role;
            const allowed = role === 'super_admin'
                || role === 'ceo'
                || req.user?.department === 'investment'
                || String(row.investment_specialist_user_id || '') === String(userId || '')
                || requireCommitteeDmOrSuperAdmin(req);
            if (!allowed) {
                res.status(403).json({ error: 'Not allowed' });
                return;
            }

            const opportunityAttachments = await pool.query(
                `
                    SELECT * FROM investment_opportunity_attachments
                    WHERE opportunity_id = $1
                    ORDER BY created_at ASC
                `,
                [row.opportunity_id],
            );
            const studyAttachments = await pool.query(
                `
                    SELECT * FROM investment_feasibility_attachments
                    WHERE study_id = $1
                    ORDER BY created_at ASC
                `,
                [id],
            );
            const opinions = await pool.query(
                `
                    SELECT op.*, u.username AS submitted_by_username
                    FROM investment_committee_opinions op
                    LEFT JOIN users u ON u.id = op.submitted_by
                    WHERE op.study_id = $1
                    ORDER BY op.department ASC
                `,
                [id],
            );

            res.status(200).json({
                data: {
                    study: {
                        id: row.id,
                        opportunity_id: row.opportunity_id,
                        study_status: row.study_status,
                        expected_property_income: row.expected_property_income,
                        product_sales: row.product_sales,
                        expenses: row.expenses,
                        final_result: row.final_result,
                        initial_agreement_notes: row.initial_agreement_notes,
                        status: row.status,
                        created_at: row.created_at,
                        updated_at: row.updated_at,
                    },
                    opportunity: {
                        opportunity_date: row.opportunity_date,
                        opportunity_type: row.opportunity_type,
                        region: row.region,
                        city: row.city,
                        district: row.district,
                        street: row.street,
                        street_type: row.street_type,
                        station_name_if_exists: row.station_name_if_exists,
                        location_status: row.location_status,
                        area_m2: row.area_m2,
                        frontage_m: row.frontage_m,
                        depth_m: row.depth_m,
                        location_url: row.location_url,
                        issued_licenses: row.issued_licenses,
                        pending_licenses: row.pending_licenses,
                        specialist_username: row.specialist_username,
                        specialist_display_name: row.specialist_display_name,
                        /** For client-side submit permission only; not shown in read-only detail UI. */
                        investment_specialist_user_id: row.investment_specialist_user_id,
                        notes: row.notes,
                        status: row.status,
                    },
                    client: {
                        name: row.client_name,
                        id_cr_number: row.client_id_cr_number,
                        client_type: row.client_type,
                        phone: row.client_phone,
                        contact_person_name: row.client_contact_person_name,
                        contact_person_mobile: row.client_contact_person_mobile,
                        email: row.client_email,
                        address: row.client_address,
                        note: row.client_note,
                    },
                    opportunityAttachments: opportunityAttachments.rows,
                    studyAttachments: studyAttachments.rows,
                    opinions: opinions.rows,
                    requiredDepartments: COMMITTEE_DEPARTMENTS,
                },
            });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch study details', details: error.message });
        }
    }

    // -------------------- Opinions --------------------
    static async upsertOpinion(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            const userRole = req.user?.role;
            const userDept = req.user?.department;
            if (!userId || !userRole) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const studyId = String(req.params?.id || '').trim();
            const deptParam = normalizeCommitteeDepartment(req.params?.department);
            if (!studyId || !deptParam) {
                res.status(400).json({ error: 'study id and valid department are required' });
                return;
            }

            const allowed = userRole === 'super_admin'
                || userRole === 'ceo'
                || (userRole === 'department_manager' && userDept === deptParam);
            if (!allowed) {
                res.status(403).json({ error: 'Only the matching department manager can submit this opinion' });
                return;
            }

            const payload = req.body?.opinionPayload ?? {};

            const upsert = await pool.query(
                `
                    INSERT INTO investment_committee_opinions (
                        study_id, department, opinion_payload, submitted_by, submitted_at, updated_at
                    ) VALUES ($1,$2,$3::jsonb,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
                    ON CONFLICT (study_id, department)
                    DO UPDATE SET
                        opinion_payload = EXCLUDED.opinion_payload,
                        submitted_by = EXCLUDED.submitted_by,
                        submitted_at = EXCLUDED.submitted_at,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `,
                [studyId, deptParam, JSON.stringify(payload), userId],
            );

            res.status(200).json({ data: upsert.rows[0] });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to submit opinion', details: error.message });
        }
    }

    static async listCommitteeInbox(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureInvestmentOpportunitiesSchema();

            const userId = req.user?.id;
            const userRole = req.user?.role;
            const userDept = req.user?.department;
            if (!userId || !userRole) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!requireCommitteeDmOrSuperAdmin(req)) {
                res.status(403).json({ error: 'Only committee department managers can view inbox' });
                return;
            }

            // If super_admin/ceo: show all submitted studies.
            // If DM: show submitted studies, plus whether this department already submitted opinion.
            const dept = userRole === 'department_manager' ? normalizeDepartment(userDept) : null;
            const params: any[] = [];
            let opinionJoin = '';
            if (dept && COMMITTEE_DEPARTMENTS.includes(dept as any)) {
                params.push(dept);
                opinionJoin = `
                    LEFT JOIN investment_committee_opinions op
                      ON op.study_id = s.id
                     AND op.department = $1
                `;
            }

            const result = await pool.query(
                `
                    SELECT
                        s.*,
                        o.opportunity_type,
                        o.opportunity_date,
                        o.region,
                        o.city,
                        c.name AS client_name,
                        ${dept ? 'op.submitted_at AS my_department_submitted_at' : 'NULL::timestamptz AS my_department_submitted_at'}
                    FROM investment_feasibility_studies s
                    JOIN investment_opportunities o ON o.id = s.opportunity_id
                    JOIN investment_clients c ON c.id = o.client_id
                    ${opinionJoin}
                    WHERE s.status = 'submitted_to_committee'
                    ORDER BY s.created_at DESC
                    LIMIT 500
                `,
                params,
            );

            res.status(200).json({ data: result.rows });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to load committee inbox', details: error.message });
        }
    }
}

