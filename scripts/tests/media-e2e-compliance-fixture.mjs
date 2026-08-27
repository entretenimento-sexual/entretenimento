import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} = require('../../functions/lib/compliance/platform-legal.constants.js');

/**
 * Prepara somente o estado de compliance necessário para cenários E2E que
 * começam com uma conta já apta a consumir/interagir com mídia pública.
 *
 * O fixture lê as versões canônicas compiladas das Functions para não mascarar
 * uma futura atualização de termos/consentimento com strings duplicadas.
 */
export async function seedPublicMediaCompliance(adminDb, uids) {
  const uniqueUids = [...new Set(
    (uids ?? [])
      .map((uid) => String(uid ?? '').trim())
      .filter(Boolean)
  )];

  await Promise.all(
    uniqueUids.map((uid) =>
      adminDb.doc(`users/${uid}`).set(
        {
          uid,
          accountStatus: 'active',
          suspended: false,
          interactionBlocked: false,
          profileCompleted: true,
          initialAdultConsentRequired: false,
          acceptedTerms: {
            accepted: true,
            version: TERMS_ACCEPTANCE_VERSION,
            acknowledgedPrivacyNotice: true,
            source: 'e2e-fixture',
          },
          adultConsent: {
            accepted: true,
            version: ADULT_CONSENT_VERSION,
            source: 'e2e-fixture',
          },
        },
        { merge: true }
      )
    )
  );
}
