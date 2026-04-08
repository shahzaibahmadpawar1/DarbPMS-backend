import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model';
import { RegisterRequest, LoginRequest, AuthResponse, AuthRequest, Department, UserResponse, UserRole, UserStatus, UserType } from '../types';
import { normalizeUserRole } from '../utils/roles';

const validRoles: UserRole[] = ['super_admin', 'department_manager', 'supervisor', 'employee'];
const validDepartments: Department[] = ['investment', 'franchise'];
const validStatuses: UserStatus[] = ['active', 'inactive'];
const emailNoiseRegex = /[\s\u200B-\u200D\uFEFF]+/g;

const isValidEmail = (value: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const normalizeEmail = (value: unknown): string | null => {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = String(value)
        .trim()
        .toLowerCase()
        .replace(emailNoiseRegex, '');

    return normalized || null;
};

const normalizeUserType = (value: unknown): UserType => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'external' ? 'external' : 'internal';
};

const normalizeUserStatus = (value: unknown): UserStatus => {
    const normalized = String(value || '').trim().toLowerCase();
    return validStatuses.includes(normalized as UserStatus) ? (normalized as UserStatus) : 'active';
};

const normalizeDepartment = (value: unknown): Department | null => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'frenchise') {
        return 'franchise';
    }

    return validDepartments.includes(normalized as Department) ? (normalized as Department) : null;
};


export class AuthController {
    private static toUserResponse(user: any): UserResponse {
        return {
            id: user.id,
            username: user.username,
            role: user.role,
            department: user.department,
            station_id: user.station_id,
            full_name: user.full_name ?? null,
            email: user.email ?? null,
            phone: user.phone ?? null,
            user_type: user.user_type ?? 'internal',
            status: user.status ?? 'active',
            station_codes: Array.isArray(user.station_codes) ? user.station_codes : [],
            created_at: user.created_at,
            updated_at: user.updated_at
        };
    }

