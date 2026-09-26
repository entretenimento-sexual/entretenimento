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
// - se o public_profile não estiver adulto/vigente, o card falha fechado;
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
  collection,
  getDocs,
  query,
  limit,
  orderBy,
  startAfter,
  collectionSnapshots,
} from '@angular/fire/firestore';

import {
  CollectionReference,
  DocumentData,
  Timestamp,
} from 'firebase/firestore';

import { defer, firstValueFrom, Observable, of, switchMap } from 'rxjs';

import { FirestoreRepoBase } from './base.repo';
import type {
  FriendDoc,
  Friend,
} from '../../../../interfaces/friendship/friend.interface';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { sanitizeFriendForStore } from 'src/app/store/utils/friend-store.serializer';
import { toEpoch } from '../../../../utils/epoch-utils';
import {
  PublicProfileReadBoundaryService,
} from '../../../discovery/public-profile-read-boundary.service';

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
  constructor(
  db: Firestore,
  env: EnvironmentInjector,
  private readonly privacyDebug: PrivacyDebugLoggerService,
  private readonly publicProfileRead: PublicProfileReadBoundaryService
) {
  super(db, env);
}

private dbg(msg: string, extra?: unknown): void {
  this.privacyDebug.log('friends', msg, extra);
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
 * Listener realtime da lista de amigos.
 *
 * Por que existe:
 * - listFriends() é leitura pontual;
 * - aceitar/desfazer amizade altera as duas arestas via Cloud Function;
 * - este listener permite que os dois usuários vejam a mudança sem refresh;
 * - a UI continua usando apenas dados públicos de /public_profiles.
 *
 * Observação técnica:
 * - não usamos this.inCtx$() aqui porque ele pode inferir
 *   Observable<Observable<FriendForCard[]>>;
 * - usamos defer() para iniciar sob demanda;
 * - usamos inCtxSync() apenas para criar query/listener dentro do Injection Context.
 */
watchFriends(uid: string, pageSize = 24): Observable<FriendForCard[]> {
  return defer(() => {
    const safeUid = this.normalizeText(uid);

    if (!safeUid) {
      return of([] as FriendForCard[]);
    }

    const source$ = this.inCtxSync(() => {
      const col = collection(
        this.db,
        `users/${safeUid}/friends`
      ) as CollectionReference<DocumentData>;

      const qRef = query(
        col,
        orderBy('lastInteractionAt', 'desc'),
        limit(pageSize)
      );

      return collectionSnapshots(qRef);
    });

    return source$.pipe(
      switchMap(async (snapshots) => {
        const items = snapshots.map((snapshot) => {
          const data = snapshot.data() as FriendDoc;

          return sanitizeFriendForStore({
            ...data,
            friendUid: this.resolveFriendUid(data, snapshot.id),
          });
        });

        const hydrated = await this.hydrateFriendsWithPublicProfiles(items);

        this.dbg('watchFriends', {
          uid: safeUid,
          count: hydrated.length,
          hydrated: hydrated.filter((item) => item.nickname !== item.uid).length,
        });

        return hydrated;
      })
    );
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
   * - dados privados não são lidos;
   * - ausência/expiração do perfil remove o card da lista;
   * - falha da boundary retorna vazio para não reexpor snapshot legado.
   */
  private async hydrateFriendsWithPublicProfiles(
    friends: Friend[]
  ): Promise<FriendForCard[]> {
    const uids = Array.from(
      new Set(
        friends
          .map((friend) => this.normalizeText(friend.friendUid))
          .filter(Boolean)
      )
    );

    if (!uids.length) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.publicProfileRead.readByUids$(uids)
      );
      const profilesByUid = new Map<string, Record<string, unknown>>();

      for (const raw of response.items ?? []) {
        const uid = this.normalizeText(raw['uid']);
        if (uid) {
          profilesByUid.set(uid, raw);
        }
      }

      return friends.flatMap((friend) => {
        const uid = this.normalizeText(friend.friendUid);
        const profile = profilesByUid.get(uid);

        // A relação pode existir, mas sem perfil público adulto vigente
        // nenhum snapshot antigo da aresta pode continuar visível.
        return profile
          ? [this.mergeFriendWithPublicProfile(friend, profile)]
          : [];
      });
    } catch (error) {
      this.dbg('public profile batch hydration failed', {
        friendCount: friends.length,
        error: String((error as Error)?.message ?? error),
      });

      return [];
    }
  }

  /**
   * Junta:
   * - relação: since, lastInteractionAt, friendUid;
   * - perfil público: nickname, foto, localização e metadados públicos.
   */
  private mergeFriendWithPublicProfile(
    friend: Friend,
    profile: Record<string, unknown>
  ): FriendForCard {
    const uid = this.normalizeText(profile['uid']) ||
      this.normalizeText(friend.friendUid);

    const nickname = this.normalizeText(profile['nickname']) || uid;

    const photoURL =
      this.normalizeText(profile['photoURL']) ||
      this.normalizeText(profile['avatarUrl']) ||
      this.normalizeText(profile['photoUrl']);

    const distanciaKm =
      this.normalizeNumber(friend.distanceKm) ??
      this.normalizeNumber(profile['distanciaKm']) ??
      this.normalizeNumber(profile['distanceKm']) ??
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

      isOnline: Boolean(profile['isOnline'] ?? profile['online'] ?? false),

      municipio:
        this.normalizeText(profile['municipio']) ||
        this.normalizeText(profile['city']),

      estado:
        this.normalizeText(profile['estado']) ||
        this.normalizeText(profile['state']),

      gender: this.normalizeText(profile['gender']) || null,
      orientation: this.normalizeText(profile['orientation']) || null,

      role: this.normalizeText(profile['role']) || 'free',
      isSubscriber: Boolean(profile['isSubscriber'] ?? false),
      emailVerified: Boolean(profile['emailVerified'] ?? false),

      distanciaKm,
      distanceKm: distanciaKm ?? undefined,
    };
  }
}