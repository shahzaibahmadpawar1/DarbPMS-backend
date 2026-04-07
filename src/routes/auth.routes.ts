import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticateToken, requireSuperAdmin } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/register', AuthController.register);
router.post('/login', AuthController.login);

// Protected routes (require authentication)
router.get('/profile', authenticateToken, AuthController.getProfile);

// Super-admin-only routes
router.get('/users', authenticateToken, requireSuperAdmin, AuthController.getAllUsers);
router.post('/users', authenticateToken, requireSuperAdmin, AuthController.createUser);
router.patch('/users/:id/status', authenticateToken, requireSuperAdmin, AuthController.updateUserStatus);
router.delete('/users/:id', authenticateToken, requireSuperAdmin, AuthController.deleteUser);

export default router;
