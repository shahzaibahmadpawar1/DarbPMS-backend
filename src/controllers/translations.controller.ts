import { Request, Response } from 'express';
import * as deepl from 'deepl-node';

const DEEPL_API_KEY = 'ce8036ed-8a04-42b9-8596-0ff2483c359d:fx';

const deeplClient = new deepl.DeepLClient(DEEPL_API_KEY);

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

        const results = await deeplClient.translateText(
            nonEmptyTexts,
            null,
            targetLang as deepl.TargetLanguageCode
        );

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
