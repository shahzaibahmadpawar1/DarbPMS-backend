import { Router } from 'express';
import { createNozzle, getAllNozzles, getNozzleBySerialNumber, updateNozzle, deleteNozzle, getNozzlesByDispenser } from '../controllers/nozzles.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

router.post('/', createNozzle);
router.get('/', getAllNozzles);
router.get('/dispenser/:dispenserSerialNumber', getNozzlesByDispenser);
router.get('/:serialNumber', getNozzleBySerialNumber);
router.put('/:serialNumber', updateNozzle);
router.delete('/:serialNumber', deleteNozzle);

export default router;
