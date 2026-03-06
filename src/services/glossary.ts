/**
 * DeepL Glossary Service
 *
 * The existing glossary was created via the v2 classic API, so verification
 * uses GET /v2/glossaries/:id.  New glossaries (if ever needed) are also
 * created via v2 because the free plan quota only allows a small number and
 * the v2 classic endpoint is sufficient for EN→AR.
 *
 * Free-tier key base URL:  https://api-free.deepl.com
 */

const DEEPL_API_KEY = process.env.DEEPL_API_KEY || 'ce8036ed-8a04-42b9-8596-0ff2483c359d:fx';
const DEEPL_BASE = DEEPL_API_KEY.endsWith(':fx')
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';

const GLOSSARY_NAME = 'darb-pms';

/**
 * Brand / product terms that must remain consistent.
 * Format: English (source) → Arabic (target)
 */
const GLOSSARY_TERMS: Record<string, string> = {
    'Darb': 'درب',
    'darb': 'درب',
    'DARB': 'درب',
    'DarbStation': 'درب ستيشن',
    'darbstation': 'درب ستيشن',
    'Darb Station': 'درب ستيشن',
};

// Build TSV payload
function buildTsv(terms: Record<string, string>): string {
    return Object.entries(terms)
        .map(([src, tgt]) => `${src}\t${tgt}`)
        .join('\n');
}

interface DeepLV2Glossary {
    glossary_id: string;
    name: string;
    ready: boolean;
    source_lang: string;
    target_lang: string;
}

async function deeplFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${DEEPL_BASE}${path}`, {
        ...options,
        headers: {
            Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string>),
        },
    });
    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`DeepL API error ${res.status}: ${body}`) as Error & { status: number };
        err.status = res.status;
        throw err;
    }
    return res.json() as Promise<T>;
}

/**
 * Creates a new v2 classic EN→AR glossary and returns its ID.
 */
export async function createGlossary(): Promise<string> {
    const body = new URLSearchParams({
        name: GLOSSARY_NAME,
        source_lang: 'en',
        target_lang: 'ar',
        entries: buildTsv(GLOSSARY_TERMS),
        entries_format: 'tsv',
    });

    const glossary = await deeplFetch<DeepLV2Glossary>('/v2/glossaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    console.log(`[Glossary] Created "${GLOSSARY_NAME}" — id: ${glossary.glossary_id}`);
    return glossary.glossary_id;
}

/**
 * Verifies that a glossary ID still exists and is ready (uses v2 endpoint).
 */
export async function verifyGlossary(glossaryId: string): Promise<boolean> {
    try {
        const glossary = await deeplFetch<DeepLV2Glossary>(`/v2/glossaries/${glossaryId}`);
        return glossary.ready === true;
    } catch {
        return false;
    }
}

/**
 * Lists all glossaries from the v2 API and returns the first one whose name
 * matches GLOSSARY_NAME (case-insensitive), or null if none found.
 */
async function findExistingGlossary(): Promise<string | null> {
    try {
        const data = await deeplFetch<{ glossaries: DeepLV2Glossary[] }>('/v2/glossaries');
        const match = data.glossaries.find(
            (g) => g.name.toLowerCase() === GLOSSARY_NAME.toLowerCase() && g.ready
        );
        if (match) {
            console.log(`[Glossary] Reusing existing glossary "${match.name}" — id: ${match.glossary_id}`);
            return match.glossary_id;
        }
        // If named match not found, return the first ready glossary as a fallback
        const first = data.glossaries.find((g) => g.ready);
        if (first) {
            console.log(`[Glossary] Reusing first ready glossary "${first.name}" — id: ${first.glossary_id}`);
            return first.glossary_id;
        }
        return null;
    } catch {
        return null;
    }
}

let _cachedGlossaryId: string | null = null;

/**
 * Returns a valid glossary ID:
 *   1. Memory-cached ID (fastest)
 *   2. DEEPL_GLOSSARY_ID env var (after verification)
 *   3. Existing glossary from DeepL account (quota-safe fallback)
 *   4. Creates a new one if none exist
 */
export async function getActiveGlossaryId(): Promise<string | null> {
    // 1. Return memory-cached ID
    if (_cachedGlossaryId) return _cachedGlossaryId;

    // 2. Check environment variable
    const envId = process.env.DEEPL_GLOSSARY_ID?.trim();
    if (envId) {
        const valid = await verifyGlossary(envId);
        if (valid) {
            _cachedGlossaryId = envId;
            return _cachedGlossaryId;
        }
        console.warn(`[Glossary] DEEPL_GLOSSARY_ID "${envId}" is invalid or not ready — searching for an existing one.`);
    }

    // 3. Look for an existing glossary in the account (avoids quota errors)
    const existing = await findExistingGlossary();
    if (existing) {
        _cachedGlossaryId = existing;
        if (!envId) {
            console.warn(`[Glossary] Set DEEPL_GLOSSARY_ID=${existing} in your .env to skip this lookup on restart.`);
        }
        return _cachedGlossaryId;
    }

    // 4. Nothing found — try to create a new glossary
    try {
        _cachedGlossaryId = await createGlossary();
        console.warn(`[Glossary] Set DEEPL_GLOSSARY_ID=${_cachedGlossaryId} in your .env to avoid re-creating on restart.`);
        return _cachedGlossaryId;
    } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 456) {
            console.error('[Glossary] Quota exceeded and no usable glossary found. Check your DeepL account.');
        } else {
            console.error('[Glossary] Failed to create glossary:', err);
        }
        return null;
    }
}

