import { createClient } from '@supabase/supabase-js';

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

const resolveSupabaseUrl = (): string => {
    const explicit = process.env.SUPABASE_URL;
    if (explicit) {
        return explicit;
    }

    const dbHost = process.env.DB_HOST || '';
    const dbUrl = process.env.DATABASE_URL || '';

    const extractRef = (host: string): string | null => {
        const trimmed = host.trim();
        if (!trimmed) return null;

        const normalized = trimmed.replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
        const byDbSubdomain = normalized.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
        if (byDbSubdomain?.[1]) {
            return byDbSubdomain[1].toLowerCase();
        }

        const firstLabel = normalized.split('.')[0]?.toLowerCase();
        if (/^[a-z0-9]{12,}$/.test(firstLabel || '')) {
            return firstLabel || null;
        }

        return null;
    };

    const parseHostFromDbUrl = (): string => {
        if (!dbUrl) return '';
        try {
            const parsed = new URL(dbUrl);
            return parsed.hostname || '';
        } catch {
            return '';
        }
    };

    const ref = extractRef(dbHost) || extractRef(parseHostFromDbUrl());
    if (ref) {
        return `https://${ref}.supabase.co`;
    }

    throw new Error('SUPABASE_URL is required for Supabase storage configuration');
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
            'application/acad',
            'application/x-acad',
            'application/autocad_dwg',
            'image/vnd.dwg',
            'application/dwg',
            'application/x-dwg',
        ];
    }

    return configured
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
};

export const getAllowedFileExtensions = (): string[] => {
    const configured = process.env.ALLOWED_FILE_EXTENSIONS;
    if (!configured) {
        return ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.dwg'];
    }

    return configured
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .map((value) => (value.startsWith('.') ? value : `.${value}`));
};

export const getMaxFileSizeMb = (): number => {
    const value = Number(process.env.MAX_FILE_SIZE_MB || '25');
    if (!Number.isFinite(value) || value <= 0) {
        return 25;
    }
    return value;
};

export const validateSupabaseStorageConfig = (): void => {
    resolveSupabaseUrl();
    getSupabaseKey();
};

let supabaseAdminInstance: ReturnType<typeof createClient> | null = null;

export const getSupabaseAdmin = (): ReturnType<typeof createClient> => {
    if (!supabaseAdminInstance) {
        validateSupabaseStorageConfig();
        supabaseAdminInstance = createClient(
            resolveSupabaseUrl(),
            getSupabaseKey(),
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                },
            },
        );
    }
    return supabaseAdminInstance;
};