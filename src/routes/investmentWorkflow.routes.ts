import { Router } from 'express';
import { authenticateToken, requireCapability } from '../middleware/auth';
import { InvestmentWorkflowController } from '../controllers/investmentWorkflow.controller';

const router = Router();

router.use(authenticateToken);

// Clients
router.get('/clients', requireCapability('view'), InvestmentWorkflowController.listClients);
router.post('/clients', requireCapability('create'), InvestmentWorkflowController.createClient);

// Opportunities
router.get('/opportunities', requireCapability('view'), InvestmentWorkflowController.listOpportunities);
router.get('/opportunities/:id', requireCapability('view'), InvestmentWorkflowController.getOpportunity);
router.post('/opportunities', requireCapability('create'), InvestmentWorkflowController.createOpportunity);

// Studies
router.get('/studies', requireCapability('view'), InvestmentWorkflowController.listStudies);
router.post('/studies', requireCapability('create'), InvestmentWorkflowController.createOrUpdateStudy);
router.post('/studies/:id/submit', requireCapability('create'), InvestmentWorkflowController.submitStudyToCommittee);
router.get('/studies/:id/details', requireCapability('view'), InvestmentWorkflowController.getStudyDetails);

// Opinions (committee)
router.get('/committee/inbox', requireCapability('view'), InvestmentWorkflowController.listCommitteeInbox);
router.put('/studies/:id/opinions/:department', requireCapability('edit'), InvestmentWorkflowController.upsertOpinion);

export default router;

