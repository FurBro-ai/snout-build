import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { NITRO_PLAN } from '../../../shared/constants.ts';
import type { PaymentRecord, PaymentStatus, SubscriptionRecord } from '../../../shared/types.ts';
import { ENV } from '../config/env.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitToUser } from '../websocket/socketGateway.ts';

export interface PlategaRuntimeConfig {
  apiUrl: string;
  merchantId: string;
  secret: string;
  webhookSecret: string;
  sandboxMode: boolean;
  source: 'database' | 'environment' | 'none';
}

/**
 * Resolves Platega credentials with admin-console overrides taking priority over
 * environment variables. This lets operators connect Platega directly from the
 * Admin Console → Integrations tab without a redeploy.
 */
export function getPlategaRuntimeConfig(): PlategaRuntimeConfig {
  const override = dbStore.state.platformConfig?.platega;
  const merchantId = (override?.merchantId || ENV.PLATEGA_MERCHANT_ID || '').trim();
  const secret = (override?.secret || ENV.PLATEGA_SECRET || '').trim();
  const webhookSecret = (
    override?.webhookSecret ||
    ENV.PLATEGA_WEBHOOK_SECRET ||
    ENV.PLATEGA_SECRET ||
    ''
  ).trim();
  const apiUrl = (override?.apiUrl || ENV.PLATEGA_API_URL || 'https://app.platega.io').replace(/\/+$/, '');
  return {
    apiUrl,
    merchantId,
    secret,
    webhookSecret,
    sandboxMode: Boolean(override?.sandboxMode) || process.env.PLATEGA_SANDBOX_MODE === 'true',
    source: override?.merchantId ? 'database' : ENV.PLATEGA_MERCHANT_ID ? 'environment' : 'none',
  };
}

export function isPlategaConfiguredNow(): boolean {
  const cfg = getPlategaRuntimeConfig();
  return Boolean(cfg.merchantId && cfg.secret);
}

export function getMissingPlategaVarsNow(): string[] {
  const cfg = getPlategaRuntimeConfig();
  const missing: string[] = [];
  if (!cfg.merchantId) missing.push('PLATEGA_MERCHANT_ID');
  if (!cfg.secret) missing.push('PLATEGA_SECRET');
  return missing;
}

export function getNitroPriceUsd(): number {
  const configured = Number(dbStore.state.platformConfig?.nitroPriceUsd);
  return Number.isFinite(configured) && configured > 0 ? configured : NITRO_PLAN.priceUsd;
}

export function getPlategaWebhookUrl(): string {
  return `${ENV.APP_URL.replace(/\/+$/, '')}/api/payments/platega/webhook`;
}

export interface PlategaCreateTransactionResponse {
  paymentMethod?: string | number;
  transactionId?: string;
  redirect?: string;
  status?: string;
  merchantId?: string;
}

export interface PlategaWebhookPayload {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod?: number;
  payload?: string;
}

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPlategaWebhookHeaders(headers: Record<string, string | string[] | undefined>): {
  valid: boolean;
  reason?: string;
} {
  const cfg = getPlategaRuntimeConfig();
  if (!isPlategaConfiguredNow()) {
    return { valid: false, reason: 'Platega merchant credentials are not configured on the server' };
  }
  const merchantHeader = String(headers['x-merchantid'] || headers['X-MerchantId'] || '');
  const secretHeader = String(headers['x-secret'] || headers['X-Secret'] || '');

  if (!merchantHeader || !secretHeader) {
    return { valid: false, reason: 'Missing X-MerchantId or X-Secret webhook authentication headers' };
  }
  if (!safeTimingEqual(merchantHeader, cfg.merchantId)) {
    return { valid: false, reason: 'Invalid X-MerchantId' };
  }
  if (!safeTimingEqual(secretHeader, cfg.webhookSecret || cfg.secret)) {
    return { valid: false, reason: 'Invalid X-Secret' };
  }
  return { valid: true };
}

