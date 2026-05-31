// src/app/core/services/interactions/friendship/repo/friends.repo.ts
// -----------------------------------------------------------------------------
// FRIENDS REPOSITORY
// -----------------------------------------------------------------------------
// Responsável por ler relações de amizade/conexão do usuário.
//
// Direção atual:
// - a relação em si vem de /users/{uid}/friends/{friendUid};
// - os dados públicos do card vêm de /public_profiles/{friendUid};
// - nunca usamos /users/{friendUid} para renderização social pública;
// - se o public_profile estiver ausente, o card ainda funciona com fallback;
// - a lista continua paginada e ordenada por lastInteractionAt.
//
// Segurança digital:
// - a amizade é uma relação privada do usuário autenticado;
// - o card social só recebe dados públicos;
// - dados sensíveis de conta permanecem fora da UI pública;
// - falha ao hidratar um perfil público não derruba a lista inteira.
//
// Expansão futura:
// - este modelo funciona para web e mobile;
// - depois podemos otimizar com snapshot público duplicado no friend edge,
//   gravado por Cloud Function no aceite da amizade;
// - por enquanto, a fonte pública canônica permanece /public_profiles.
// -----------------------------------------------------------------------------

import { Injectable, EnvironmentInjector } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  DocumentReference,
  collection,
  getDocs,
  query,
  limit,
  orderBy,
  startAfter,
} from '@angular/fire/firestore';

import {
  CollectionReference,
  DocumentData,
  DocumentSnapshot,
  Timestamp,
} from 'firebase/firestore';

import { Observable } from 'rxjs';

import { FirestoreRepoBase } from './base.repo';
import type {
  FriendDoc,
  Friend,
} from '../../../../interfaces/friendship/friend.interface';

import { environment } from 'src/environments/environment';
import { sanitizeFriendForStore } from 'src/app/store/utils/friend-store.serializer';
import { toEpoch } from '../../../../utils/epoch-utils';

type FriendForCard = Friend & {
  uid: string;
  nickname: string;
  name: string;
  displayName: string;
  photoURL: string;
  avatarUrl: string;
  isOnline: boolean;
  municipio: string;
  estado: string;
  gender: string | null;
  orientation: string | null;
  role: string;
  isSubscriber: boolean;
  emailVerified: boolean;
  distanciaKm: number | null;
};

@Injectable({ providedIn: 'root' })
export class FriendsRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) {
    super(db, env);
  }

  private readonly debug = !environment.production;

  private dbg(msg: string, extra?: unknown): void {
    if (this.debug) {
      console.log(`[FriendsRepo] ${msg}`, extra ?? '');
    }
  }

  /**
   * Mantido por compatibilidade com chamadas antigas.
   *
   * Observação:
   * - o fluxo seguro novo deve validar amizade bilateral por Cloud Function;
   * - este documento global /friends/{pairKey} não deve ser a autoridade
   *   principal da relação social.
   */
  private key(a: string, b: string): string {
    return [a, b].sort().join('_');
  }

  private ref(a: string, b: string): DocumentReference<FriendDoc> {
    return doc(this.db, `friends/${this.key(a, b)}`) as DocumentReference<FriendDoc>;
  }

  /** Valida amizade existente no caminho legado/global. */
  getFriendDoc$(a: string, b: string): Observable<DocumentSnapshot<FriendDoc>> {
    return this.inCtx$(() => getDoc(this.ref(a, b)));
  }

  /**
   * Lista simples de amigos.
   *
   * Usada pelo bootstrap do estado de amizade. Já retorna dados enriquecidos
   * para evitar que cards exibam UID quando há public_profile disponível.
   */
  listFriends(uid: string, pageSize = 24): Observable<FriendForCard[]> {
    return this.inCtx$(async () => {
      const safeUid = this.normalizeText(uid);

      if (!safeUid) {
        return [];
      }

      const col = collection(this.db, `users/${safeUid}/friends`);
      const qRef = query(col, limit(pageSize));

      const snap = await getDocs(qRef);

      const items = snap.docs.map((snapshot) => {
        const data = snapshot.data() as FriendDoc;

        return sanitizeFriendForStore({
          ...data,
          friendUid: this.resolveFriendUid(data, snapshot.id),
        });
      });

      const hydrated = await this.hydrateFriendsWithPublicProfiles(items);

      this.dbg('listFriends', {
        uid: safeUid,
        count: hydrated.length,
        hydrated: hydrated.filter((item) => item.nickname !== item.uid).length,
      });

      return hydrated;
    });
  }

  /**
   * Página de amigos, ordenada por lastInteractionAt desc.
   *
   * Store usa epoch number. Firestore usa Timestamp.
   */
  listFriendsPage(
    uid: string,
    pageSize = 24,
    after: number | null = null
  ): Observable<{
    items: FriendForCard[];
    nextAfter: number | null;
    reachedEnd: boolean;
  }> {
    return this.inCtx$(async () => {
      const safeUid = this.normalizeText(uid);

      if (!safeUid) {
        return {
          items: [],
          nextAfter: null,
          reachedEnd: true,
        };
      }

      const col = collection(
        this.db,
        `users/${safeUid}/friends`
      ) as CollectionReference<DocumentData>;

      let qRef = query(
        col,
        orderBy('lastInteractionAt', 'desc'),
        limit(pageSize)
      );

      if (after != null) {
        const cursor = Timestamp.fromMillis(after);

        qRef = query(
          col,
          orderBy('lastInteractionAt', 'desc'),
          startAfter(cursor),
          limit(pageSize)
        );
      }

      const snap = await getDocs(qRef);

      const docs = snap.docs.map((snapshot) => ({
        id: snapshot.id,
        data: snapshot.data() as FriendDoc,
      }));

      const items = docs.map(({ id, data }) =>
        sanitizeFriendForStore({
          ...data,
          friendUid: this.resolveFriendUid(data, id),
        })
      );

      const hydrated = await this.hydrateFriendsWithPublicProfiles(items);

      const lastRaw = docs.at(-1)?.data?.lastInteractionAt;
      const nextAfter = toEpoch(lastRaw);
      const reachedEnd = docs.length < pageSize;

      this.dbg('listFriendsPage', {
        uid: safeUid,
        pageSize,
        after,
        returned: hydrated.length,
        hydrated: hydrated.filter((item) => item.nickname !== item.uid).length,
        nextAfter,
        reachedEnd,
      });

      return {
        items: hydrated,
        nextAfter,
        reachedEnd,
      };
    });
  }

  /**
   * Resolve o UID real do amigo.
   *
   * Em dados corretos:
   * - documentId = friendUid
   * - data.friendUid = friendUid
   *
   * O fallback pelo ID do documento ajuda nos dados manuais do Emulator.
   */
  private resolveFriendUid(data: Partial<FriendDoc>, documentId: string): string {
    return this.normalizeText(data.friendUid) || this.normalizeText(documentId);
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private normalizeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    return null;
  }

  /**
   * Hidrata a relação de amizade com o perfil público.
   *
   * Importante:
   * - falha individual não quebra a lista;
   * - dados privados não são lidos;
   * - o fallback mantém a UI navegável.
   */
  private async hydrateFriendsWithPublicProfiles(
    friends: Friend[]
  ): Promise<FriendForCard[]> {
    const profiles = await Promise.all(
      friends.map((friend) => this.safeReadPublicProfile(friend.friendUid))
    );

    return friends.map((friend, index) =>
      this.mergeFriendWithPublicProfile(friend, profiles[index])
    );
  }

