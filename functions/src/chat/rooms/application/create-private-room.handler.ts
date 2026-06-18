// functions\src\chat\rooms\application\create-private-room.handler.ts
// -----------------------------------------------------------------------------
// CREATE PRIVATE ROOM HANDLER
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - criar sala privada somente por backend confiável;
// - validar autenticação, e-mail, perfil, lifecycle e entitlement;
// - aplicar limite transacional de sala própria ativa;
// - criar membership inicial do owner;
// - aceitar intenção de local apenas para premium/vip;
// - registrar auditoria interna.
//
// Segurança:
// - o cliente envia nome, descrição e intenção opcional de local;
// - createdBy, participants, visibility, status e demais campos de controle
//   são definidos exclusivamente pelo backend;
// - users/{uid}.role e isSubscriber NÃO autorizam esta ação;
// - a autorização paga vem de entitlements/platform_subscription_{uid};
// - intenção de local não aceita coordenada precisa nem UIDs de presença.
//
// Compatibilidade temporária:
// - `participants: [uid]` permanece no documento principal porque o frontend
//   atual ainda consulta salas com base nessa estrutura;
// - também criamos members/{uid}, preparando a migração para membership
//   como fonte futura de autorização.
//
// App Check:
// - ainda não exigido nesta callable porque o cliente/emulator não foi
//   configurado nesta etapa;
// - deve ser ativado antes da publicação do recurso em produção.
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';
import {
  assertMessagingAccountOperational,
} from '../../shared/messaging-account.policy';
import type {
  MessagingUserDoc,
} from '../../shared/messaging.types';
import type {
  EntitlementDoc,
  PlatformRole,
} from '../../../payments/domain/billing.model';
import {
  PRIVATE_ROOM_POLICY_VERSION,
  resolvePrivateRoomCreationCapabilities,
} from '../domain/room-capability-policy';

interface CreatePrivateRoomRequest {
  roomName?: unknown;
  description?: unknown;
  placeIntent?: unknown;
}

interface RoomPlaceIntentPayload {
  mode: 'now' | 'scheduled';
  visibility: 'room_members' | 'regional_teaser';
  region: {
    uf: string;
    city: string;
  };
  label: string;
  startsAt: number;
  endsAt: number | null;
  source: 'owner_declared';
}

interface CreatePrivateRoomResponse {
  roomId: string;
  roomName: string;
  description: string | null;
  createdBy: string;
  memberCount: number;
  visibility: 'hidden';
  roomType: 'private';
  status: 'active';
  placeIntent?: RoomPlaceIntentPayload | null;
}

type PlatformEntitlementData = Partial<EntitlementDoc> & {
  buyerUid?: unknown;
  scope?: unknown;
  active?: unknown;
  grantedRole?: unknown;
  endsAt?: unknown;
};

