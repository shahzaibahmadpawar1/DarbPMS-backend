import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JWTPayload, UserRole } from '../types';
import { UserModel } from '../models/user.model';
import pool from '../config/database';

const roleRank: Record<UserRole, number> = {
    employee: 1,
    supervisor: 2,
    department_manager: 3,
    super_admin: 4
};

type Capability = 'view' | 'create' | 'edit' | 'delete' | 'manage_users';

const capabilityMinimumRole: Record<Capability, UserRole> = {
    view: 'employee',
    create: 'supervisor',
    edit: 'department_manager',
    delete: 'department_manager',
    manage_users: 'super_admin'
};

const normalizeDepartment = (value: unknown): 'investment' | 'franchise' | null => {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'frenchise') {
        return 'franchise';
    }

    if (normalized === 'investment') {
        return 'investment';
    }

    if (normalized === 'franchise') {
        return 'franchise';
    }

    return null;
};

const hydrateUserFromDb = async (req: AuthRequest): Promise<boolean> => {
    if (!req.user?.id) {
        return false;
    }

    const user = await UserModel.findById(req.user.id);
    if (!user) {
        return false;
    }

    req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        department: user.department
    };

    return true;
};

const getStationDepartment = async (stationCode: string): Promise<'investment' | 'franchise' | null> => {
    const result = await pool.query(
        'SELECT station_type_code FROM station_information WHERE station_code = $1 LIMIT 1',
        [stationCode]
    );

    if (!result.rows.length) {
        return null;
    }

    return normalizeDepartment(result.rows[0].station_type_code);
};

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
            username: decoded.username,
            role: decoded.role,
            department: decoded.department
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

export const requireSuperAdmin = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    if (!req.user?.id) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
    }

    try {
        const hydrated = await hydrateUserFromDb(req);
        if (!hydrated || req.user?.role !== 'super_admin') {
            res.status(403).json({ success: false, message: 'Super admin access required' });
            return;
        }
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const requireRoleAtLeast = (minimumRole: UserRole) => {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user?.id) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }

        try {
            const hydrated = await hydrateUserFromDb(req);
            if (!hydrated || !req.user) {
                res.status(401).json({ success: false, message: 'User not found' });
                return;
            }

            if (roleRank[req.user.role] < roleRank[minimumRole]) {
                res.status(403).json({ success: false, message: 'Insufficient role privileges' });
                return;
            }

            next();
        } catch {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    };
};

export const requireCapability = (capability: Capability) => {
    return requireRoleAtLeast(capabilityMinimumRole[capability]);
};

export const requireDepartmentMatchFromBody = (departmentFieldName = 'departmentType') => {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const hydrated = await hydrateUserFromDb(req);
            if (!hydrated || !req.user) {
                res.status(401).json({ success: false, message: 'User not found' });
                return;
            }

            if (req.user.role === 'super_admin') {
                next();
                return;
            }

            const requestedDepartment = normalizeDepartment((req.body as any)?.[departmentFieldName]);
            if (!requestedDepartment) {
                res.status(400).json({ success: false, message: 'A valid department is required' });
                return;
            }

            if (requestedDepartment !== req.user.department) {
                res.status(403).json({ success: false, message: 'Cross-department access is not allowed' });
                return;
            }

            next();
        } catch {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    };
};

export const requireStationDepartmentAccess = (
    options: {
        bodyField?: string;
        paramField?: string;
    } = {}
) => {
    const { bodyField = 'stationCode', paramField = 'stationCode' } = options;

    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const hydrated = await hydrateUserFromDb(req);
            if (!hydrated || !req.user) {
                res.status(401).json({ success: false, message: 'User not found' });
                return;
            }

            if (req.user.role === 'super_admin') {
                next();
                return;
            }

            const bodyStationCode = (req.body as any)?.[bodyField];
            const paramStationCode = (req.params as any)?.[paramField];
            const stationCode = bodyStationCode || paramStationCode;

            if (!stationCode) {
                res.status(400).json({ success: false, message: 'Station code is required for department scoping' });
                return;
            }

            const stationDepartment = await getStationDepartment(stationCode);
            if (!stationDepartment) {
                res.status(403).json({ success: false, message: 'Station is outside allowed department scope' });
                return;
            }

            if (req.user.department !== stationDepartment) {
                res.status(403).json({ success: false, message: 'Cross-department access is not allowed' });
                return;
            }

            next();
        } catch {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    };
};

export const requireDepartmentAccessByLookup = (lookupQuery: string, idParam = 'id') => {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const hydrated = await hydrateUserFromDb(req);
            if (!hydrated || !req.user) {
                res.status(401).json({ success: false, message: 'User not found' });
                return;
            }

            if (req.user.role === 'super_admin') {
                next();
                return;
            }

            const identifier = (req.params as any)?.[idParam];
            if (!identifier) {
                res.status(400).json({ success: false, message: 'Resource identifier is required' });
                return;
            }

            const result = await pool.query(lookupQuery, [identifier]);
            if (!result.rows.length) {
                res.status(404).json({ success: false, message: 'Resource not found' });
                return;
            }

            const resourceDepartment = normalizeDepartment(result.rows[0].department);
            if (!resourceDepartment || resourceDepartment !== req.user.department) {
                res.status(403).json({ success: false, message: 'Cross-department access is not allowed' });
                return;
            }

            next();
        } catch {
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    };
};
