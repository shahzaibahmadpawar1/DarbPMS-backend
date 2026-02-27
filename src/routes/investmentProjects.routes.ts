import { Router } from 'express';
import {
    createInvestmentProject,
    getAllInvestmentProjects,
    getInvestmentProjectsByStation,
    getInvestmentProjectById,
    updateInvestmentProject,
    deleteInvestmentProject,
    getFeasibilityStats,
    getContractStats,
    updateInvestmentProjectReviewStatus,
} from '../controllers/investmentProjects.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

// CRUD
router.post('/', createInvestmentProject);
router.get('/', getAllInvestmentProjects);
router.get('/station/:stationCode', getInvestmentProjectsByStation);
router.get('/feasibility-stats', getFeasibilityStats);
router.get('/contract-stats', getContractStats);
router.get('/:id', getInvestmentProjectById);
router.put('/:id', updateInvestmentProject);
router.patch('/:id/review', updateInvestmentProjectReviewStatus);
router.delete('/:id', deleteInvestmentProject);

export default router;
