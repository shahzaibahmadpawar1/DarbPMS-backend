import { Request, Response } from 'express';
import pool from '../config/database';
import { recordActivity } from '../utils/activity';
import { isSchemaCompatibilityError } from '../utils/dbErrors';

let contractLifecycleReady = false;

const ensureContractLifecycleSchema = async (): Promise<void> => {
    if (contractLifecycleReady) return;

    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_saved_by UUID REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
        UPDATE contracts
        SET is_submitted = TRUE,
            submitted_at = COALESCE(submitted_at, created_at),
            submitted_by = COALESCE(submitted_by, created_by)
        WHERE is_submitted IS DISTINCT FROM TRUE;
    `);

    contractLifecycleReady = true;
};

export const createContract = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureContractLifecycleSchema();

        const {
            contractNo, contractType, contractSignatureDate, contractSignatureLocation,
            tenancyStartDate, tenancyEndDate, lessorName, nationality, idType,
            idNo, idCopy, mobileNo, email, tenantName, tenantNationality,
            tenantIdType, tenantIdNo, tenantIdCopy, tenantMobileNo, tenantEmail,
            duration, days, propertyValue, installments, dueDate, dueAmount,
            paidAmount, notPaidAmount, duePeriod, stationCode, submit
        } = req.body;

        const shouldSubmit = submit !== false;
        const resolvedContractNo = String(contractNo || '').trim() || `CON-DRAFT-${Date.now()}`;

        if (!stationCode || (shouldSubmit && !resolvedContractNo)) {
            res.status(400).json({ error: 'Station code is required. Submit also requires Contract No.' });
            return;
        }

        const userId = (req as any).user?.id;
        const query = `
            INSERT INTO contracts (
                contract_no, contract_type, contract_signature_date, contract_signature_location, 
                tenancy_start_date, tenancy_end_date, lessor_name, nationality, id_type, 
                id_no, id_copy, mobile_no, email, tenant_name, tenant_nationality, 
                tenant_id_type, tenant_id_no, tenant_id_copy, tenant_mobile_no, tenant_email, 
                duration, days, property_value, installments, due_date, due_amount, 
                paid_amount, not_paid_amount, due_period, station_code, created_by, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $31)
            RETURNING *
        `;

        const values = [
            resolvedContractNo, contractType, contractSignatureDate || null, contractSignatureLocation,
            tenancyStartDate || null, tenancyEndDate || null, lessorName, nationality, idType,
            idNo, idCopy, mobileNo, email, tenantName, tenantNationality,
            tenantIdType, tenantIdNo, tenantIdCopy, tenantMobileNo, tenantEmail,
            duration, days || 0, propertyValue || 0, installments || 0, dueDate || null, dueAmount || 0,
            paidAmount || 0, notPaidAmount || 0, duePeriod, stationCode, userId
        ];
        const result = await pool.query(query, values);

        await pool.query(`
            UPDATE contracts
            SET is_submitted = $1,
                submitted_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                submitted_by = CASE WHEN $1 THEN $2 ELSE NULL END,
                last_saved_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $1 THEN NULL ELSE $2 END
            WHERE id = $3
        `, [shouldSubmit, userId || null, result.rows[0].id]);

        const refreshed = await pool.query('SELECT * FROM contracts WHERE id = $1 LIMIT 1', [result.rows[0].id]);

        // Log activity
        void recordActivity({
            actorId: userId,
            action: shouldSubmit ? 'submit' : 'save',
            entityType: 'contract',
            entityId: result.rows[0].id,
            summary: `${shouldSubmit ? 'submitted' : 'saved'} contract`,
            metadata: {
                contractType: refreshed.rows[0]?.contract_type,
            },
            sourcePath: '/api/contracts',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: shouldSubmit ? 'Contract submitted successfully' : 'Contract saved successfully',
            data: refreshed.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating contract:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Contract No already exists' });
            return;
        }
        res.status(500).json({
            error: 'Failed to create contract',
            details: error.message
        });
    }
};

export const getAllContracts = async (req: Request, res: Response): Promise<void> => {
    try {
        const userRole = (req as any).user?.role;
        const userDepartment = (req as any).user?.department;
        const query = userRole === 'super_admin'
            ? 'SELECT * FROM contracts ORDER BY created_at DESC'
            : `
                SELECT c.* FROM contracts c
                INNER JOIN station_information si ON si.station_code = c.station_code
                WHERE (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) = $1
                ORDER BY c.created_at DESC
            `;
        const result = await pool.query(query, userRole === 'super_admin' ? [] : [userDepartment]);
        res.status(200).json({ message: 'Contracts retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        console.error('Error fetching contracts:', error);
        res.status(500).json({ error: 'Failed to fetch contracts', details: error.message });
    }
};

export const getContractsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM contracts WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Contracts retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error: any) {
        if (isSchemaCompatibilityError(error)) {
            res.status(200).json({ message: 'Contracts retrieved successfully', data: [], count: 0 });
            return;
        }
        console.error('Error fetching contracts:', error);
        res.status(500).json({ error: 'Failed to fetch contracts', details: error.message });
    }
};

export const updateContract = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureContractLifecycleSchema();

        const { id } = req.params;
        const reqBody = req.body;
        const userId = (req as any).user?.id;
        const submit = reqBody?.submit;
        const shouldSubmit = submit === true || submit === 'true';

        const fields = Object.entries(reqBody).filter(([k, v]) => k !== 'submit' && v !== undefined);
        if (fields.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        const setClause = fields.map(([k, _], i) => `${k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)} = $${i + 1}`).join(', ');
        const query = `
            UPDATE contracts 
            SET ${setClause},
                is_submitted = $${fields.length + 1},
                submitted_at = CASE WHEN $${fields.length + 1} THEN CURRENT_TIMESTAMP ELSE submitted_at END,
                submitted_by = CASE WHEN $${fields.length + 1} THEN $${fields.length + 2} ELSE submitted_by END,
                last_saved_at = CASE WHEN $${fields.length + 1} THEN last_saved_at ELSE CURRENT_TIMESTAMP END,
                last_saved_by = CASE WHEN $${fields.length + 1} THEN last_saved_by ELSE $${fields.length + 2} END,
                updated_by = $${fields.length + 2},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $${fields.length + 3}
            RETURNING *
        `;

        const values = [...fields.map(([_, v]) => v), shouldSubmit, userId, id];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Contract not found' });
            return;
        }
        res.status(200).json({ message: 'Contract updated successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error updating contract:', error);
        res.status(500).json({
            error: 'Failed to update contract',
            details: error.message
        });
    }
};

export const getLatestSavedContract = async (req: Request, res: Response): Promise<void> => {
    try {
        await ensureContractLifecycleSchema();

        const userId = (req as any).user?.id;
        const stationCode = String(req.query?.stationCode || '').trim();
        if (!userId) {
            res.status(200).json({ data: null });
            return;
        }

        const result = await pool.query(`
            SELECT * FROM contracts
            WHERE is_submitted = FALSE
              AND created_by = $1
              AND ($2 = '' OR station_code = $2)
            ORDER BY COALESCE(last_saved_at, updated_at, created_at) DESC
            LIMIT 1
        `, [userId, stationCode]);

        res.status(200).json({ data: result.rows[0] || null });
    } catch (error: any) {
        console.error('Error fetching latest saved contract:', error);
        res.status(500).json({ error: 'Failed to fetch latest saved contract', details: error.message });
    }
};

export const deleteContract = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM contracts WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Contract not found' });
            return;
        }
        res.status(200).json({ message: 'Contract deleted successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error deleting contract:', error);
        res.status(500).json({
            error: 'Failed to delete contract',
            details: error.message
        });
    }
};