private async safeReadPublicProfile(
  friendUid: string
): Promise<DocumentData | null> {
  const safeUid = this.normalizeText(friendUid);

  if (!safeUid) {
    return null;
  }

  try {
    const snapshot = await this.inCtxSync(() => {
      const profileRef = doc(this.db, `public_profiles/${safeUid}`);
      return getDoc(profileRef);
    });

    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    this.dbg('public profile hydration failed', {
      friendUid: safeUid,
      error: String((error as Error)?.message ?? error),
    });

    return null;
  }
}

  /**
   * Junta:
   * - relação: since, lastInteractionAt, friendUid;
   * - perfil público: nickname, foto, localização e metadados públicos.
   */
  private mergeFriendWithPublicProfile(
    friend: Friend,
    profile: DocumentData | null
  ): FriendForCard {
    const uid = this.normalizeText(profile?.['uid']) ||
      this.normalizeText(friend.friendUid);

    const nickname = this.normalizeText(profile?.['nickname']) ||
      this.normalizeText(friend.nickname) ||
      uid ||
      'Perfil';

    const photoURL =
      this.normalizeText(profile?.['photoURL']) ||
      this.normalizeText(profile?.['avatarUrl']) ||
      this.normalizeText(profile?.['photoUrl']);

    const distanciaKm =
      this.normalizeNumber(friend.distanceKm) ??
      this.normalizeNumber(profile?.['distanciaKm']) ??
      this.normalizeNumber(profile?.['distanceKm']) ??
      null;

    return {
      ...friend,

      uid,
      friendUid: uid,

      nickname,
      name: nickname,
      displayName: nickname,

      photoURL,
      avatarUrl: photoURL,

      isOnline: Boolean(profile?.['isOnline'] ?? profile?.['online'] ?? false),

      municipio:
        this.normalizeText(profile?.['municipio']) ||
        this.normalizeText(profile?.['city']),

      estado:
        this.normalizeText(profile?.['estado']) ||
        this.normalizeText(profile?.['state']),

      gender: this.normalizeText(profile?.['gender']) || null,
      orientation: this.normalizeText(profile?.['orientation']) || null,

      role: this.normalizeText(profile?.['role']) || 'free',
      isSubscriber: Boolean(profile?.['isSubscriber'] ?? false),
      emailVerified: Boolean(profile?.['emailVerified'] ?? false),

      distanciaKm,
      distanceKm: distanciaKm ?? undefined,
    };
  }
}