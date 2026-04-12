import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { submitRequest } from '../controllers/requests.controller';

const router = Router();

router.use(authenticateToken);
router.post('/submit', submitRequest);

export default router;
