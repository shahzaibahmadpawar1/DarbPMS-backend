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
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireDepartmentMatchFromBody, requireStationDepartmentAccess } from '../middleware/auth';

const investmentProjectDepartmentLookup = `
    SELECT (CASE WHEN lower(department_type) = 'frenchise' THEN 'franchise' ELSE lower(department_type) END) AS department
    FROM investment_projects
    WHERE id = $1
    LIMIT 1
`;

const router = Router();
router.use(authenticateToken);

// CRUD
router.post('/', requireCapability('create'), requireDepartmentMatchFromBody('departmentType'), createInvestmentProject);
router.get('/', requireCapability('view'), getAllInvestmentProjects);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getInvestmentProjectsByStation);
router.get('/feasibility-stats', requireCapability('view'), getFeasibilityStats);
router.get('/contract-stats', requireCapability('view'), getContractStats);
router.get('/:id', requireCapability('view'), requireDepartmentAccessByLookup(investmentProjectDepartmentLookup, 'id'), getInvestmentProjectById);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(investmentProjectDepartmentLookup, 'id'), updateInvestmentProject);
router.patch('/:id/review', requireCapability('edit'), requireDepartmentAccessByLookup(investmentProjectDepartmentLookup, 'id'), updateInvestmentProjectReviewStatus);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(investmentProjectDepartmentLookup, 'id'), deleteInvestmentProject);

export default router;
