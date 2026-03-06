import { Router } from 'express';
import { translateTexts } from '../controllers/translations.controller';

const router = Router();

// POST /api/translate - translate an array of texts using DeepL
router.post('/', translateTexts);

export default router;
