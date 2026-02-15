import { Router } from 'express';
import {
    createBuildingPermit, getAllBuildingPermits, getBuildingPermitsByStation, updateBuildingPermit, deleteBuildingPermit
} from '../controllers/buildingPermits.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/', createBuildingPermit);
router.get('/', getAllBuildingPermits);
router.get('/station/:stationCode', getBuildingPermitsByStation);
router.put('/:id', updateBuildingPermit);
router.delete('/:id', deleteBuildingPermit);

export default router;
