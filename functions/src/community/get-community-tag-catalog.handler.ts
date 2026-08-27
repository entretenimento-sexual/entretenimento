// functions/src/community/get-community-tag-catalog.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY TAG CATALOG
// -----------------------------------------------------------------------------
// Retorna somente metadados editoriais sanitizados. Como o catálogo contém
// afinidades adultas, a mesma elegibilidade de participação é revalidada antes
// de expor os rótulos ao cliente.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  CommunityTagCategory,
  getCommunityTagCatalog as getCanonicalCommunityTagCatalog,
} from './community-tag.catalog';

export interface CommunityTagCatalogItemResponse {
  id: string;
  label: string;
  category: CommunityTagCategory;
}

export interface CommunityTagCatalogResponse {
  items: readonly CommunityTagCatalogItemResponse[];
  generatedAt: number;
}

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

export const getCommunityTagCatalog = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityTagCatalogResponse> => {
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
      items: getCanonicalCommunityTagCatalog().map(({ id, label, category }) => ({
        id,
        label,
        category,
      })),
      generatedAt: Date.now(),
    };
  }
);
