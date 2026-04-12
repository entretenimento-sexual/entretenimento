// functions/src/payments/application/payment-webhook.handler.ts
import { db } from '../../firebaseApp';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'express';

type WebhookStatus =
  | 'pending'
  | 'provider_created'
  | 'paid'
  | 'failed'
  | 'canceled';

interface CheckoutSessionDoc {
  id: string;
  buyerUid: string;
  sellerUid?: string;
  scope: string;
  planId?: string;
  planKey?: string;
  amountCents: number;
  currency: 'BRL';
  provider: string;
  providerSessionId?: string | null;
  checkoutUrl?: string | null;
  status: WebhookStatus;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface EntitlementDoc {
  id: string;
  buyerUid: string;
  sellerUid?: string;
  scope: string;
  resourceId?: string;
  planId?: string;
  active: boolean;
  startsAt: number;
  endsAt?: number | null;
  sourceCheckoutSessionId: string;
}

interface ParsedWebhookPayload {
  accepted: boolean;
  provider: string;
  eventId?: string | null;
  providerSessionId?: string | null;
  checkoutSessionId?: string | null;
  newStatus?: WebhookStatus | null;
  message?: string | null;
}

function isDevEnvironment(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.NODE_ENV !== 'production'
  );
}

function normalizeStatus(raw: string | null | undefined): WebhookStatus | null {
  const normalized = String(raw ?? '').trim().toLowerCase();

  if (
    normalized === 'pending' ||
    normalized === 'provider_created' ||
    normalized === 'paid' ||
    normalized === 'failed' ||
    normalized === 'canceled'
  ) {
    return normalized;
  }

  if (normalized === 'success') {
    return 'paid';
  }

  if (normalized === 'cancel' || normalized === 'cancelled') {
    return 'canceled';
  }

  if (normalized === 'error') {
    return 'failed';
  }

  return null;
}

function normalizeProvider(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase() || 'unknown';
}

function safeJsonBody(req: Request): Record<string, unknown> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }

  return {};
}

async function findCheckoutSession(params: {
  checkoutSessionId?: string | null;
  providerSessionId?: string | null;
}): Promise<
  FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QueryDocumentSnapshot | null
> {
  if (params.checkoutSessionId?.trim()) {
    const ref = db.collection('checkout_sessions').doc(params.checkoutSessionId.trim());
    const snap = await ref.get();

    if (snap.exists) {
      return snap;
    }
  }

  if (params.providerSessionId?.trim()) {
    const querySnap = await db
      .collection('checkout_sessions')
      .where('providerSessionId', '==', params.providerSessionId.trim())
      .limit(1)
      .get();

    if (!querySnap.empty) {
      return querySnap.docs[0];
    }
  }

  return null;
}

async function updateCheckoutSessionStatus(params: {
  checkoutSessionRef: FirebaseFirestore.DocumentReference;
  nextStatus: WebhookStatus;
  provider: string;
  eventId?: string | null;
  message?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const now = Date.now();

  await params.checkoutSessionRef.set(
    {
      status: params.nextStatus,
      updatedAt: now,
      metadata: {
        webhookProvider: params.provider,
        webhookEventId: params.eventId ?? null,
        webhookMessage: params.message ?? null,
        webhookPayload: params.payload ?? null,
        webhookProcessedAt: now,
      },
    },
    { merge: true }
  );
}

async function applyGrantedPlatformSubscription(params: {
  uid: string;
  checkoutSessionId: string;
  checkoutSession: CheckoutSessionDoc;
}): Promise<void> {
  const { uid, checkoutSessionId, checkoutSession } = params;
  const now = Date.now();

  const planKey = String(checkoutSession.planKey ?? '').trim().toLowerCase();
  const normalizedRole =
    planKey === 'basic' || planKey === 'premium' || planKey === 'vip'
      ? planKey
      : 'premium';

  const userRef = db.collection('users').doc(uid);
  const entitlementId = `platform_subscription_${uid}`;
  const entitlementRef = db.collection('entitlements').doc(entitlementId);

  const entitlementDoc: EntitlementDoc = {
    id: entitlementId,
    buyerUid: uid,
    scope: 'platform_subscription',
    planId: checkoutSession.planId,
    active: true,
    startsAt: now,
    endsAt: null,
    sourceCheckoutSessionId: checkoutSessionId,
  };

  await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    tx.set(
      userRef,
      {
        role: normalizedRole,
        tier: normalizedRole,
        isSubscriber: true,
        subscriptionStatus: 'active',
        subscriptionScope: 'platform_subscription',
        lastBillingCheckoutSessionId: checkoutSessionId,
        billingUpdatedAt: now,
      },
      { merge: true }
    );

    tx.set(entitlementRef, entitlementDoc, { merge: true });
  });
}

