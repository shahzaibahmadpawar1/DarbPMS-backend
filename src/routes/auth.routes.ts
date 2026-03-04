import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/register', AuthController.register);
router.post('/login', AuthController.login);

// Protected routes (require authentication)
router.get('/profile', authenticateToken, AuthController.getProfile);

// Admin-only routes
router.get('/users', authenticateToken, requireAdmin, AuthController.getAllUsers);
router.post('/users', authenticateToken, requireAdmin, AuthController.createUser);
router.delete('/users/:id', authenticateToken, requireAdmin, AuthController.deleteUser);

export default router;
