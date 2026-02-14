import { Router } from 'express';
import {
    createCamera,
    getAllCameras,
    getCameraBySerialNumber,
    updateCamera,
    deleteCamera,
    getCamerasByStation
} from '../controllers/cameras.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/', createCamera);
router.get('/', getAllCameras);
router.get('/station/:stationCode', getCamerasByStation);
router.get('/:serialNumber', getCameraBySerialNumber);
router.put('/:serialNumber', updateCamera);
router.delete('/:serialNumber', deleteCamera);

export default router;
