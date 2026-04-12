import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { submitCeoContact } from '../controllers/ceoContact.controller';

const router = Router();

router.use(authenticateToken);
router.post('/submit', submitCeoContact);

export default router;