export async function createPlategaNitroCheckout(params: {
  userId: string;
  paymentMethod?: number;
  returnOrigin?: string;
}): Promise<{
  ok: boolean;
  payment?: PaymentRecord;
  redirectUrl?: string;
  error?: string;
  missingVars?: string[];
}> {
  const orderId = `snout-nitro-${uuidv4()}`;
  const transactionUuid = uuidv4();
  const baseOrigin = (params.returnOrigin || ENV.APP_URL).replace(/\/+$/, '');
  const returnUrl = `${baseOrigin}/?view=nitro&paymentStatus=returned&orderId=${orderId}`;
  const failedUrl = `${baseOrigin}/?view=nitro&paymentStatus=failed&orderId=${orderId}`;
  const cfg = getPlategaRuntimeConfig();
  const priceUsd = getNitroPriceUsd();

  if (!isPlategaConfiguredNow()) {
    return {
      ok: false,
      error: 'Platega merchant credentials are not configured. Connect them in Admin Console → Integrations.',
      missingVars: getMissingPlategaVarsNow(),
    };
  }

  const requestBody = {
    id: transactionUuid,
    paymentMethod: params.paymentMethod ?? 2,
    paymentDetails: {
      amount: priceUsd,
      currency: NITRO_PLAN.currency,
    },
    description: `SNOUT NITRO — Monthly Subscription ($${priceUsd.toFixed(2)} USD / month)`,
    return: returnUrl,
    failedUrl,
    payload: orderId,
  };

  try {
    const response = await fetch(`${cfg.apiUrl}/transaction/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MerchantId': cfg.merchantId,
        'X-Secret': cfg.secret,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(12000),
    });

    const data = (await response.json().catch(() => ({}))) as PlategaCreateTransactionResponse & {
      message?: string;
      error?: string;
    };

    if (!response.ok || !data.redirect) {
      dbStore.addAuditLog({
        serverId: null,
        actorId: params.userId,
        action: 'PLATEGA_CREATE_FAILED',
        targetType: 'PAYMENT',
        targetId: orderId,
        details: `Platega HTTP ${response.status}: ${data.message || data.error || 'Missing redirect URL'}`,
      });
      return {
        ok: false,
        error: data.message || data.error || `Platega API returned HTTP ${response.status}`,
      };
    }

    const now = new Date().toISOString();
    const payment: PaymentRecord = {
      id: uuidv4(),
      orderId,
      plategaTransactionId: data.transactionId || transactionUuid,
      userId: params.userId,
      planId: NITRO_PLAN.id,
      amount: priceUsd,
      currency: NITRO_PLAN.currency,
      status: 'PENDING',
      paymentMethod: Number(params.paymentMethod ?? 2),
      redirectUrl: data.redirect,
      providerResponse: data as Record<string, unknown>,
      webhookEvents: [],
      createdAt: now,
      confirmedAt: null,
    };

    dbStore.state.payments.unshift(payment);
    ensurePendingSubscription(params.userId, payment.id);
    dbStore.addAuditLog({
      serverId: null,
      actorId: params.userId,
      action: 'PLATEGA_PAYMENT_CREATED',
      targetType: 'PAYMENT',
      targetId: payment.id,
      details: `Created $${priceUsd.toFixed(2)} USD Nitro checkout (${payment.plategaTransactionId})`,
    });
    dbStore.save();

    return { ok: true, payment, redirectUrl: data.redirect };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to reach Platega API: ${(err as Error).message}`,
    };
  }
}

