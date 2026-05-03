import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

const SIDEBAR_KEY = 'sidebar_nav_slots';

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
}
