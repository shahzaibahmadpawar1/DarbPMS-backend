import { Router } from 'express';
import {
    createOwner, getAllOwners, getOwnersByStation, updateOwner, deleteOwner
} from '../controllers/owners.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/', createOwner);
router.get('/', getAllOwners);
router.get('/station/:stationCode', getOwnersByStation);
router.put('/:id', updateOwner);
router.delete('/:id', deleteOwner);

export default router;
