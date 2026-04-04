import { Router } from 'express';
import {
    addManagerAttachment,
    assignWorkflowTask,
    getAssignableUsers,
    getWorkflowTasks,
    reviewWorkflowTask,
    submitEmployeeAttachment,
} from '../controllers/workflowTasks.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/', getWorkflowTasks);
router.get('/assignable-users', getAssignableUsers);
router.patch('/:id/assign', assignWorkflowTask);
router.patch('/:id/manager-attachment', addManagerAttachment);
router.patch('/:id/employee-submit', submitEmployeeAttachment);
router.patch('/:id/review', reviewWorkflowTask);

export default router;
