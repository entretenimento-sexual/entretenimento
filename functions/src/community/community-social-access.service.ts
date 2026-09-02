// functions/src/community/community-social-access.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY SOCIAL ACCESS ELIGIBILITY
// -----------------------------------------------------------------------------
// Gate backend canônico para qualquer leitura/interação social de Comunidades.
// A UI continua aplicando seus guards para UX, mas autorização nunca depende
// exclusivamente do navegador.
//
// Decisões de segurança NÃO são cacheadas: suspensão, revogação de consentimento
// e reverificação etária precisam produzir efeito na próxima chamada protegida.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from '../compliance/platform-legal.constants';
import { isAgeReverificationAccessRestricted } from '../compliance/profile-age-reverification.policy';
import { db } from '../firebaseApp';

function hasAcceptedCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return record['accepted'] === true
    && String(record['version'] ?? '').trim() === TERMS_ACCEPTANCE_VERSION
    && record['acknowledgedPrivacyNotice'] === true;
}

function hasCurrentAdultConsent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return record['accepted'] === true
    && String(record['version'] ?? '').trim() === ADULT_CONSENT_VERSION;
}

function assertCommunityAccountAvailable(
  user: Record<string, unknown>
): void {
  const accountStatus = String(user['accountStatus'] ?? 'active')
    .trim()
    .toLowerCase();
  const restricted =
    accountStatus !== 'active'
    || user['suspended'] === true
    || user['interactionBlocked'] === true
    || user['accountLocked'] === true
    || user['loginAllowed'] === false;

  if (restricted) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não pode acessar recursos sociais agora.',
      {
        reason: 'account_restricted',
        recommendedAction: 'review_account',
      }
    );
  }
}

function assertCommunityAdultAccess(user: Record<string, unknown>): void {
  if (!hasAcceptedCurrentTerms(user['acceptedTerms'])) {
    throw new HttpsError(
      'failed-precondition',
      'Aceite os termos vigentes para continuar.',
      {
        reason: 'current_terms_required',
        recommendedAction: 'accept_current_terms',
      }
    );
  }

  const idade = user['idade'];
  const ageReverification = (user['ageReverification'] ?? {}) as Record<
    string,
    unknown
  >;
  const ageResult = String(ageReverification['result'] ?? '')
    .trim()
    .toUpperCase();

  if (
    (typeof idade === 'number' && idade < 18)
    || ageResult === 'UNDERAGE'
  ) {
    throw new HttpsError(
      'permission-denied',
      'O acesso adulto não está disponível para esta conta.',
      {
        reason: 'adult_access_denied',
        recommendedAction: 'review_account',
      }
    );
  }

  if (isAgeReverificationAccessRestricted(ageReverification['status'])) {
    throw new HttpsError(
      'failed-precondition',
      'Conclua a reverificação de maioridade para continuar.',
      {
        reason: 'age_reverification_required',
        recommendedAction: 'complete_age_reverification',
      }
    );
  }

  const initialConsentRequired = user['initialAdultConsentRequired'] !== false;
  if (
    initialConsentRequired
    && !hasCurrentAdultConsent(user['adultConsent'])
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Confirmação de acesso adulto necessária.',
      {
        reason: 'adult_access_required',
        recommendedAction: 'confirm_adult_access',
      }
    );
  }
}

export function assertCommunitySocialAccessEligible(
  rawUser: unknown,
  uid: string
): void {
  const user = (rawUser ?? {}) as Record<string, unknown>;

  if (user['uid'] !== uid) {
    throw new HttpsError('not-found', 'Perfil não localizado.', {
      reason: 'profile_incomplete',
      recommendedAction: 'complete_profile',
    });
  }

  assertCommunityAccountAvailable(user);
  assertCommunityAdultAccess(user);
}

export async function assertCommunitySocialAccessForUid(
  uid: string
): Promise<void> {
  const normalizedUid = String(uid ?? '').trim();
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const snapshot = await db.collection('users').doc(normalizedUid).get();
  assertCommunitySocialAccessEligible(
    snapshot.exists ? snapshot.data() : null,
    normalizedUid
  );
}
