import { neon } from '@neondatabase/serverless';

export function createDb(databaseUrl: string) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return neon(databaseUrl);
}
