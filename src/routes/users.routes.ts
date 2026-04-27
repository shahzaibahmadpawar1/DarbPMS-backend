import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { UsersController } from '../controllers/users.controller';

const router = Router();

router.use(authenticateToken);

router.get('/department-managers', UsersController.getDepartmentManagers);

export default router;

