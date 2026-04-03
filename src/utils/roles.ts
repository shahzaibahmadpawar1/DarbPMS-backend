import { UserRole } from '../types';

const validRoles: UserRole[] = ['super_admin', 'department_manager', 'supervisor', 'employee'];

export function normalizeUserRole(role: unknown): UserRole {
    const normalized = String(role ?? '').trim().toLowerCase();

    if (normalized === 'admin') {
        return 'super_admin';
    }

    if (validRoles.includes(normalized as UserRole)) {
        return normalized as UserRole;
    }

    return 'employee';
}
