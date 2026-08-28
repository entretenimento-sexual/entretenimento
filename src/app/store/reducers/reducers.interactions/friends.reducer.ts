// src/app/store/reducers/reducers.interactions/friends.reducer.ts
// -----------------------------------------------------------------------------
// FRIENDS REDUCER
// -----------------------------------------------------------------------------
// Estado social principal da plataforma.
//
// Responsabilidades atuais:
// - lista de amigos;
// - solicitações recebidas;
// - solicitações enviadas;
// - bloqueios;
// - busca;
// - estados de loading/erro;
// - proteções locais contra snapshots atrasados.
//
// Observação arquitetural:
// Este reducer ainda concentra muitos domínios sociais. Ele está sendo
// estabilizado agora para segurança e reatividade, mas a evolução ideal antes
// do deploy é separar gradualmente em stores/facades mais específicos:
//
// - socialRequestsStore;
// - socialGraphStore;
// - socialBlocksStore;
// - socialDiscoveryStore.
//
// Por ora, mantemos compatibilidade e corrigimos a reatividade sem big-bang.
// -----------------------------------------------------------------------------

import { createReducer, on } from '@ngrx/store';

import * as A from '../../actions/actions.interactions/actions.friends';
import * as RT from '../../actions/actions.interactions/friends/friends-realtime.actions';

import {
  FriendsState,
  initialState,
} from '../../states/states.interactions/friends.state';

import { BlockedUserActive } from 'src/app/core/interfaces/friendship/blocked-user.interface';

import {
  authSessionChanged,
  logoutSuccess,
} from '../../actions/actions.user/auth.actions';

/* ============================================================================
 * Helpers de normalização
 * ============================================================================
 * Mantêm comparações previsíveis e evitam falhas quando algum objeto vier com
 * uid/friendUid/id dependendo da origem: Firestore, serializer, VM ou cache.
 */

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueUidList(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeUid).filter(Boolean)));
}

function getFriendCandidateUids(friend: unknown): string[] {
  const f = friend as Record<string, unknown>;

  return [
    f?.['friendUid'],
    f?.['uid'],
    f?.['id'],
  ]
    .map(normalizeUid)
    .filter(Boolean);
}

function isSameFriend(friend: unknown, targetUid: string): boolean {
  const safeTargetUid = normalizeUid(targetUid);

  if (!safeTargetUid) {
    return false;
  }

  return getFriendCandidateUids(friend).includes(safeTargetUid);
}

function filterRemovedFriends<T>(friends: T[], tombstones: string[]): T[] {
  const safeTombstones = uniqueUidList(tombstones);

  if (!safeTombstones.length) {
    return friends;
  }

  return friends.filter((friend) =>
    !safeTombstones.some((uid) => isSameFriend(friend, uid))
  );
}

function addUniqueId(list: string[], id: string): string[] {
  const safeId = normalizeId(id);

  if (!safeId || list.includes(safeId)) {
    return list;
  }

  return [...list, safeId];
}

function removeId(list: string[], id: string): string[] {
  const safeId = normalizeId(id);

  if (!safeId) {
    return list;
  }

  return list.filter((item) => item !== safeId);
}

/* ============================================================================
 * Reducer
 * ============================================================================ */

