// functions/src/community/get-community-tag-catalog.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY TAG CATALOG
// -----------------------------------------------------------------------------
// Retorna somente metadados editoriais sanitizados. Como o catálogo contém
// afinidades adultas, a mesma elegibilidade de participação é revalidada antes
// de expor os rótulos ao cliente.
//
// `preferenceSignals` descreve apenas a relação canônica entre uma tag pública e
// os domínios de Preferences. Não contém escolhas do usuário nem copia qualquer
// preferência privada para a Comunidade; serve para derivação contextual local.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  CommunityPreferenceSignal,
  CommunityTagCategory,
  getCommunityTagCatalog as getCanonicalCommunityTagCatalog,
} from './community-tag.catalog';

export interface CommunityTagCatalogItemResponse {
  id: string;
  label: string;
  category: CommunityTagCategory;
  preferenceSignals: readonly CommunityPreferenceSignal[];
}

export interface CommunityTagCatalogResponse {
  items: readonly CommunityTagCatalogItemResponse[];
  generatedAt: number;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

export const getCommunityTagCatalog = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityTagCatalogResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertPreviewRuntime();

    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail para continuar.'
      );
    }

    const userSnapshot = await db.collection('users').doc(uid).get();
    assertCommunityMembershipActorEligible(
      userSnapshot.exists ? userSnapshot.data() : null,
      uid
    );

    return {
      items: getCanonicalCommunityTagCatalog().map((tag) => ({
        id: tag.id,
        label: tag.label,
        category: tag.category,
        preferenceSignals: tag.preferenceSignals.map(({ domain, key }) => ({
          domain,
          key,
        })),
      })),
      generatedAt: Date.now(),
    };
  }
);
