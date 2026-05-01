import { Router } from 'express';
import { authenticateToken, requireCapability } from '../middleware/auth';
import { InvestmentWorkflowController } from '../controllers/investmentWorkflow.controller';

const router = Router();

router.use(authenticateToken);

// Location settings (Regions/Cities)
router.get('/locations/regions', requireCapability('view'), InvestmentWorkflowController.listRegions);
router.post('/locations/regions', requireCapability('manage_users'), InvestmentWorkflowController.createRegion);
router.delete('/locations/regions/:id', requireCapability('manage_users'), InvestmentWorkflowController.deleteRegion);
router.get('/locations/cities', requireCapability('view'), InvestmentWorkflowController.listCities);
router.post('/locations/cities', requireCapability('manage_users'), InvestmentWorkflowController.createCity);
router.delete('/locations/cities/:id', requireCapability('manage_users'), InvestmentWorkflowController.deleteCity);

// Clients
router.get('/clients', requireCapability('view'), InvestmentWorkflowController.listClients);
router.post('/clients', requireCapability('create'), InvestmentWorkflowController.createClient);

// Opportunities
router.get('/opportunities', requireCapability('view'), InvestmentWorkflowController.listOpportunities);
router.get('/opportunities/:id', requireCapability('view'), InvestmentWorkflowController.getOpportunity);
router.post('/opportunities', requireCapability('create'), InvestmentWorkflowController.createOpportunity);
router.post('/opportunities/:id/ceo/send-contract', requireCapability('edit'), InvestmentWorkflowController.ceoSendOpportunityToContract);
router.post('/opportunities/:id/ceo/approve', requireCapability('edit'), InvestmentWorkflowController.ceoApproveOpportunity);
router.post('/opportunities/:id/contract/submit', requireCapability('edit'), InvestmentWorkflowController.submitOpportunityContract);

// Studies
router.get('/studies', requireCapability('view'), InvestmentWorkflowController.listStudies);
router.post('/studies', requireCapability('create'), InvestmentWorkflowController.createOrUpdateStudy);
router.post('/studies/:id/submit', requireCapability('create'), InvestmentWorkflowController.submitStudyToCommittee);
router.get('/studies/:id/details', requireCapability('view'), InvestmentWorkflowController.getStudyDetails);

// Opinions (committee)
router.get('/committee/inbox', requireCapability('view'), InvestmentWorkflowController.listCommitteeInbox);
router.put('/studies/:id/opinions/:department', requireCapability('edit'), InvestmentWorkflowController.upsertOpinion);

export default router;

