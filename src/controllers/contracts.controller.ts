import { Request, Response } from 'express';
import pool from '../config/database';

export const createContract = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            contractNo, contractType, contractSignatureDate, contractSignatureLocation,
            tenancyStartDate, tenancyEndDate, lessorName, nationality, idType,
            idNo, idCopy, mobileNo, email, tenantName, tenantNationality,
            tenantIdType, tenantIdNo, tenantIdCopy, tenantMobileNo, tenantEmail,
            duration, days, propertyValue, installments, dueDate, dueAmount,
            paidAmount, notPaidAmount, duePeriod, stationCode
        } = req.body;

        if (!contractNo || !stationCode) {
            res.status(400).json({ error: 'Contract No and station code are required' });
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
            contractNo, contractType, contractSignatureDate || null, contractSignatureLocation,
            tenancyStartDate || null, tenancyEndDate || null, lessorName, nationality, idType,
            idNo, idCopy, mobileNo, email, tenantName, tenantNationality,
            tenantIdType, tenantIdNo, tenantIdCopy, tenantMobileNo, tenantEmail,
            duration, days || 0, propertyValue || 0, installments || 0, dueDate || null, dueAmount || 0,
            paidAmount || 0, notPaidAmount || 0, duePeriod, stationCode, userId
        ];
        const result = await pool.query(query, values);

        res.status(201).json({ message: 'Contract created successfully', data: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating contract:', error);
        if (error.code === '23505') {
            res.status(409).json({ error: 'Contract No already exists' });
            return;
        }
        res.status(500).json({ error: 'Failed to create contract' });
    }
};

export const getAllContracts = async (_req: Request, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM contracts ORDER BY created_at DESC');
        res.status(200).json({ message: 'Contracts retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching contracts:', error);
        res.status(500).json({ error: 'Failed to fetch contracts' });
    }
};

export const getContractsByStation = async (req: Request, res: Response): Promise<void> => {
    try {
        const { stationCode } = req.params;
        const result = await pool.query('SELECT * FROM contracts WHERE station_code = $1 ORDER BY created_at DESC', [stationCode]);
        res.status(200).json({ message: 'Contracts retrieved successfully', data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching contracts:', error);
        res.status(500).json({ error: 'Failed to fetch contracts' });
    }
};

export const updateContract = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const reqBody = req.body;
        const userId = (req as any).user?.id;

        // Simplified update logic for brevity
        const fields = Object.entries(reqBody).filter(([_, v]) => v !== undefined);
        if (fields.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        const setClause = fields.map(([k, _], i) => `${k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)} = $${i + 1}`).join(', ');
        const query = `
            UPDATE contracts 
            SET ${setClause}, updated_by = $${fields.length + 1}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${fields.length + 2}
            RETURNING *
        `;

        const values = [...fields.map(([_, v]) => v), userId, id];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Contract not found' });
            return;
        }
        res.status(200).json({ message: 'Contract updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error updating contract:', error);
        res.status(500).json({ error: 'Failed to update contract' });
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
    } catch (error) {
        console.error('Error deleting contract:', error);
        res.status(500).json({ error: 'Failed to delete contract' });
    }
};
