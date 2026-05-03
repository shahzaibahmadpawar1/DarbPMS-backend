import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

const SIDEBAR_KEY = 'sidebar_nav_slots';

export const SURVEY_STATION_STATUS_OPTIONS_KEY = 'survey_station_status_options';
export const SURVEY_STAGE_OPTIONS_KEY = 'survey_stage_options';

export const DEFAULT_SURVEY_STATION_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '1', label: 'Active' },
    { value: '2', label: 'Inactive' },
    { value: '3', label: 'Under Construction' },
    { value: '4', label: 'Under Development' },
    { value: '5', label: 'Pending' },
];

export const DEFAULT_SURVEY_STAGE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'operating license', label: 'operating license' },
    { value: 'electricity connection', label: 'electricity connection' },
    { value: 'automation', label: 'automation' },
    { value: 'cameras', label: 'cameras' },
    { value: 'finishing stage', label: 'finishing stage' },
    { value: 'it works', label: 'it works' },
    { value: 'other', label: 'other' },
];

function normalizeSurveyOptionsFromDb(raw: unknown, fallback: Array<{ value: string; label: string }>) {
    if (!Array.isArray(raw) || raw.length === 0) {
        return fallback;
    }
    const out: Array<{ value: string; label: string }> = [];
    for (const item of raw) {
        if (typeof item === 'string') {
            const v = item.trim();
            if (v) {
                out.push({ value: v, label: v });
            }
        } else if (item && typeof item === 'object' && !Array.isArray(item)) {
            const rec = item as Record<string, unknown>;
            const value = String(rec.value ?? '').trim();
            const label = String(rec.label ?? rec.value ?? '').trim();
            if (value) {
                out.push({ value, label: label || value });
            }
        }
    }
    return out.length ? out : fallback;
}

function parseSurveyOptionsForStore(raw: unknown): Array<{ value: string; label: string }> | null {
    if (!Array.isArray(raw)) {
        return null;
    }
    const out: Array<{ value: string; label: string }> = [];
    for (const item of raw) {
        if (typeof item === 'string') {
            const v = item.trim();
            if (v) {
                out.push({ value: v, label: v });
            }
        } else if (item && typeof item === 'object' && !Array.isArray(item)) {
            const rec = item as Record<string, unknown>;
            const value = String(rec.value ?? '').trim();
            const label = String(rec.label ?? rec.value ?? '').trim();
            if (value) {
                out.push({ value, label: label || value });
            }
        }
    }
    return out;
}

/** Full "All Stations" sidebar (executive): link titleKeys + dropdown groups. */
export const EXECUTIVE_SIDEBAR_SLOT_IDS = [
    'dashboard',
    'recentActivities',
    'analytics',
    'stations',
    'departments',
    'requests',
    'underReview',
    'tasks',
    'reports',
    'contactCEO',
    'investment',
    'systemSettings',
] as const;

export type ExecutiveSidebarSlotId = (typeof EXECUTIVE_SIDEBAR_SLOT_IDS)[number];

async function ensureAppSettingsTable(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key VARCHAR(191) PRIMARY KEY,
            value JSONB NOT NULL DEFAULT '[]'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
}

function isValidExecutiveOrder(order: unknown): order is ExecutiveSidebarSlotId[] {
    if (!Array.isArray(order) || order.length !== EXECUTIVE_SIDEBAR_SLOT_IDS.length) {
        return false;
    }
    const allowed = new Set<string>(EXECUTIVE_SIDEBAR_SLOT_IDS);
    const seen = new Set<string>();
    for (const id of order) {
        if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) {
            return false;
        }
        seen.add(id);
    }
    return seen.size === EXECUTIVE_SIDEBAR_SLOT_IDS.length;
}

export class AppSettingsController {
    static async getSidebarNavSlots(_req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureAppSettingsTable();
            const result = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [SIDEBAR_KEY]);
            const row = result.rows[0];
            const order = row?.value;
            if (Array.isArray(order) && isValidExecutiveOrder(order)) {
                res.status(200).json({ data: { order } });
                return;
            }
            res.status(200).json({ data: { order: null } });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: 'Failed to load sidebar order', details: msg });
        }
    }

    static async putSidebarNavSlots(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureAppSettingsTable();
            const order = req.body?.order;
            if (!isValidExecutiveOrder(order)) {
                res.status(400).json({
                    error: 'Invalid order',
                    message: `order must be a permutation of all ${EXECUTIVE_SIDEBAR_SLOT_IDS.length} slot ids`,
                });
                return;
            }
            await pool.query(
                `
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                `,
                [SIDEBAR_KEY, JSON.stringify(order)],
            );
            res.status(200).json({ success: true, data: { order } });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: 'Failed to save sidebar order', details: msg });
        }
    }

    static async getSurveyDropdowns(_req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureAppSettingsTable();
            const [statusResult, stageResult] = await Promise.all([
                pool.query(`SELECT value FROM app_settings WHERE key = $1`, [SURVEY_STATION_STATUS_OPTIONS_KEY]),
                pool.query(`SELECT value FROM app_settings WHERE key = $1`, [SURVEY_STAGE_OPTIONS_KEY]),
            ]);
            const stationStatusOptions = normalizeSurveyOptionsFromDb(
                statusResult.rows[0]?.value,
                DEFAULT_SURVEY_STATION_STATUS_OPTIONS,
            );
            const stageOptions = normalizeSurveyOptionsFromDb(stageResult.rows[0]?.value, DEFAULT_SURVEY_STAGE_OPTIONS);
            res.status(200).json({ data: { stationStatusOptions, stageOptions } });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: 'Failed to load survey dropdown options', details: msg });
        }
    }

    static async putSurveyDropdowns(req: AuthRequest, res: Response): Promise<void> {
        try {
            await ensureAppSettingsTable();
            const statusRaw = req.body?.stationStatusOptions;
            const stageRaw = req.body?.stageOptions;
            const stationStatusOptions = parseSurveyOptionsForStore(statusRaw);
            const stageOptions = parseSurveyOptionsForStore(stageRaw);
            if (!stationStatusOptions || !stageOptions) {
                res.status(400).json({
                    error: 'Invalid payload',
                    message: 'stationStatusOptions and stageOptions must be non-null arrays of { value, label }',
                });
                return;
            }
            await pool.query(
                `
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                `,
                [SURVEY_STATION_STATUS_OPTIONS_KEY, JSON.stringify(stationStatusOptions)],
            );
            await pool.query(
                `
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                `,
                [SURVEY_STAGE_OPTIONS_KEY, JSON.stringify(stageOptions)],
            );
            res.status(200).json({
                success: true,
                data: {
                    stationStatusOptions,
                    stageOptions,
                },
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: 'Failed to save survey dropdown options', details: msg });
        }
    }
}
