//functions\src\payments\application\process-billing-return.handler.ts
import { db } from '../../firebaseApp';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

type BillingReturnStatus = 'processing' | 'granted' | 'failed' | 'canceled';

type BillingReturnScope =
  | 'platform_subscription'
  | 'creator_subscription'
  | 'tip'
  | 'paid_media'
  | 'paid_live';

interface ProcessBillingReturnRequest {
  billing?: string;
  scope?: BillingReturnScope | string;
  mockProvider?: string | null;
  providerSessionId?: string | null;
  checkoutSessionId?: string | null;
}

interface ProcessBillingReturnResponse {
  status: BillingReturnStatus;
  scope: string;
  role?: string | null;
  accessGranted?: boolean;
  checkoutSessionId?: string | null;
  providerSessionId?: string | null;
  redirectTo?: string | null;
  message?: string | null;
}

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
  status: 'pending' | 'provider_created' | 'paid' | 'failed' | 'canceled';
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

function normalizeBillingStatus(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .split('?')[0];
}

function normalizeScope(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

function buildGrantedResult(params: {
  scope: string;
  checkoutSessionId?: string | null;
  providerSessionId?: string | null;
  role?: string | null;
  message?: string | null;
}): ProcessBillingReturnResponse {
  return {
    status: 'granted',
    scope: params.scope,
    role: params.role ?? null,
    accessGranted: true,
    checkoutSessionId: params.checkoutSessionId ?? null,
    providerSessionId: params.providerSessionId ?? null,
    redirectTo: '/conta',
    message: params.message ?? 'Pagamento confirmado com sucesso.',
  };
}

async function findCheckoutSessionForUser(params: {
  buyerUid: string;
  checkoutSessionId?: string | null;
  providerSessionId?: string | null;
}): Promise<FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot | null> {
  const { buyerUid, checkoutSessionId, providerSessionId } = params;

  if (checkoutSessionId?.trim()) {
    const directRef = db.collection('checkout_sessions').doc(checkoutSessionId.trim());
    const directSnap = await directRef.get();

    if (directSnap.exists) {
      const data = directSnap.data() as CheckoutSessionDoc | undefined;
      if (data?.buyerUid === buyerUid) {
        return directSnap;
      }
    }
  }

  if (providerSessionId?.trim()) {
    const querySnap = await db
      .collection('checkout_sessions')
      .where('buyerUid', '==', buyerUid)
      .where('providerSessionId', '==', providerSessionId.trim())
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
  nextStatus: 'paid' | 'failed' | 'canceled' | 'pending' | 'provider_created';
  message?: string | null;
}): Promise<void> {
  const now = Date.now();

  await params.checkoutSessionRef.set(
    {
      status: params.nextStatus,
      updatedAt: now,
      metadata: {
        lastProcessMessage: params.message ?? null,
        lastProcessedAt: now,
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

async function resolveMockProviderResult(params: {
  billing: string;
  scope: string;
  mockProvider?: string | null;
  checkoutSession?: CheckoutSessionDoc | null;
}): Promise<{
  providerStatus: 'processing' | 'paid' | 'failed' | 'canceled';
  providerMessage?: string | null;
}> {
  const provider = String(
    params.mockProvider ??
      params.checkoutSession?.provider ??
      'mock'
  )
    .trim()
    .toLowerCase();

  if (provider === 'asaas' || provider === 'mock') {
    if (params.billing === 'success' || params.billing === 'paid') {
      return {
        providerStatus: 'paid',
        providerMessage: 'Pagamento confirmado pelo mock/provider.',
      };
    }

    if (params.billing === 'cancel' || params.billing === 'canceled') {
      return {
        providerStatus: 'canceled',
        providerMessage: 'Pagamento cancelado.',
      };
    }

    if (params.billing === 'failed' || params.billing === 'error') {
      return {
        providerStatus: 'failed',
        providerMessage: 'Pagamento não confirmado.',
      };
    }

    return {
      providerStatus: 'processing',
      providerMessage: 'Pagamento ainda em processamento.',
    };
  }

  return {
    providerStatus: 'processing',
    providerMessage: 'Provider ainda não integrado.',
  };
}

export const processBillingReturn = onCall<ProcessBillingReturnRequest>(
  async (request): Promise<ProcessBillingReturnResponse> => {
    const buyerUid = request.auth?.uid ?? null;

    if (!buyerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const billing = normalizeBillingStatus(request.data?.billing);
    const scope = normalizeScope(request.data?.scope);

    if (!billing || !scope) {
      throw new HttpsError(
        'invalid-argument',
        'billing e scope são obrigatórios.'
      );
    }

    const checkoutSnap = await findCheckoutSessionForUser({
      buyerUid,
      checkoutSessionId: request.data?.checkoutSessionId,
      providerSessionId: request.data?.providerSessionId,
    });

    const checkoutSession = (checkoutSnap?.data?.() ?? null) as CheckoutSessionDoc | null;
    const checkoutSessionId = checkoutSnap?.id ?? request.data?.checkoutSessionId ?? null;
    const providerSessionId =
      request.data?.providerSessionId ??
      checkoutSession?.providerSessionId ??
      null;

    if (!checkoutSnap?.exists || !checkoutSession) {
      return {
        status: 'processing',
        scope,
        checkoutSessionId,
        providerSessionId,
        accessGranted: false,
        message:
          'Sessão de checkout ainda não localizada. O retorno será reavaliado em seguida.',
      };
    }

    if (checkoutSession.status === 'paid') {
      const userSnap = await db.collection('users').doc(buyerUid).get();
      const userData = userSnap.data() ?? {};

      const alreadyGranted =
        userData['isSubscriber'] === true &&
        !!String(userData['role'] ?? userData['tier'] ?? '').trim();

      if (alreadyGranted) {
        return buildGrantedResult({
          scope,
          checkoutSessionId,
          providerSessionId,
          role: String(userData['role'] ?? userData['tier'] ?? ''),
          message: 'Pagamento já havia sido confirmado anteriormente.',
        });
      }
    }

    const providerResolution = await resolveMockProviderResult({
      billing,
      scope,
      mockProvider: request.data?.mockProvider,
      checkoutSession,
    });

    if (providerResolution.providerStatus === 'canceled') {
      await updateCheckoutSessionStatus({
        checkoutSessionRef: checkoutSnap.ref,
        nextStatus: 'canceled',
        message: providerResolution.providerMessage ?? null,
      });

      return {
        status: 'canceled',
        scope,
        checkoutSessionId,
        providerSessionId,
        accessGranted: false,
        message: providerResolution.providerMessage ?? 'Pagamento cancelado.',
      };
    }

    if (providerResolution.providerStatus === 'failed') {
      await updateCheckoutSessionStatus({
        checkoutSessionRef: checkoutSnap.ref,
        nextStatus: 'failed',
        message: providerResolution.providerMessage ?? null,
      });

      return {
        status: 'failed',
        scope,
        checkoutSessionId,
        providerSessionId,
        accessGranted: false,
        message: providerResolution.providerMessage ?? 'Pagamento não confirmado.',
      };
    }

    if (providerResolution.providerStatus === 'processing') {
      return {
        status: 'processing',
        scope,
        checkoutSessionId,
        providerSessionId,
        accessGranted: false,
        message:
          providerResolution.providerMessage ??
          'Pagamento ainda em processamento.',
      };
    }

    await updateCheckoutSessionStatus({
      checkoutSessionRef: checkoutSnap.ref,
      nextStatus: 'paid',
      message: providerResolution.providerMessage ?? null,
    });

    if (scope === 'platform_subscription') {
      await applyGrantedPlatformSubscription({
        uid: buyerUid,
        checkoutSessionId: checkoutSnap.id,
        checkoutSession,
      });

      const refreshedUserSnap = await db
        .collection('users')
        .doc(buyerUid)
        .get();

      const refreshedUser = refreshedUserSnap.data() ?? {};

      return buildGrantedResult({
        scope,
        checkoutSessionId,
        providerSessionId,
        role: String(refreshedUser['role'] ?? refreshedUser['tier'] ?? ''),
        message: 'Assinatura de plataforma confirmada com sucesso.',
      });
    }

    return {
      status: 'granted',
      scope,
      checkoutSessionId,
      providerSessionId,
      accessGranted: true,
      redirectTo: '/conta',
      message:
        'Pagamento confirmado. O tratamento específico deste escopo ainda será expandido.',
    };
  }
);