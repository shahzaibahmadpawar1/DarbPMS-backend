export const isSchemaCompatibilityError = (error: any): boolean => {
    const code = String(error?.code || '').trim();
    return code === '42P01' || code === '42703' || code === '42883';
};
