import crypto from 'crypto';

// Generate a persistent fallback JWT secret per server instance if env var is unset
const fallbackJwtSecret = crypto.randomBytes(48).toString('hex');

export const ENV = {
  PORT: Number(process.env.PORT || 3000),
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  JWT_SECRET: process.env.JWT_SECRET || fallbackJwtSecret,
  ADMIN_ALLOWED_IPS: process.env.ADMIN_ALLOWED_IPS || '',
  TURN_URLS: process.env.TURN_URLS || '',
  TURN_SECRET: process.env.TURN_SECRET || '',
  PLATEGA_API_URL: (process.env.PLATEGA_API_URL || 'https://app.platega.io').replace(/\/+$/, ''),
  PLATEGA_MERCHANT_ID: process.env.PLATEGA_MERCHANT_ID || '',
  PLATEGA_SECRET: process.env.PLATEGA_SECRET || process.env.PLATEGA_API_KEY || '',
  PLATEGA_WEBHOOK_SECRET: process.env.PLATEGA_WEBHOOK_SECRET || process.env.PLATEGA_SECRET || '',
};

export function isPlategaConfigured(): boolean {
  return Boolean(ENV.PLATEGA_MERCHANT_ID && ENV.PLATEGA_SECRET);
}

export function getMissingPlategaVars(): string[] {
  const missing: string[] = [];
  if (!ENV.PLATEGA_MERCHANT_ID) missing.push('PLATEGA_MERCHANT_ID');
  if (!ENV.PLATEGA_SECRET) missing.push('PLATEGA_SECRET');
  return missing;
}
