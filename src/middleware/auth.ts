import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JWTPayload } from '../types';
import { UserModel } from '../models/user.model';

export const authenticateToken = (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): void => {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        res.status(401).json({
            success: false,
            message: 'Access token is required'
        });
        return;
    }

    try {
        // Verify token
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            console.error('AUTH_ERROR: JWT_SECRET is not defined in environment variables');
            res.status(403).json({
                success: false,
                message: 'Server configuration error'
            });
            return;
        }

        const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

        // Attach user data to request
        req.user = {
            id: decoded.id,
            username: decoded.username
        };

        next();
    } catch (error: any) {
        console.error('AUTH_ERROR: Invalid or expired token:', error.message);
        res.status(403).json({
            success: false,
            message: 'Invalid or expired token',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        return;
    }
};

export const requireAdmin = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    if (!req.user?.id) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
    }

    try {
        const user = await UserModel.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            res.status(403).json({ success: false, message: 'Admin access required' });
            return;
        }
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