export const friendsReducer = createReducer(
  initialState,

  /* ==========================================================================
   * Amigos
   * ========================================================================== */

  on(A.loadFriends, (state): FriendsState => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(A.loadFriendsSuccess, (state, { friends }): FriendsState => ({
    ...state,
    loading: false,

    /**
     * Importante:
     * Também aplicamos tombstones no load manual.
     *
     * Motivo:
     * - após desfazer amizade, o effect dispara loadFriends;
     * - se qualquer leitura canônica ainda trouxer snapshot antigo, o amigo
     *   removido não deve reaparecer visualmente.
     */
    friends: filterRemovedFriends(
      friends,
      state.locallyRemovedFriendUids
    ),
  })),

  on(A.loadFriendsFailure, (state, { error }): FriendsState => ({
    ...state,
    loading: false,
    error,
  })),

  on(A.endFriendship, (state, { friendUid }): FriendsState => ({
    ...state,
    endingFriendshipUid: normalizeUid(friendUid) || null,
    endingFriendshipError: null,
    error: null,
  })),

  on(A.endFriendshipSuccess, (state, { friendUid }): FriendsState => {
    const safeFriendUid = normalizeUid(friendUid);

    return {
      ...state,
      endingFriendshipUid: null,
      endingFriendshipError: null,

      /**
       * Tombstone local temporária.
       *
       * Motivo:
       * - evita que snapshots atrasados do realtime reintroduzam visualmente
       *   uma amizade que o usuário acabou de desfazer;
       * - a limpeza é feita por effect com timer controlado.
       */
      locallyRemovedFriendUids: uniqueUidList([
        ...state.locallyRemovedFriendUids,
        safeFriendUid,
      ]),

      friends: state.friends.filter(
        (friend) => !isSameFriend(friend, safeFriendUid)
      ),
    };
  }),

  on(A.endFriendshipFailure, (state, { error }): FriendsState => ({
    ...state,
    endingFriendshipUid: null,
    endingFriendshipError: error,
    error,
  })),

  on(A.clearLocallyRemovedFriendTombstone, (state, { friendUid }): FriendsState => ({
    ...state,
    locallyRemovedFriendUids: state.locallyRemovedFriendUids.filter(
      (uid) => uid !== normalizeUid(friendUid)
    ),
  })),

  /* ==========================================================================
   * Envio de solicitação
   * ========================================================================== */

  on(A.sendFriendRequest, (state): FriendsState => ({
    ...state,
    sendingFriendRequest: true,
    sendFriendRequestError: null,
    sendFriendRequestSuccess: false,
    error: null,
  })),

  on(A.sendFriendRequestSuccess, (state): FriendsState => ({
    ...state,
    sendingFriendRequest: false,
    sendFriendRequestSuccess: true,
  })),

  on(A.sendFriendRequestFailure, (state, { error }): FriendsState => ({
    ...state,
    sendingFriendRequest: false,
    sendFriendRequestError: error,
    sendFriendRequestSuccess: false,
    error,
  })),

  on(A.resetSendFriendRequestStatus, (state): FriendsState => ({
    ...state,
    sendFriendRequestSuccess: false,
    sendFriendRequestError: null,
  })),

  /* ==========================================================================
   * Solicitações recebidas
   * ========================================================================== */

  on(A.loadInboundRequests, (state): FriendsState => ({
    ...state,
    loadingRequests: true,
    error: null,
  })),

  on(A.loadInboundRequestsSuccess, (state, { requests }): FriendsState => ({
    ...state,
    loadingRequests: false,
    requests,
  })),

  on(A.loadInboundRequestsFailure, (state, { error }): FriendsState => ({
    ...state,
    loadingRequests: false,
    error,
  })),

  /* ==========================================================================
   * Solicitações enviadas
   * ========================================================================== */

  on(A.loadOutboundRequests, (state): FriendsState => ({
    ...state,
    loadingOutboundRequests: true,
    error: null,
  })),

  on(A.loadOutboundRequestsSuccess, (state, { requests }): FriendsState => ({
    ...state,
    loadingOutboundRequests: false,
    outboundRequests: requests,
  })),

  on(A.loadOutboundRequestsFailure, (state, { error }): FriendsState => ({
    ...state,
    loadingOutboundRequests: false,
    error,
  })),

  /* ==========================================================================
   * Perfis auxiliares de solicitações
   * ========================================================================== */

  on(A.loadRequesterProfilesSuccess, (state, { map }): FriendsState => ({
    ...state,
    requestersMap: {
      ...state.requestersMap,
      ...map,
    },
  })),

  /* ==========================================================================
   * Aceitar / recusar solicitação recebida
   * ========================================================================== */

  on(A.acceptFriendRequestSuccess, (state, { requestId }): FriendsState => ({
    ...state,

    /**
     * Remoção local imediata.
     *
     * Depois o effect faz sincronização curta e o listener realtime confirma
     * o estado canônico.
     */
    requests: state.requests.filter((request) => request.id !== requestId),
  })),

  on(A.acceptFriendRequestFailure, (state, { error }): FriendsState => ({
    ...state,
    error,
  })),

  on(A.declineFriendRequestSuccess, (state, { requestId }): FriendsState => ({
    ...state,

    /**
     * Recusa também remove localmente da aba RECEBIDAS.
     */
    requests: state.requests.filter((request) => request.id !== requestId),
  })),

  on(A.declineFriendRequestFailure, (state, { error }): FriendsState => ({
    ...state,
    error,
  })),

  /* ==========================================================================
   * Cancelar solicitação enviada
   * ========================================================================== */

  on(A.cancelFriendRequest, (state, { requestId }): FriendsState => ({
    ...state,
    error: null,

    /**
     * Loading fino por requestId.
     *
     * Evita bloquear visualmente a lista inteira e permite botão específico
     * mostrar estado "cancelando".
     */
    cancelingOutboundRequestIds: addUniqueId(
      state.cancelingOutboundRequestIds,
      requestId
    ),
  })),

  on(A.cancelFriendRequestSuccess, (state, { requestId }): FriendsState => ({
    ...state,
    cancelingOutboundRequestIds: removeId(
      state.cancelingOutboundRequestIds,
      requestId
    ),

    /**
     * Remove localmente da aba ENVIADAS.
     * A sincronização curta pós-mutação e o realtime confirmam em seguida.
     */
    outboundRequests: state.outboundRequests.filter(
      (request) => request.id !== requestId
    ),
  })),

  on(A.cancelFriendRequestFailure, (state, { requestId, error }): FriendsState => ({
    ...state,
    cancelingOutboundRequestIds: removeId(
      state.cancelingOutboundRequestIds,
      requestId
    ),
    error,
  })),

  /* ==========================================================================
   * Bloqueios
   * ========================================================================== */

  on(A.loadBlockedUsers, (state): FriendsState => ({
    ...state,
    loadingBlocked: true,
    blockError: null,
  })),

  on(A.loadBlockedUsersSuccess, (state, { blocked }): FriendsState => ({
    ...state,
    loadingBlocked: false,
    blocked,
  })),

  on(A.loadBlockedUsersFailure, (state, { error }): FriendsState => ({
    ...state,
    loadingBlocked: false,
    blockError: error,
  })),

  on(A.blockUserSuccess, (state, { ownerUid, targetUid }): FriendsState => {
    const safeTargetUid = normalizeUid(targetUid);

    const exists = state.blocked.some(
      (blockedUser) => blockedUser.uid === safeTargetUid
    );

    if (exists) {
      return {
        ...state,
        blockError: null,
      };
    }

    /**
     * Entrada otimista local.
     *
     * O backend/Firestore deve trazer os timestamps reais depois.
     */
    const entry: BlockedUserActive = {
      uid: safeTargetUid,
      isBlocked: true,
      reason: undefined,
      blockedAt: null,
      unblockedAt: null,
      actorUid: ownerUid ?? '',
      updatedAt: null,
    };

    return {
      ...state,
      blocked: [...state.blocked, entry],
      blockError: null,
    };
  }),

  on(A.blockUserFailure, (state, { error }): FriendsState => ({
    ...state,
    blockError: error,
  })),

  on(A.unblockUserSuccess, (state, { targetUid }): FriendsState => ({
    ...state,
    blocked: state.blocked.filter(
      (blockedUser) => blockedUser.uid !== normalizeUid(targetUid)
    ),
    blockError: null,
  })),

  on(A.unblockUserFailure, (state, { error }): FriendsState => ({
    ...state,
    blockError: error,
  })),

  /* ==========================================================================
   * Busca e configurações
   * ========================================================================== */

  on(A.loadSearchResultsSuccess, (state, { results }): FriendsState => ({
    ...state,
    searchResults: results,
  })),

  on(A.loadSearchResultsFailure, (state, { error }): FriendsState => ({
    ...state,
    error,
  })),

  on(A.updateFriendSettings, (state, { settings }): FriendsState => ({
    ...state,
    settings,
  })),

  /* ==========================================================================
   * Realtime — solicitações recebidas
   * ========================================================================== */

  on(RT.startInboundRequestsListener, (state): FriendsState => ({
    ...state,
    loadingRequests: true,
    error: null,
  })),

  on(RT.inboundRequestsChanged, (state, { requests }): FriendsState => ({
    ...state,
    loadingRequests: false,
    requests,
  })),

  on(RT.stopInboundRequestsListener, (state): FriendsState => ({
    ...state,
    loadingRequests: false,
  })),

  /* ==========================================================================
   * Realtime — solicitações enviadas
   * ========================================================================== */

  on(RT.startOutboundRequestsListener, (state): FriendsState => ({
    ...state,
    loadingOutboundRequests: true,
    error: null,
  })),

  on(RT.outboundRequestsChanged, (state, { requests }): FriendsState => ({
    ...state,
    loadingOutboundRequests: false,
    outboundRequests: requests,
  })),

  on(RT.stopOutboundRequestsListener, (state): FriendsState => ({
    ...state,
    loadingOutboundRequests: false,
  })),

  /* ==========================================================================
   * Realtime — amigos
   * ========================================================================== */

  on(RT.startFriendsListener, (state): FriendsState => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(RT.friendsChanged, (state, { friends }): FriendsState => ({
    ...state,
    loading: false,

    /**
     * Proteção contra snapshot atrasado.
     *
     * Não limpamos tombstones aqui.
     * A limpeza acontece em effect com timer após endFriendshipSuccess.
     */
    friends: filterRemovedFriends(
      friends,
      state.locallyRemovedFriendUids
    ),
  })),

  on(RT.stopFriendsListener, (state): FriendsState => ({
    ...state,
    loading: false,
  })),

  /* ==========================================================================
   * Reset de sessão
   * ========================================================================== */

  on(logoutSuccess, (): FriendsState => initialState),

  on(authSessionChanged, (state, { uid }): FriendsState =>
    uid ? state : initialState
  )
);