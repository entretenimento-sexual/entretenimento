// functions/src/community/get-my-communities-page.handler.ts
// -----------------------------------------------------------------------------
// GET MY COMMUNITIES PAGE
// -----------------------------------------------------------------------------
// Lista paginada das Comunidades ativas do próprio usuário. O índice é privado e
// backend-only; cada item é revalidado contra membership e documento canônico
// antes de ser devolvido ao cliente.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  CommunityDiscoveryPageRequest,
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  normalizeCommunityDiscoveryPageRequest,
  sanitizeCommunityDocument,
} from './community-preview.model';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

function isActiveCommunityMembership(raw: unknown): boolean {
  const membership = (raw ?? {}) as Record<string, unknown>;
  const role = membership['role'];

  return membership['status'] === 'active'
    && (role === 'owner'
      || role === 'admin'
      || role === 'moderator'
      || role === 'member');
}

export const getMyCommunitiesPage = onCall<CommunityDiscoveryPageRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityDiscoveryPageResponse> => {
    assertPreviewRuntime();
    const uid = assertAuthenticatedUid(request.auth);
    const pageRequest = normalizeCommunityDiscoveryPageRequest(request.data);
    const providedCursor = String(request.data?.cursor ?? '').trim();

    if (providedCursor && !pageRequest.cursor) {
      throw new HttpsError('invalid-argument', 'Cursor de paginação inválido.');
    }

    const indexCollection = db
      .collection('community_user_index')
      .doc(uid)
      .collection('items');
    const scanLimit = pageRequest.limit * 3 + 1;
    let pageQuery = indexCollection
      .orderBy('updatedAt', 'desc')
      .limit(scanLimit);

    if (pageRequest.cursor) {
      const cursorSnapshot = await indexCollection.doc(pageRequest.cursor).get();

      if (!cursorSnapshot.exists) {
        throw new HttpsError(
          'invalid-argument',
          'Cursor de paginação não encontrado.'
        );
      }

      pageQuery = pageQuery.startAfter(cursorSnapshot);
    }

    const querySnapshot = await pageQuery.get();
    const candidates = await Promise.all(
      querySnapshot.docs.map(async (indexDocument) => {
        const index = indexDocument.data() as Record<string, unknown>;
        const source = (index['source'] ?? {}) as Record<string, unknown>;

        if (index['status'] !== 'active' || source['type'] !== 'community') {
          return null;
        }

        const communityId = indexDocument.id;
        const communityRef = db.collection('communities').doc(communityId);
        const membershipRef = communityRef.collection('members').doc(uid);
        const [communitySnapshot, membershipSnapshot] = await Promise.all([
          communityRef.get(),
          membershipRef.get(),
        ]);

        if (
          !communitySnapshot.exists
          || !membershipSnapshot.exists
          || !isActiveCommunityMembership(membershipSnapshot.data())
          || communitySnapshot.data()?.['status'] !== 'active'
        ) {
          return null;
        }

        const card = sanitizeCommunityDocument(
          communitySnapshot.id,
          communitySnapshot.data()
        );

        return card?.source.type === 'community' ? card : null;
      })
    );

    const items: CommunityPreviewCard[] = [];
    let lastConsumedIndex = -1;

    for (let index = 0; index < candidates.length; index += 1) {
      lastConsumedIndex = index;
      const candidate = candidates[index];

      if (candidate) items.push(candidate);
      if (items.length >= pageRequest.limit) break;
    }

    const lastConsumedDocument = lastConsumedIndex >= 0
      ? querySnapshot.docs[lastConsumedIndex]
      : null;
    const hasBufferedDocuments =
      lastConsumedIndex >= 0
      && lastConsumedIndex < querySnapshot.docs.length - 1;
    const mayHaveAnotherPage =
      querySnapshot.docs.length === scanLimit || hasBufferedDocuments;

    return {
      items,
      nextCursor: mayHaveAnotherPage
        ? (lastConsumedDocument?.id ?? null)
        : null,
      generatedAt: Date.now(),
    };
  }
);
