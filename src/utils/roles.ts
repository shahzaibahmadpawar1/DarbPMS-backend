import { UserRole } from '../types';

const validRoles: UserRole[] = ['super_admin', 'ceo', 'department_manager', 'supervisor', 'employee'];

export function normalizeUserRole(role: unknown): UserRole {
    const normalized = String(role ?? '').trim().toLowerCase();

    if (normalized === 'admin') {
        return 'super_admin';
    }

    if (normalized === 'ceo') {
        return 'ceo';
    }

    if (validRoles.includes(normalized as UserRole)) {
        return normalized as UserRole;
    }

    return 'employee';
}
