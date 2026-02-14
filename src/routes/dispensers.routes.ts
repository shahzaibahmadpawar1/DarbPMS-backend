import { Router } from 'express';
import { createDispenser, getAllDispensers, getDispenserBySerialNumber, updateDispenser, deleteDispenser, getDispensersByStation } from '../controllers/dispensers.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

router.post('/', createDispenser);
router.get('/', getAllDispensers);
router.get('/station/:stationCode', getDispensersByStation);
router.get('/:serialNumber', getDispenserBySerialNumber);
router.put('/:serialNumber', updateDispenser);
router.delete('/:serialNumber', deleteDispenser);

export default router;
