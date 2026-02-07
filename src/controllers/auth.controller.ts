import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model';
import { RegisterRequest, LoginRequest, AuthResponse, AuthRequest, UserResponse } from '../types';

const SALT_ROUNDS = 10;

export class AuthController {
    // Register a new user
    static async register(req: Request, res: Response): Promise<void> {
        try {
            const { username, password } = req.body as RegisterRequest;

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

            // Hash password
            const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

            // Create user
            const user = await UserModel.create(username, passwordHash);

            // Generate JWT token
            const jwtSecret = process.env.JWT_SECRET;
            if (!jwtSecret) {
                throw new Error('JWT_SECRET is not defined');
            }

            const token = jwt.sign(
                { id: user.id, username: user.username },
                jwtSecret,
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            // Return user data without password
            const userResponse: UserResponse = {
                id: user.id,
                username: user.username,
                created_at: user.created_at,
                updated_at: user.updated_at
            };

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

            // Verify password
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid username or password'
                } as AuthResponse);
                return;
            }

            // Generate JWT token
            const jwtSecret = process.env.JWT_SECRET;
            if (!jwtSecret) {
                throw new Error('JWT_SECRET is not defined');
            }

            const token = jwt.sign(
                { id: user.id, username: user.username },
                jwtSecret,
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            // Return user data without password
            const userResponse: UserResponse = {
                id: user.id,
                username: user.username,
                created_at: user.created_at,
                updated_at: user.updated_at
            };

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
            const userResponse: UserResponse = {
                id: user.id,
                username: user.username,
                created_at: user.created_at,
                updated_at: user.updated_at
            };

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
}