    // Register a new user
    static async register(req: Request, res: Response): Promise<void> {
        try {
            const { username, password, full_name, email, phone } = req.body as RegisterRequest;

            // Validate input
            if (!username || !password) {
                res.status(400).json({
                    success: false,
                    message: 'Username and password are required'
                } as AuthResponse);
                return;
            }

            // Validate username length
            if (username.length < 3 || username.length > 50) {
                res.status(400).json({
                    success: false,
                    message: 'Username must be between 3 and 50 characters'
                } as AuthResponse);
                return;
            }

            // Validate password length
            if (password.length < 6) {
                res.status(400).json({
                    success: false,
                    message: 'Password must be at least 6 characters long'
                } as AuthResponse);
                return;
            }

            const sanitizedEmail = normalizeEmail(email);
            if (sanitizedEmail && !isValidEmail(sanitizedEmail)) {
                res.status(400).json({
                    success: false,
                    message: 'Please provide a valid email address'
                } as AuthResponse);
                return;
            }

            // Create user with plain text password (INSECURE!)
            const role = normalizeUserRole(req.body?.role);
            const userRole: UserRole = validRoles.includes(role as UserRole) ? role : 'employee';
            const department = normalizeDepartment(req.body?.department);

            if (userRole !== 'super_admin' && !department) {
                res.status(400).json({
                    success: false,
                    message: 'Department is required for non-super-admin users'
                } as AuthResponse);
                return;
            }

            const user = await UserModel.create(
                username,
                password,
                userRole,
                userRole === 'super_admin' ? null : department,
                null,
                full_name ? String(full_name).trim() : null,
                sanitizedEmail,
                phone ? String(phone).trim() : null,
                'internal',
                'active',
                []
            );

            // Return user data without password
            const userResponse: UserResponse = AuthController.toUserResponse(user);

            // Generate real JWT token
            const jwtSecret = process.env.JWT_SECRET;
            if (!jwtSecret) {
                throw new Error('JWT_SECRET is not defined in environment variables');
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role, department: user.department },
                jwtSecret,
                { expiresIn: '24h' }
            );

            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                token,
                user: userResponse
            } as AuthResponse);
        } catch (error: any) {
            console.error('Registration error:', error);

            if (error.message === 'Username already exists') {
                res.status(409).json({
                    success: false,
                    message: 'Username already exists'
                } as AuthResponse);
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Internal server error during registration'
            } as AuthResponse);
        }
    }

    // Login user
    static async login(req: Request, res: Response): Promise<void> {
        try {
            const { username, password } = req.body as LoginRequest;

            // Validate input
            if (!username || !password) {
                res.status(400).json({
                    success: false,
                    message: 'Username and password are required'
                } as AuthResponse);
                return;
            }

            // Find user
            const user = await UserModel.findByUsername(username);
            if (!user) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid username or password'
                } as AuthResponse);
                return;
            }

            // Verify password (plain text comparison - INSECURE!)
            if (password !== user.password) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid username or password'
                } as AuthResponse);
                return;
            }

            if (user.status !== 'active') {
                res.status(403).json({
                    success: false,
                    message: 'Your account is inactive. Please contact the administrator.'
                } as AuthResponse);
                return;
            }

            // Return user data without password
            const userResponse: UserResponse = AuthController.toUserResponse(user);

            // Generate real JWT token
            const jwtSecret = process.env.JWT_SECRET;
            if (!jwtSecret) {
                throw new Error('JWT_SECRET is not defined in environment variables');
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role, department: user.department },
                jwtSecret,
                { expiresIn: '24h' }
            );

            res.status(200).json({
                success: true,
                message: 'Login successful',
                token,
                user: userResponse
            } as AuthResponse);
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during login'
            } as AuthResponse);
        }
    }

    // Get current user profile
    static async getProfile(req: AuthRequest, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
                return;
            }

            // Find user by ID
            const user = await UserModel.findById(req.user.id);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            // Return user data without password
            const userResponse: UserResponse = AuthController.toUserResponse(user);

            res.status(200).json({
                success: true,
                message: 'Profile retrieved successfully',
                user: userResponse
            });
        } catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    // Get all users (admin only)
    static async getAllUsers(_req: AuthRequest, res: Response): Promise<void> {
        try {
            const users = await UserModel.findAll();
            res.status(200).json({ success: true, data: users });
        } catch (error) {
            console.error('Get all users error:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    // Create a new user (admin only)
    static async createUser(req: AuthRequest, res: Response): Promise<void> {
        try {
            const {
                username,
                password,
                role,
                department,
                full_name,
                email,
                phone,
                user_type,
                status,
                station_codes,
            } = req.body;

            if (!username || !password) {
                res.status(400).json({ success: false, message: 'Username and password are required' });
                return;
            }
            if (username.length < 3 || username.length > 50) {
                res.status(400).json({ success: false, message: 'Username must be between 3 and 50 characters' });
                return;
            }
            if (password.length < 6) {
                res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
                return;
            }

            const userType = normalizeUserType(user_type);
            const userStatus = normalizeUserStatus(status);
            const fullName = full_name ? String(full_name).trim() : null;
            const userEmail = email ? String(email).trim().toLowerCase() : null;
            const userPhone = phone ? String(phone).trim() : null;
            const stationCodes = Array.isArray(station_codes)
                ? Array.from(new Set(station_codes.map((code: unknown) => String(code || '').trim()).filter((code: string) => code.length > 0)))
                : [];

            if (userEmail && !isValidEmail(userEmail)) {
                res.status(400).json({ success: false, message: 'Please provide a valid email address' });
                return;
            }

            let userRole: UserRole = validRoles.includes(role) ? role : 'employee';
            let normalizedDepartment = normalizeDepartment(department);

            if (userType === 'external') {
                userRole = 'employee';
                normalizedDepartment = null;

                if (stationCodes.length === 0) {
                    res.status(400).json({
                        success: false,
                        message: 'At least one station is required for external users'
                    });
                    return;
                }
            } else {
                if (userRole !== 'super_admin' && !normalizedDepartment) {
                    res.status(400).json({
                        success: false,
                        message: 'Department is required for non-super-admin users'
                    });
                    return;
                }
            }

            const user = await UserModel.create(
                username,
                password,
                userRole,
                userRole === 'super_admin' ? null : normalizedDepartment,
                null,
                fullName,
                userEmail,
                userPhone,
                userType,
                userStatus,
                stationCodes
            );
            const userResponse: UserResponse = AuthController.toUserResponse(user);
            res.status(201).json({ success: true, message: 'User created successfully', user: userResponse });
        } catch (error: any) {
            if (error.message === 'Username already exists') {
                res.status(409).json({ success: false, message: 'Username already exists' });
                return;
            }

            if (error.code === '23505' && typeof error?.constraint === 'string' && error.constraint.includes('email')) {
                res.status(409).json({ success: false, message: 'Email already exists' });
                return;
            }

            console.error('Create user error:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    // Update user status (admin only)
    static async updateUserStatus(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { status } = req.body || {};

            const rawStatus = String(status || '').trim().toLowerCase();
            if (!validStatuses.includes(rawStatus as UserStatus)) {
                res.status(400).json({ success: false, message: 'Valid status is required (active or inactive)' });
                return;
            }

            const normalizedStatus = rawStatus as UserStatus;

            if (req.user?.id === id && normalizedStatus === 'inactive') {
                res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
                return;
            }

            const updatedUser = await UserModel.updateStatus(id, normalizedStatus);
            if (!updatedUser) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'User status updated successfully',
                user: AuthController.toUserResponse(updatedUser),
            });
        } catch (error) {
            console.error('Update user status error:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    // Update user details (admin only)
    static async updateUser(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const existing = await UserModel.findById(id);

            if (!existing) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            const username = req.body?.username !== undefined ? String(req.body.username).trim() : existing.username;
            const password = req.body?.password !== undefined ? String(req.body.password) : existing.password;

            if (!username || !password) {
                res.status(400).json({ success: false, message: 'Username and password are required' });
                return;
            }

            if (username.length < 3 || username.length > 50) {
                res.status(400).json({ success: false, message: 'Username must be between 3 and 50 characters' });
                return;
            }

            if (password.length < 6) {
                res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
                return;
            }

            const userType: UserType = req.body?.user_type !== undefined
                ? normalizeUserType(req.body.user_type)
                : existing.user_type;

            const status: UserStatus = req.body?.status !== undefined
                ? normalizeUserStatus(req.body.status)
                : existing.status;

            if (req.user?.id === id && status === 'inactive') {
                res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
                return;
            }

            const fullName = req.body?.full_name !== undefined
                ? (String(req.body.full_name || '').trim() || null)
                : (existing.full_name ?? null);

            const userEmail = req.body?.email !== undefined
                ? normalizeEmail(req.body.email)
                : normalizeEmail(existing.email);

            if (userEmail && !isValidEmail(userEmail)) {
                res.status(400).json({ success: false, message: 'Please provide a valid email address' });
                return;
            }

            const userPhone = req.body?.phone !== undefined
                ? (String(req.body.phone || '').trim() || null)
                : (existing.phone ?? null);

            let userRole: UserRole = req.body?.role !== undefined
                ? (validRoles.includes(req.body.role) ? req.body.role : existing.role)
                : existing.role;

            let normalizedDepartment: Department | null = req.body?.department !== undefined
                ? normalizeDepartment(req.body.department)
                : existing.department;

            const stationCodes: string[] = req.body?.station_codes !== undefined
                ? (Array.isArray(req.body.station_codes)
                    ? Array.from(new Set(req.body.station_codes.map((code: unknown) => String(code || '').trim()).filter((code: string) => code.length > 0)))
                    : [])
                : (existing.station_codes || []);

            if (userType === 'external') {
                userRole = 'employee';
                normalizedDepartment = null;

                if (stationCodes.length === 0) {
                    res.status(400).json({ success: false, message: 'At least one station is required for external users' });
                    return;
                }
            } else {
                if (userRole === 'super_admin') {
                    normalizedDepartment = null;
                } else if (!normalizedDepartment) {
                    res.status(400).json({ success: false, message: 'Department is required for non-super-admin users' });
                    return;
                }
            }

            const updatedUser = await UserModel.updateById(id, {
                username,
                password,
                role: userRole,
                department: normalizedDepartment,
                station_id: existing.station_id,
                full_name: fullName,
                email: userEmail,
                phone: userPhone,
                user_type: userType,
                status,
                station_codes: userType === 'external' ? stationCodes : [],
            });

            if (!updatedUser) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'User updated successfully',
                user: AuthController.toUserResponse(updatedUser),
            });
        } catch (error: any) {
            if (error.message === 'External user edits require database migration for station assignments') {
                res.status(400).json({ success: false, message: error.message });
                return;
            }

            if (error.code === '23514' && error?.constraint === 'users_email_format_check') {
                res.status(400).json({ success: false, message: 'Please provide a valid email address' });
                return;
            }

            if (error.code === '23514' && error?.constraint === 'users_department_required_for_non_super_admin') {
                res.status(400).json({ success: false, message: 'Department is required for non-super-admin users' });
                return;
            }

            if (error.code === '23514' && error?.constraint === 'users_status_check') {
                res.status(400).json({ success: false, message: 'Invalid user status' });
                return;
            }

            if (error.code === '23514' && error?.constraint === 'users_user_type_check') {
                res.status(400).json({ success: false, message: 'Invalid user type' });
                return;
            }

            if (error.code === '23505' && typeof error?.constraint === 'string' && error.constraint.includes('username')) {
                res.status(409).json({ success: false, message: 'Username already exists' });
                return;
            }

            if (error.code === '23505' && typeof error?.constraint === 'string' && error.constraint.includes('email')) {
                res.status(409).json({ success: false, message: 'Email already exists' });
                return;
            }

            console.error('Update user error:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    // Delete a user (admin only)
    static async deleteUser(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            // Prevent admin from deleting themselves
            if (req.user?.id === id) {
                res.status(400).json({ success: false, message: 'Cannot delete your own account' });
                return;
            }

            const deleted = await UserModel.deleteById(id);
            if (!deleted) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }
            res.status(200).json({ success: true, message: 'User deleted successfully' });
        } catch (error) {
            console.error('Delete user error:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
}
