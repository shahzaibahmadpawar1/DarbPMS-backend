import { Request } from 'express';

// User interface matching database schema
export interface User {
    id: string;
    username: string;
    password: string;
    created_at: Date;
    updated_at: Date;
}

// User data without sensitive information
export interface UserResponse {
    id: string;
    username: string;
    created_at: Date;
    updated_at: Date;
}

// Request body for registration
export interface RegisterRequest {
    username: string;
    password: string;
}

// Request body for login
export interface LoginRequest {
    username: string;
    password: string;
}

// Authentication response with JWT token
export interface AuthResponse {
    success: boolean;
    message: string;
    token?: string;
    user?: UserResponse;
}

// Extended Express Request with user data
export interface AuthRequest extends Request {
    user?: {
        id: string;
        username: string;
    };
}

// JWT Payload
export interface JWTPayload {
    id: string;
    username: string;
}
