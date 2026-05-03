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

function rowToClientResponse(row: {
    id: string | number;
    station_code: string;
    payload: unknown;
    created_at: Date;
    created_by?: string | null;
}) {
    return {
        id: String(row.id),
        station_code: row.station_code,
        payload: row.payload,
        created_at: row.created_at,
        updated_at: row.created_at,
        updated_by: row.created_by ?? null,
        latest_version_id: String(row.id),
    };
}

export const getSurveyReportByStation = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureSurveySchema();
        const stationCode = String(req.params.stationCode || '').trim();
        if (!stationCode) {
            res.status(400).json({ error: 'stationCode is required' });
            return;
        }

        const latest = await pool.query(
            `
            SELECT id, station_code, payload, created_at, created_by
            FROM survey_report_versions
            WHERE station_code = $1
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [stationCode],
        );

        if (latest.rows.length) {
            res.status(200).json({ data: rowToClientResponse(latest.rows[0]) });
            return;
        }

        const legacy = await pool.query('SELECT * FROM survey_reports WHERE station_code = $1 LIMIT 1', [stationCode]);
        if (!legacy.rows.length) {
            res.status(200).json({ data: null });
            return;
        }

        const r = legacy.rows[0];
        res.status(200).json({
            data: {
                id: String(r.id),
                station_code: r.station_code,
                payload: r.payload,
                created_at: r.created_at,
                updated_at: r.updated_at,
                updated_by: r.updated_by ?? null,
                latest_version_id: null,
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: 'Failed to fetch survey report', details: msg });
    }
};

export const listSurveyReportHistory = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureSurveySchema();
        const stationCode = String(req.params.stationCode || '').trim();
        if (!stationCode) {
            res.status(400).json({ error: 'stationCode is required' });
            return;
        }

        const result = await pool.query(
            `
            SELECT id, created_at
            FROM survey_report_versions
            WHERE station_code = $1
            ORDER BY created_at DESC
            LIMIT 200
            `,
            [stationCode],
        );

        res.status(200).json({
            data: result.rows.map((r) => ({ id: String(r.id), created_at: r.created_at })),
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: 'Failed to list survey history', details: msg });
    }
};

export const getSurveyReportVersion = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureSurveySchema();
        const stationCode = String(req.params.stationCode || '').trim();
        const versionId = String(req.params.versionId || '').trim();
        if (!stationCode || !versionId) {
            res.status(400).json({ error: 'stationCode and versionId are required' });
            return;
        }

        const result = await pool.query(
            `
            SELECT id, station_code, payload, created_at, created_by
            FROM survey_report_versions
            WHERE station_code = $1 AND id = $2
            LIMIT 1
            `,
            [stationCode, versionId],
        );

        if (!result.rows.length) {
            res.status(404).json({ error: 'Survey version not found' });
            return;
        }

        res.status(200).json({ data: rowToClientResponse(result.rows[0]) });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: 'Failed to fetch survey version', details: msg });
    }
};

export const upsertSurveyReportByStation = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await ensureSurveySchema();
        const stationCode = String(req.params.stationCode || '').trim();
        const payload = readPayload(req.body?.payload);
        const userId = req.user?.id || null;

        if (!stationCode) {
            res.status(400).json({ error: 'stationCode is required' });
            return;
        }

        const insertResult = await pool.query(
            `
            INSERT INTO survey_report_versions (station_code, payload, created_by)
            VALUES ($1, $2::jsonb, $3)
            RETURNING id, station_code, payload, created_at, created_by
            `,
            [stationCode, JSON.stringify(payload), userId],
        );

        const versionRow = insertResult.rows[0];

        await pool.query(
            `
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
            `,
            [stationCode, JSON.stringify(payload), userId],
        );

        res.status(200).json({
            message: 'Survey report saved',
            data: {
                ...rowToClientResponse(versionRow),
                version: { id: String(versionRow.id), created_at: versionRow.created_at },
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: 'Failed to save survey report', details: msg });
    }
};
