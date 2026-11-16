import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { NITRO_PLAN } from '../../../shared/constants.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { ENV } from '../config/env.ts';
import { dbStore } from '../store/dbStore.ts';
import {
  createPlategaNitroCheckout,
  fetchPlategaTransactionStatus,
  getMissingPlategaVarsNow,
  getNitroPriceUsd,
  getPlategaWebhookUrl,
  isPlategaConfiguredNow,
  processPlategaWebhookPayload,
  verifyPlategaWebhookHeaders,
} from './plategaService.ts';

export const paymentsRouter = Router();

paymentsRouter.get('/config', requireAuth, (_req, res) => {
  res.json({
    provider: 'Platega',
    providerDocsUrl: 'https://platega.io/',
    configured: isPlategaConfiguredNow(),
    missingVars: getMissingPlategaVarsNow(),
    webhookUrl: getPlategaWebhookUrl(),
    plan: {
      id: NITRO_PLAN.id,
      name: NITRO_PLAN.name,
      priceUsd: getNitroPriceUsd(),
      currency: NITRO_PLAN.currency,
      interval: NITRO_PLAN.interval,
      formattedPrice: `$${getNitroPriceUsd().toFixed(2)} / month`,
    },
  });
});

paymentsRouter.post('/create', requireAuth, async (req: AuthenticatedRequest, res) => {
  const origin =
    req.headers.origin ||
    (req.headers.host ? `${req.protocol}://${req.headers.host}` : ENV.APP_URL);
  const paymentMethod = Number(req.body?.paymentMethod ?? 2);

  const result = await createPlategaNitroCheckout({
    userId: req.user!.id,
    paymentMethod,
    returnOrigin: origin,
  });

  if (!result.ok) {
    return res.status(result.missingVars ? 503 : 502).json({
      error: result.error,
      configured: isPlategaConfiguredNow(),
      missingVars: result.missingVars || [],
    });
  }

  res.status(201).json({
    payment: result.payment,
    redirectUrl: result.redirectUrl,
  });
});

paymentsRouter.get('/status/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const payment = dbStore.state.payments.find(
    (p) =>
      (p.id === req.params.id || p.orderId === req.params.id || p.plategaTransactionId === req.params.id) &&
      (p.userId === req.user!.id || req.user!.platformRole === 'ADMIN')
  );
  if (!payment) return res.status(404).json({ error: 'Payment record not found' });

  // Optionally poll Platega API server-side if still pending and configured
  if (payment.status === 'PENDING' && payment.plategaTransactionId && isPlategaConfiguredNow()) {
    const remote = await fetchPlategaTransactionStatus(payment.plategaTransactionId);
    if (remote && typeof remote.status === 'string' && remote.status !== 'PENDING') {
      const paymentDetails = (remote.paymentDetails || {}) as { amount?: number; currency?: string };
      processPlategaWebhookPayload({
        id: payment.plategaTransactionId,
        amount: Number(paymentDetails.amount ?? remote.amount ?? payment.amount),
        currency: String(paymentDetails.currency ?? remote.currency ?? payment.currency),
        status: remote.status,
        payload: payment.orderId,
      });
    }
  }

  res.json({ payment });
});

// Official Platega Asynchronous Webhook Callback
paymentsRouter.post('/platega/webhook', (req, res) => {
  const verification = verifyPlategaWebhookHeaders(req.headers);
  if (!verification.valid) {
    return res.status(401).json({ error: verification.reason || 'Unauthorized webhook' });
  }
  const result = processPlategaWebhookPayload(req.body);
  res.status(result.statusCode).json(result.body);
});