function normalizeRoomName(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional de entrada textual.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDescription(value: unknown): string | null {
  const normalized = String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional de entrada textual.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();

  return normalized || null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional de entrada textual.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

function assertValidInput(
  data: CreatePrivateRoomRequest | undefined
): {
  roomName: string;
  description: string | null;
  placeIntentRaw: unknown;
} {
  const roomName = normalizeRoomName(data?.roomName);
  const description = normalizeDescription(data?.description);

  if (roomName.length < 3 || roomName.length > 60) {
    throw new HttpsError(
      'invalid-argument',
      'O nome da sala deve ter entre 3 e 60 caracteres.'
    );
  }

  if (description && description.length > 280) {
    throw new HttpsError(
      'invalid-argument',
      'A descrição da sala deve ter no máximo 280 caracteres.'
    );
  }

  return {
    roomName,
    description,
    placeIntentRaw: data?.placeIntent ?? null,
  };
}

function resolveActiveSubscriptionRole(
  entitlement: PlatformEntitlementData | undefined,
  uid: string,
  now: number
): PlatformRole {
  const endsAt =
    typeof entitlement?.endsAt === 'number' && Number.isFinite(entitlement.endsAt)
      ? entitlement.endsAt
      : null;

  const isValid =
    entitlement?.active === true &&
    entitlement?.buyerUid === uid &&
    entitlement?.scope === 'platform_subscription' &&
    isPlatformRole(entitlement?.grantedRole) &&
    (endsAt === null || endsAt > now);

  if (!isValid) {
    throw new HttpsError(
      'permission-denied',
      'Seu plano atual não permite criar salas.'
    );
  }

  return entitlement.grantedRole as PlatformRole;
}

function normalizePlaceIntent(
  raw: unknown,
  grantedRole: PlatformRole,
  now: number
): RoomPlaceIntentPayload | null {
  if (raw == null) {
    return null;
  }

  if (grantedRole === 'basic') {
    throw new HttpsError(
      'permission-denied',
      'Local da sala é exclusivo para plano premium ou superior.'
    );
  }

  if (typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'Local da sala inválido.');
  }

  const source = raw as {
    mode?: unknown;
    visibility?: unknown;
    region?: unknown;
    label?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
  };

  const mode = source.mode === 'scheduled' ? 'scheduled' : 'now';
  const visibility =
    source.visibility === 'regional_teaser' ? 'regional_teaser' : 'room_members';
  const region = source.region as { uf?: unknown; city?: unknown } | null;
  const uf = normalizeText(region?.uf).toUpperCase();
  const city = normalizeText(region?.city).toLowerCase();
  const label = normalizeText(source.label);
  const startsAt =
    mode === 'now'
      ? now
      : typeof source.startsAt === 'number' && Number.isFinite(source.startsAt)
        ? Math.trunc(source.startsAt)
        : 0;
  const endsAt =
    typeof source.endsAt === 'number' && Number.isFinite(source.endsAt)
      ? Math.trunc(source.endsAt)
      : null;

  if (!/^[A-Z]{2}$/.test(uf)) {
    throw new HttpsError('invalid-argument', 'UF do local da sala inválida.');
  }

  if (city.length < 1 || city.length > 80) {
    throw new HttpsError('invalid-argument', 'Cidade do local da sala inválida.');
  }

  if (label.length < 3 || label.length > 80) {
    throw new HttpsError('invalid-argument', 'Local da sala deve ter entre 3 e 80 caracteres.');
  }

  if (mode === 'scheduled' && startsAt < now - 1000 * 60 * 5) {
    throw new HttpsError('invalid-argument', 'Horário do local da sala inválido.');
  }

  if (endsAt !== null && endsAt <= startsAt) {
    throw new HttpsError('invalid-argument', 'Término do local da sala inválido.');
  }

  return {
    mode,
    visibility,
    region: { uf, city },
    label,
    startsAt,
    endsAt,
    source: 'owner_declared',
  };
}

export const createPrivateRoom = onCall<CreatePrivateRoomRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CreatePrivateRoomResponse> => {
    const uid = String(request.auth?.uid ?? '').trim();

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de criar uma sala.'
      );
    }

    const input = assertValidInput(request.data);
    const now = Date.now();
    let createdPlaceIntent: RoomPlaceIntentPayload | null = null;

    const userRef = db.collection('users').doc(uid);
    const entitlementRef = db
      .collection('entitlements')
      .doc(`platform_subscription_${uid}`);

    /**
     * Slot determinístico:
     * - evita duas salas próprias ativas para o mesmo usuário;
     * - impede corrida de duas requisições simultâneas;
     * - será liberado futuramente por uma callable de encerramento de sala.
     */
    const ownerSlotRef = db.collection('room_owner_slots').doc(uid);

    const roomRef = db.collection('rooms').doc();
    const memberRef = roomRef.collection('members').doc(uid);
    const auditRef = db.collection('room_audit').doc();

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const [userSnapshot, entitlementSnapshot, ownerSlotSnapshot] =
        await Promise.all([
          tx.get(userRef),
          tx.get(entitlementRef),
          tx.get(ownerSlotRef),
        ]);

      const user = userSnapshot.data() as MessagingUserDoc | undefined;

      assertMessagingAccountOperational(user, {
        operation: 'create-private-room',
        perspective: 'actor',
      });

      const entitlement = entitlementSnapshot.data() as
        | PlatformEntitlementData
        | undefined;

      const grantedRole = resolveActiveSubscriptionRole(
        entitlement,
        uid,
        now
      );

      const capabilities =
        resolvePrivateRoomCreationCapabilities(grantedRole);

      if (!capabilities.canCreatePrivateRoom) {
        throw new HttpsError(
          'permission-denied',
          'Seu plano atual não permite criar salas.'
        );
      }

      createdPlaceIntent = normalizePlaceIntent(
        input.placeIntentRaw,
        grantedRole,
        now
      );

      const activeSlot = ownerSlotSnapshot.data() as
        | { active?: boolean; roomId?: string | null }
        | undefined;

      if (activeSlot?.active === true) {
        throw new HttpsError(
          'failed-precondition',
          'Você já atingiu o limite de salas criadas.'
        );
      }

      /**
       * Compatibilidade com salas criadas antes da introdução do slot.
       *
       * Como o produto atual permite apenas uma sala própria, qualquer sala
       * legada encontrada impede a criação de outra até a migração/encerramento
       * seguro desse registro.
       */
      const legacyOwnedRoomsQuery = db
        .collection('rooms')
        .where('createdBy', '==', uid)
        .limit(capabilities.maxOwnedActiveRooms);

      const legacyOwnedRoomsSnapshot = await tx.get(legacyOwnedRoomsQuery);

      if (!legacyOwnedRoomsSnapshot.empty) {
        throw new HttpsError(
          'failed-precondition',
          'Você já atingiu o limite de salas criadas.'
        );
      }

      tx.set(roomRef, {
        roomName: input.roomName,
        description: input.description,

        createdBy: uid,

        /**
         * Campo legado temporariamente mantido para compatibilidade com
         * leituras existentes no frontend.
         * Não deverá permanecer como autoridade definitiva de membership.
         */
        participants: [uid],

        memberCount: 1,
        membershipMode: 'invite_only',

        isRoom: true,
        isPrivate: true,
        roomType: 'private',
        visibility: 'hidden',
        status: 'active',

        ...(createdPlaceIntent
          ? {
              placeIntent: {
                ...createdPlaceIntent,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              },
            }
          : {}),

        policyVersion: PRIVATE_ROOM_POLICY_VERSION,
        entitlementRoleAtCreation: grantedRole,

        creationTime: FieldValue.serverTimestamp(),
        lastActivity: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(memberRef, {
        uid,
        membershipRole: 'owner',
        status: 'active',
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(ownerSlotRef, {
        uid,
        roomId: roomRef.id,
        active: true,
        maxOwnedActiveRooms: capabilities.maxOwnedActiveRooms,
        entitlementRoleAtCreation: grantedRole,
        policyVersion: PRIVATE_ROOM_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(auditRef, {
        action: 'create_private_room',
        actorUid: uid,
        roomId: roomRef.id,
        entitlementRole: grantedRole,
        hasPlaceIntent: createdPlaceIntent !== null,
        placeIntentRegion: createdPlaceIntent?.region ?? null,
        policyVersion: PRIVATE_ROOM_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      roomId: roomRef.id,
      roomName: input.roomName,
      description: input.description,
      createdBy: uid,
      memberCount: 1,
      visibility: 'hidden',
      roomType: 'private',
      status: 'active',
      placeIntent: createdPlaceIntent,
    };
  }
);
