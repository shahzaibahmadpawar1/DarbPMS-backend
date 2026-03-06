import { Request, Response } from 'express';
import * as deepl from 'deepl-node';
import { getActiveGlossaryId } from '../services/glossary';

const DEEPL_API_KEY = process.env.DEEPL_API_KEY || 'ce8036ed-8a04-42b9-8596-0ff2483c359d:fx';

const deeplClient = new deepl.DeepLClient(DEEPL_API_KEY);

// Warm up: resolve the glossary ID once at startup so the first request
// does not incur the verification round-trip.
let glossaryIdPromise: Promise<string | null> = getActiveGlossaryId();

export const translateTexts = async (req: Request, res: Response): Promise<void> => {
    try {
        const { texts, targetLang } = req.body;

        if (!texts || !Array.isArray(texts) || texts.length === 0) {
            res.status(400).json({ success: false, message: 'texts array is required' });
            return;
        }

        if (!targetLang) {
            res.status(400).json({ success: false, message: 'targetLang is required' });
            return;
        }

        // Filter out empty/non-string texts and map back after
        const validTexts: string[] = texts.map((t: unknown) =>
            typeof t === 'string' ? t : ''
        );

        const nonEmptyTexts = validTexts.filter((t) => t.trim().length > 0);

        if (nonEmptyTexts.length === 0) {
            res.json({ success: true, translations: validTexts });
            return;
        }

        // Resolve glossary ID (cached after first call)
        const glossaryId = await glossaryIdPromise;

        // Build translate options — attach glossary when available
        const translateOptions: deepl.TranslateTextOptions = {};
        if (glossaryId) {
            translateOptions.glossary = glossaryId;
        }

        // DeepL requires an explicit source language when a glossary is used.
        // Passing null (auto-detect) causes the glossary to be silently ignored.
        const sourceLang: deepl.SourceLanguageCode = 'en';

        let results: deepl.TextResult | deepl.TextResult[];
        try {
            results = await deeplClient.translateText(
                nonEmptyTexts,
                sourceLang,
                targetLang as deepl.TargetLanguageCode,
                translateOptions
            );
        } catch (translateErr: unknown) {
            // If the glossary caused a failure (e.g. deleted remotely), retry without it
            const errMsg = translateErr instanceof Error ? translateErr.message : '';
            if (glossaryId && (errMsg.includes('glossary') || errMsg.includes('404'))) {
                console.warn('[Translation] Glossary error — retrying without glossary:', errMsg);
                // Reset promise so next request tries to re-create the glossary
                glossaryIdPromise = getActiveGlossaryId();
                results = await deeplClient.translateText(
                    nonEmptyTexts,
                    null,
                    targetLang as deepl.TargetLanguageCode
                );
            } else {
                throw translateErr;
            }
        }

        const translationMap: Record<string, string> = {};
        nonEmptyTexts.forEach((text, i) => {
            translationMap[text] = Array.isArray(results) ? results[i].text : (results as deepl.TextResult).text;
        });

        const translations = validTexts.map((t) =>
            t.trim().length > 0 ? (translationMap[t] ?? t) : t
        );

        res.json({ success: true, translations });
    } catch (error: unknown) {
        console.error('DeepL translation error:', error);
        const message = error instanceof Error ? error.message : 'Translation failed';
        res.status(500).json({ success: false, message });
    }
};
