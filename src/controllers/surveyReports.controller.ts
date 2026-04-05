import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';
import { ensureSurveySchema } from '../utils/survey';

const readPayload = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
};

export const getSurveyReportByStation = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureSurveySchema();

        const stationCode = String(req.params.stationCode || '').trim();
        if (!stationCode) {
            res.status(400).json({ error: 'stationCode is required' });
            return;
        }

        const result = await pool.query(
            'SELECT * FROM survey_reports WHERE station_code = $1 LIMIT 1',
            [stationCode],
        );

        if (!result.rows.length) {
            res.status(200).json({ data: null });
            return;
        }

        res.status(200).json({ data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch survey report', details: error.message });
    }
};

export const upsertSurveyReportByStation = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureSurveySchema();

        const stationCode = String(req.params.stationCode || '').trim();
        const payload = readPayload((req.body as any)?.payload);
        const userId = req.user?.id || null;

        if (!stationCode) {
            res.status(400).json({ error: 'stationCode is required' });
            return;
        }

        const result = await pool.query(`
            INSERT INTO survey_reports (
                station_code,
                payload,
                created_by,
                updated_by
            ) VALUES ($1, $2::jsonb, $3, $3)
            ON CONFLICT (station_code) DO UPDATE SET
                payload = EXCLUDED.payload,
                updated_by = EXCLUDED.updated_by,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [stationCode, JSON.stringify(payload), userId]);

        res.status(200).json({ message: 'Survey report saved', data: result.rows[0] });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to save survey report', details: error.message });
    }
};
