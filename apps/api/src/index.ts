import { Hono } from 'hono';

type Bindings = {
  APP_ENV: string;
  APP_NAME: string;
  DATABASE_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({
  ok: true,
  service: 'ifarm-security-api',
  environment: c.env.APP_ENV,
  timestamp: new Date().toISOString()
}));

app.get('/api/v1/system/status', (c) => c.json({
  product: c.env.APP_NAME,
  modules: ['identity','map','devices','events','incidents','assets','community'],
  databaseConfigured: Boolean(c.env.DATABASE_URL),
  governmentIntegration: false,
  biometricMatching: false
}));

export default app;
