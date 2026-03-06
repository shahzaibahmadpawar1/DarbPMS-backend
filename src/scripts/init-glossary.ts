/**
 * One-time script to set up the DeepL glossary and print its ID.
 *
 * Run once:
 *   npx ts-node src/scripts/init-glossary.ts
 *
 * Then add the printed ID to your .env:
 *   DEEPL_GLOSSARY_ID=<id>
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { verifyGlossary, getActiveGlossaryId } from '../services/glossary';

(async () => {
    const existingId = process.env.DEEPL_GLOSSARY_ID?.trim();

    if (existingId) {
        console.log(`Checking existing glossary: ${existingId}`);
        const valid = await verifyGlossary(existingId);
        if (valid) {
            console.log('✅ Glossary is active and ready. No action needed.');
            console.log(`DEEPL_GLOSSARY_ID=${existingId}`);
            process.exit(0);
        }
        console.warn('⚠️  Existing glossary is no longer valid. Searching for a usable one…');
    }

    // Use getActiveGlossaryId which handles quota-exceeded by reusing existing glossaries
    const id = await getActiveGlossaryId();
    if (!id) {
        console.error('❌ Could not obtain a glossary ID. Check your DeepL account quota.');
        process.exit(1);
    }

    console.log('\n✅ Glossary is ready!');
    console.log('Add the following to your .env file:\n');
    console.log(`DEEPL_GLOSSARY_ID=${id}\n`);
})();
