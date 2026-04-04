import { createClient } from '@supabase/supabase-js';

const requiredEnv = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required for Supabase storage configuration`);
    }
    return value;
};

const getSupabaseKey = (): string => {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        return serviceRoleKey;
    }

    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (anonKey) {
        return anonKey;
    }

    throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required for Supabase storage configuration');
};

export const SUPABASE_BUCKET_NAME = process.env.SUPABASE_BUCKET_NAME || 'pms';

export const getAllowedMimeTypes = (): string[] => {
    const configured = process.env.ALLOWED_MIME_TYPES;
    if (!configured) {
        return [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/png',
            'image/jpeg',
        ];
    }

    return configured
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
};

export const getMaxFileSizeMb = (): number => {
    const value = Number(process.env.MAX_FILE_SIZE_MB || '25');
    if (!Number.isFinite(value) || value <= 0) {
        return 25;
    }
    return value;
};

export const validateSupabaseStorageConfig = (): void => {
    requiredEnv('SUPABASE_URL');
    getSupabaseKey();
};

validateSupabaseStorageConfig();

export const supabaseAdmin = createClient(
    requiredEnv('SUPABASE_URL'),
    getSupabaseKey(),
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    },
);
