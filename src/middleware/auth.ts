import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JWTPayload } from '../types';

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
