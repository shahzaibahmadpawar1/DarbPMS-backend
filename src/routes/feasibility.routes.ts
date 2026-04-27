import { Router } from 'express';
import { authenticateToken, requireCapability, requireDepartmentMatchFromBody } from '../middleware/auth';
import { FeasibilityController } from '../controllers/feasibility.controller';

const router = Router();

router.use(authenticateToken);

router.post('/submit', requireCapability('create'), requireDepartmentMatchFromBody('departmentType'), FeasibilityController.submit);
router.get('/:taskId/details', requireCapability('view'), FeasibilityController.getDetails);

export default router;

