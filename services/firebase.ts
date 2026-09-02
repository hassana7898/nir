// Firebase has been removed from the application.
// Kept as a compatibility module for the existing data service.
// Persistence is now handled by the Chabokan PostgreSQL API.
export const app = null;
export const db = { __postgresStorage: true };
