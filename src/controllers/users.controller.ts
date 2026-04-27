import { Response } from 'express';
import pool from '../config/database';
import { AuthRequest, Department } from '../types';

const validDepartments: Department[] = [
    'investment',
    'franchise',
    'it',
    'project',
    'finance',
    'operation',
    'maintanance',
    'hr',
    'realestate',
    'procurement',
    'quality',
    'marketing',
    'property_management',
    'legal',
    'government_relations',
    'safety',
];

const departmentAliases: Record<string, Department> = {
    investment: 'investment',
    franchise: 'franchise',
    frenchise: 'franchise',
    it: 'it',
    project: 'project',
    finance: 'finance',
    operation: 'operation',
    operations: 'operation',
    maintanance: 'maintanance',
    maintenance: 'maintanance',
    hr: 'hr',
    realestate: 'realestate',
    real_estate: 'realestate',
    procurement: 'procurement',
    quality: 'quality',
    marketing: 'marketing',
    property_management: 'property_management',
    propertymanagement: 'property_management',
    legal: 'legal',
    government_relations: 'government_relations',
    governmentrelations: 'government_relations',
    safety: 'safety',
};

const normalizeDepartment = (value: unknown): Department | null => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
    return departmentAliases[normalized] ?? (validDepartments.includes(normalized as Department) ? (normalized as Department) : null);
};

export class UsersController {
    static async getDepartmentManagers(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const department = normalizeDepartment(req.query?.department);
            if (!department) {
                res.status(400).json({ error: 'department is required' });
                return;
            }

            const result = await pool.query(
                `
                    SELECT id, username, department
                    FROM users
                    WHERE role = 'department_manager'
                      AND department = $1
                    ORDER BY username ASC
                `,
                [department],
            );

            res.status(200).json({ data: result.rows });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to fetch department managers', details: error.message });
        }
    }
}