function parseIncomingWebhookPayload(
  headers: Record<string, unknown>,
  body: Record<string, unknown>
): ParsedWebhookPayload {
  const provider =
    normalizeProvider(
      (headers['x-provider'] as string | undefined) ??
      (body['provider'] as string | undefined) ??
      (body['mockProvider'] as string | undefined)
    ) || 'asaas';

  const checkoutSessionId = String(body['checkoutSessionId'] ?? '').trim() || null;
  const providerSessionId = String(body['providerSessionId'] ?? '').trim() || null;
  const eventId = String(body['eventId'] ?? '').trim() || null;

  const newStatus = normalizeStatus(
    (body['status'] as string | undefined) ??
    (body['billing'] as string | undefined)
  );

  if (
    (provider === 'manual_pix' || provider === 'pix_manual') &&
    !isDevEnvironment()
  ) {
    return {
      accepted: false,
      provider,
      eventId,
      checkoutSessionId,
      providerSessionId,
      newStatus: null,
      message: 'manual_pix não é permitido fora de desenvolvimento.',
    };
  }

  return {
    accepted: true,
    provider,
    eventId,
    checkoutSessionId,
    providerSessionId,
    newStatus,
    message: String(body['message'] ?? '').trim() || null,
  };
}

export const paymentWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({
      ok: false,
      error: 'method_not_allowed',
      message: 'Use POST.',
    });
    return;
  }

  try {
    const headers = req.headers as Record<string, unknown>;
    const body = safeJsonBody(req);

    const parsed = parseIncomingWebhookPayload(headers, body);

    if (!parsed.accepted) {
      res.status(403).json({
        ok: false,
        accepted: false,
        reason: 'payload_rejected',
        message: parsed.message ?? 'Payload rejeitado.',
      });
      return;
    }

    if (!parsed.newStatus) {
      res.status(202).json({
        ok: true,
        accepted: true,
        processed: false,
        reason: 'missing_or_unknown_status',
      });
      return;
    }

    const checkoutSnap = await findCheckoutSession({
      checkoutSessionId: parsed.checkoutSessionId,
      providerSessionId: parsed.providerSessionId,
    });

    if (!checkoutSnap?.exists) {
      res.status(202).json({
        ok: true,
        accepted: true,
        processed: false,
        reason: 'checkout_session_not_found',
        checkoutSessionId: parsed.checkoutSessionId ?? null,
        providerSessionId: parsed.providerSessionId ?? null,
      });
      return;
    }

    const checkoutSession = checkoutSnap.data() as CheckoutSessionDoc | undefined;

    if (!checkoutSession) {
      res.status(202).json({
        ok: true,
        accepted: true,
        processed: false,
        reason: 'checkout_session_empty',
      });
      return;
    }

    if (checkoutSession.status === 'paid' && parsed.newStatus === 'paid') {
      res.status(200).json({
        ok: true,
        accepted: true,
        processed: true,
        idempotent: true,
        status: 'paid',
        checkoutSessionId: checkoutSnap.id,
      });
      return;
    }

    await updateCheckoutSessionStatus({
      checkoutSessionRef: checkoutSnap.ref,
      nextStatus: parsed.newStatus,
      provider: parsed.provider,
      eventId: parsed.eventId,
      message: parsed.message,
      payload: body,
    });

    if (
      parsed.newStatus === 'paid' &&
      checkoutSession.scope === 'platform_subscription'
    ) {
      await applyGrantedPlatformSubscription({
        uid: checkoutSession.buyerUid,
        checkoutSessionId: checkoutSnap.id,
        checkoutSession,
      });
    }

    res.status(200).json({
      ok: true,
      accepted: true,
      processed: true,
      status: parsed.newStatus,
      checkoutSessionId: checkoutSnap.id,
      providerSessionId:
        parsed.providerSessionId ?? checkoutSession.providerSessionId ?? null,
      provider: parsed.provider,
      devManualPix:
        (parsed.provider === 'manual_pix' || parsed.provider === 'pix_manual') &&
        isDevEnvironment(),
    });
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));

    const statusCode =
      error instanceof HttpsError && error.httpErrorCode?.status
        ? error.httpErrorCode.status
        : 500;

    res.status(statusCode).json({
      ok: false,
      error: normalizedError.message,
    });
  }
});