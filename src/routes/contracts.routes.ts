import { Router } from 'express';
import {
    createContract, getAllContracts, getContractsByStation, updateContract, deleteContract
} from '../controllers/contracts.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/', createContract);
router.get('/', getAllContracts);
router.get('/station/:stationCode', getContractsByStation);
router.put('/:id', updateContract);
router.delete('/:id', deleteContract);

export default router;