export async function fetchPlategaTransactionStatus(transactionId: string) {
  if (!isPlategaConfiguredNow()) return null;
  const cfg = getPlategaRuntimeConfig();
  try {
    const resp = await fetch(`${cfg.apiUrl}/transaction/${encodeURIComponent(transactionId)}`, {
      method: 'GET',
      headers: {
        'X-MerchantId': cfg.merchantId,
        'X-Secret': cfg.secret,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function ensurePendingSubscription(userId: string, paymentId: string) {
  const priceUsd = getNitroPriceUsd();
  const existing = dbStore.state.subscriptions.find((s) => s.userId === userId);
  if (!existing) {
    const sub: SubscriptionRecord = {
      id: uuidv4(),
      userId,
      planId: NITRO_PLAN.id,
      status: 'PENDING',
      priceUsd,
      currency: NITRO_PLAN.currency,
      interval: 'month',
      autoRenewSupported: false,
      renewalDisclosure:
        'Manual monthly renewal via Platega. You will be notified before your 30-day period ends to renew.',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelledAt: null,
      lastPaymentId: paymentId,
      updatedAt: new Date().toISOString(),
    };
    dbStore.state.subscriptions.push(sub);
  } else if (existing.status !== 'ACTIVE') {
    existing.status = 'PENDING';
    existing.lastPaymentId = paymentId;
    existing.updatedAt = new Date().toISOString();
  }
}

export function activateNitroForUser(userId: string, paymentId: string) {
  const user = dbStore.state.users.find((u) => u.id === userId);
  if (!user) return;

  const now = new Date();
  let sub = dbStore.state.subscriptions.find((s) => s.userId === userId);
  const existingEnd =
    sub?.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() > now.getTime()
      ? new Date(sub.currentPeriodEnd)
      : now;
  const nextEnd = new Date(existingEnd.getTime() + NITRO_PLAN.durationDays * 24 * 60 * 60 * 1000);

  if (!sub) {
    sub = {
      id: uuidv4(),
      userId,
      planId: NITRO_PLAN.id,
      status: 'ACTIVE',
      priceUsd: getNitroPriceUsd(),
      currency: NITRO_PLAN.currency,
      interval: 'month',
      autoRenewSupported: false,
      renewalDisclosure:
        'Manual monthly renewal via Platega. You will be notified before your 30-day period ends to renew.',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: nextEnd.toISOString(),
      cancelledAt: null,
      lastPaymentId: paymentId,
      updatedAt: now.toISOString(),
    };
    dbStore.state.subscriptions.push(sub);
  } else {
    sub.status = 'ACTIVE';
    sub.currentPeriodStart = sub.currentPeriodStart || now.toISOString();
    sub.currentPeriodEnd = nextEnd.toISOString();
    sub.cancelledAt = null;
    sub.lastPaymentId = paymentId;
    sub.updatedAt = now.toISOString();
  }

  user.isNitro = true;
  user.updatedAt = now.toISOString();

  const notif = dbStore.addNotification({
    userId,
    type: 'NITRO_PAYMENT',
    title: 'SNOUT NITRO Activated',
    body: `Your $${getNitroPriceUsd().toFixed(2)} USD/month SNOUT NITRO subscription is now active for 30 days.`,
    linkUrl: '/nitro',
  });

  dbStore.save();
  emitToUser(userId, 'nitro:updated', { isNitro: true, subscription: sub });
  emitToUser(userId, 'notification:new', notif);
}

export function revokeNitroForUser(userId: string, reasonStatus: 'CANCELLED' | 'EXPIRED') {
  const user = dbStore.state.users.find((u) => u.id === userId);
  if (user) {
    user.isNitro = false;
    user.profileDecoration = 'none';
    user.animatedAvatarUrl = null;
    user.updatedAt = new Date().toISOString();
  }
  const sub = dbStore.state.subscriptions.find((s) => s.userId === userId);
  if (sub) {
    sub.status = reasonStatus;
    sub.updatedAt = new Date().toISOString();
  }
  dbStore.save();
  emitToUser(userId, 'nitro:updated', { isNitro: false, subscription: sub || null });
}

export function processPlategaWebhookPayload(payload: PlategaWebhookPayload): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (!payload || !payload.id || !payload.status) {
    return { statusCode: 400, body: { error: 'Invalid Platega webhook payload' } };
  }

  const payment = dbStore.state.payments.find(
    (p) => p.plategaTransactionId === payload.id || p.orderId === payload.payload || p.id === payload.id
  );

  if (!payment) {
    return { statusCode: 404, body: { error: 'Matching payment transaction not found' } };
  }

  // Record incoming webhook for audit trail
  payment.webhookEvents.push({
    receivedAt: new Date().toISOString(),
    status: payload.status,
    rawPayload: payload,
  });

  // Duplicate webhook idempotency protection
  if (payment.status === 'CONFIRMED' && payload.status === 'CONFIRMED') {
    dbStore.save();
    return {
      statusCode: 200,
      body: { ok: true, idempotent: true, message: 'Duplicate CONFIRMED webhook ignored' },
    };
  }

  // Verify amount and currency strictly match the configured Nitro plan price
  const normalizedCurrency = String(payload.currency || '').toUpperCase();
  const numericAmount = Number(payload.amount);
  const expectedPrice = getNitroPriceUsd();
  if (normalizedCurrency !== NITRO_PLAN.currency || numericAmount < expectedPrice - 0.001) {
    payment.status = 'FAILED';
    dbStore.addAuditLog({
      serverId: null,
      actorId: payment.userId,
      action: 'PLATEGA_AMOUNT_MISMATCH',
      targetType: 'PAYMENT',
      targetId: payment.id,
      details: `Rejected webhook with ${numericAmount} ${normalizedCurrency} (expected ${expectedPrice} USD)`,
    });
    dbStore.save();
    return {
      statusCode: 400,
      body: { error: 'Payment amount or currency mismatch' },
    };
  }

  const incomingStatus = String(payload.status).toUpperCase() as PaymentStatus;

  if (incomingStatus === 'CONFIRMED') {
    payment.status = 'CONFIRMED';
    payment.confirmedAt = new Date().toISOString();
    activateNitroForUser(payment.userId, payment.id);
    dbStore.addAuditLog({
      serverId: null,
      actorId: payment.userId,
      action: 'NITRO_ACTIVATED',
      targetType: 'PAYMENT',
      targetId: payment.id,
      details: `Verified Platega payment ${payment.plategaTransactionId} ($${expectedPrice.toFixed(2)} USD)`,
    });
    dbStore.save();
    return { statusCode: 200, body: { ok: true, status: 'CONFIRMED', nitroActivated: true } };
  }

  if (incomingStatus === 'CANCELED' || incomingStatus === 'FAILED') {
    payment.status = incomingStatus;
    dbStore.addAuditLog({
      serverId: null,
      actorId: payment.userId,
      action: 'PLATEGA_PAYMENT_FAILED',
      targetType: 'PAYMENT',
      targetId: payment.id,
      details: `Payment marked ${incomingStatus}`,
    });
    dbStore.save();
    return { statusCode: 200, body: { ok: true, status: incomingStatus } };
  }

  if (incomingStatus === 'CHARGEBACKED') {
    payment.status = 'CHARGEBACKED';
    revokeNitroForUser(payment.userId, 'CANCELLED');
    dbStore.addAuditLog({
      serverId: null,
      actorId: payment.userId,
      action: 'PLATEGA_CHARGEBACK_REVOKED',
      targetType: 'PAYMENT',
      targetId: payment.id,
      details: 'Nitro revoked due to Platega CHARGEBACKED webhook',
    });
    dbStore.save();
    return { statusCode: 200, body: { ok: true, status: 'CHARGEBACKED', nitroRevoked: true } };
  }

  if (incomingStatus === 'DISPUTED') {
    payment.status = 'DISPUTED';
    dbStore.save();
    return { statusCode: 200, body: { ok: true, status: 'DISPUTED' } };
  }

  dbStore.save();
  return { statusCode: 200, body: { ok: true, status: incomingStatus } };
}
