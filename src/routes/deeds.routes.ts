import { Router } from 'express';
import {
    createDeed, getAllDeeds, getDeedsByStation, updateDeed, deleteDeed
} from '../controllers/deeds.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/', createDeed);
router.get('/', getAllDeeds);
router.get('/station/:stationCode', getDeedsByStation);
router.put('/:id', updateDeed);
router.delete('/:id', deleteDeed);

export default router;
