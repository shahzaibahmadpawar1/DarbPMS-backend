import { Router } from 'express';
import { createTank, getAllTanks, getTankByCode, updateTank, deleteTank, getTanksByStation } from '../controllers/tanks.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

router.post('/', createTank);
router.get('/', getAllTanks);
router.get('/station/:stationCode', getTanksByStation);
router.get('/:tankCode', getTankByCode);
router.put('/:tankCode', updateTank);
router.delete('/:tankCode', deleteTank);

export default router;
