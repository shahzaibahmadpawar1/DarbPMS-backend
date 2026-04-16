import { Router } from 'express';
import {
    addManagerAttachment,
    assignWorkflowTask,
    createContractRequestTask,
    getAssignableUsers,
    getWorkflowTasks,
    getWorkflowTaskHistory,
    managerValidateWorkflowTask,
    reviewWorkflowTask,
    submitRequesterDecision,
    submitManagerAttachment,
    submitEmployeeAttachment,
} from '../controllers/workflowTasks.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/', getWorkflowTasks);
router.get('/assignable-users', getAssignableUsers);
router.post('/contract-request', createContractRequestTask);
router.get('/:id/history', getWorkflowTaskHistory);
router.patch('/:id/assign', assignWorkflowTask);
router.patch('/:id/manager-attachment', addManagerAttachment);
router.patch('/:id/manager-submit', submitManagerAttachment);
router.patch('/:id/employee-submit', submitEmployeeAttachment);
router.patch('/:id/manager-validate', managerValidateWorkflowTask);
router.patch('/:id/review', reviewWorkflowTask);
router.patch('/:id/requester-decision', submitRequesterDecision);

export default router;
