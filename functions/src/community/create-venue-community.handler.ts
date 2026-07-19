// functions/src/community/create-venue-community.handler.ts
// -----------------------------------------------------------------------------
// CREATE VENUE COMMUNITY
// -----------------------------------------------------------------------------
// Cria, em uma única transação idempotente:
// - o Local;
// - a comunidade social vinculada;
// - a projeção de descoberta;
// - o membership do criador como owner;
// - o índice privado do usuário e a auditoria.
//
// Nesta etapa o fluxo permanece restrito ao Functions Emulator, assim como a
// experiência comunitária já existente. O cliente nunca escolhe ownerUid,
// communityId, venueId, estado de moderação ou métricas.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  CreateVenueCommunityRequest,
  CreateVenueCommunityResponse,
  normalizeCreateVenueCommunityRequest,
} from './create-venue-community.model';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'A criação de locais ainda não está disponível neste ambiente.'
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

function normalizeExistingId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : null;
}

export const createVenueCommunity = onCall<CreateVenueCommunityRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CreateVenueCommunityResponse> => {
    assertPreviewRuntime();
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCreateVenueCommunityRequest(request.data);

    if (!command) {
      throw new HttpsError(
        'invalid-argument',
        'Revise os dados obrigatórios do local.'
      );
    }

    return db.runTransaction(async (transaction) => {
      const requestRef = db
        .collection('venue_community_creation_requests')
        .doc(command.requestId);
      const venueRef = db.collection('venues').doc(command.venueId);
      const communityRef = db.collection('communities').doc(command.communityId);
      const ownerMembershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(command.communityId);
      const userIndexRef = db
        .collection('community_user_index')
        .doc(actorUid)
        .collection('items')
        .doc(command.communityId);
      const auditRef = db
        .collection('community_membership_audit')
        .doc(`venue-create-${command.requestId}`);

      const [
        requestSnapshot,
        userSnapshot,
        venueSnapshot,
        communitySnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(userRef),
        transaction.get(venueRef),
        transaction.get(communityRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        const existingActorUid = String(existing['actorUid'] ?? '').trim();
        const existingVenueId = normalizeExistingId(existing['venueId']);
        const existingCommunityId = normalizeExistingId(existing['communityId']);

        if (existingActorUid !== actorUid) {
          throw new HttpsError(
            'permission-denied',
            'Esta solicitação de criação pertence a outro usuário.'
          );
        }

        if (!existingVenueId || !existingCommunityId) {
          throw new HttpsError(
            'data-loss',
            'O registro idempotente da criação está inconsistente.'
          );
        }

        return {
          venueId: existingVenueId,
          communityId: existingCommunityId,
          created: false,
        };
      }

      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      if (venueSnapshot.exists || communitySnapshot.exists) {
        throw new HttpsError(
          'already-exists',
          'Não foi possível reservar os identificadores deste local.'
        );
      }

      const now = Date.now();
      const region = {
        uf: command.region.uf,
        city: command.region.city,
        district: command.region.district,
      };
      const metrics = {
        memberCount: 1,
        postCount: 0,
        mediaCount: 0,
      };
      const access = {
        preview: 'authenticated',
        interaction: 'members_only',
        join: command.joinPolicy,
      };
      const source = { type: 'venue', id: command.venueId };

      transaction.create(venueRef, {
        name: command.name,
        slug: command.slug,
        kind: command.kind,
        description: command.description,
        region,
        addressHint: command.addressHint,
        visibility: 'public',
        moderation: {
          state: 'active',
          reviewedAt: now,
          reviewedBy: actorUid,
          reason: 'emulator-self-created',
        },
        sponsorship: {
          state: 'none',
          priority: 0,
          startsAt: null,
          endsAt: null,
        },
        chat: {
          enabled: true,
          mode: 'hybrid',
        },
        ownerUid: actorUid,
        adminUids: [],
        createdAt: now,
        updatedAt: now,
      });

      transaction.create(communityRef, {
        name: command.name,
        slug: command.slug,
        description: command.description,
        source,
        status: 'active',
        visibility: 'public_preview',
        access,
        moderation: {
          state: 'active',
          reviewedAt: now,
          reviewedBy: actorUid,
        },
        metrics,
        createdAt: now,
        updatedAt: now,
      });

      transaction.create(discoveryRef, {
        communityId: command.communityId,
        name: command.name,
        slug: command.slug,
        description: command.description,
        source,
        status: 'active',
        moderationState: 'active',
        visibility: 'public_preview',
        metrics,
        access,
        avatarUrl: null,
        coverUrl: null,
        rankScore: now,
        updatedAt: now,
      });

      transaction.create(ownerMembershipRef, {
        communityId: command.communityId,
        uid: actorUid,
        role: 'owner',
        status: 'active',
        requestedAt: null,
        joinedAt: now,
        leftAt: null,
        reviewedAt: now,
        reviewedBy: actorUid,
        requestResolution: 'owner_created',
        updatedAt: now,
        policyVersion: 1,
        source: 'venue-community-create',
      });

      transaction.create(userIndexRef, {
        communityId: command.communityId,
        name: command.name,
        source,
        role: 'owner',
        status: 'active',
        updatedAt: now,
      });

      transaction.create(auditRef, {
        action: 'venue_community_created',
        communityId: command.communityId,
        venueId: command.venueId,
        actorUid,
        subjectUid: actorUid,
        previousStatus: null,
        nextStatus: 'active',
        previousRole: null,
        nextRole: 'owner',
        createdAt: now,
      });

      transaction.create(requestRef, {
        actorUid,
        venueId: command.venueId,
        communityId: command.communityId,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      });

      return {
        venueId: command.venueId,
        communityId: command.communityId,
        created: true,
      };
    });
  }
);
