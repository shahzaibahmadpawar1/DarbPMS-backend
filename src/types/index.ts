import { Request } from 'express';

export type Department =
    | 'investment'
    | 'franchise'
    | 'it'
    | 'project'
    | 'finance'
    | 'operation'
    | 'maintanance'
    | 'hr'
    | 'realestate'
    | 'procurement'
    | 'quality'
    | 'marketing'
    | 'property_management'
    | 'legal'
    | 'government_relations'
    | 'safety';
export type UserType = 'internal' | 'external';
export type UserStatus = 'active' | 'inactive';

// User roles
export type UserRole = 'super_admin' | 'department_manager' | 'supervisor' | 'employee';

// User interface matching database schema
export interface User {
    id: string;
    username: string;
    password: string;
    role: UserRole;
    department: Department | null;
    station_id: string | null;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    user_type: UserType;
    status: UserStatus;
    station_codes?: string[];
    created_at: Date;
    updated_at: Date;
}

// User data without sensitive information
export interface UserResponse {
    id: string;
    username: string;
    role: UserRole;
    department: Department | null;
    station_id: string | null;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    user_type: UserType;
    status: UserStatus;
    station_codes?: string[];
    created_at: Date;
    updated_at: Date;
}

// Request body for registration
export interface RegisterRequest {
    username: string;
    password: string;
    full_name?: string;
    email?: string;
    phone?: string;
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
        role: UserRole;
        department: Department | null;
        user_type?: UserType;
        status?: UserStatus;
    };
}

// JWT Payload
export interface JWTPayload {
    id: string;
    username: string;
    role: UserRole;
    department: Department | null;
    user_type?: UserType;
    status?: UserStatus;
}
