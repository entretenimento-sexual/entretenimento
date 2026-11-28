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
// - perfil público ausente é omitido; falha técnica não é lista vazia.
//
// Expansão futura:
// - este modelo funciona para web e mobile;
// - depois podemos otimizar com snapshot público duplicado no friend edge,
//   gravado por Cloud Function no aceite da amizade;
// - por enquanto, a fonte pública canônica permanece /public_profiles.
// -----------------------------------------------------------------------------
import { Injectable, EnvironmentInjector, inject } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  getDocsFromServer,
  query,
  limit,
  orderBy,
  documentId,
  startAfter,
  collectionSnapshots,
} from '@angular/fire/firestore';

import {
  CollectionReference,
  DocumentData,
} from 'firebase/firestore';

import { defer, firstValueFrom, map, Observable, of } from 'rxjs';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { SharedFriendsWatch } from './shared-friends-watch';
import { EndedFriendshipFence } from './ended-friendship-fence';
import { friendshipVersionOf } from '../../../../utils/friendship-generation';

import { FirestoreRepoBase } from './base.repo';
import type {
  FriendDoc,
  Friend,
  FriendsPageCursor,
} from '../../../../interfaces/friendship/friend.interface';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { sanitizeFriendForStore } from 'src/app/store/utils/friend-store.serializer';
import { createFriendsPageCursor, friendsPageStartAfter } from './friends-page-cursor';
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
  private readonly session = inject(AuthSessionService);
  private readonly endedFence = new EndedFriendshipFence(this.session);
  private readonly sharedWatch = new SharedFriendsWatch(this.session,
    (entry, size, resource, event, snapshot) => {
      this.privacyDebug.log('friends', `shared-watch ${entry} ${size} ${resource} ${event} ${snapshot}`);
    });
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

  /** A primeira página e a listagem pontual usam a mesma consulta e projeção. */
  listFriends(uid: string, pageSize = 24): Observable<FriendForCard[]> {
    return defer(() => {
      // Contagem lógica opt-in, sem UID ou conteúdo de perfis.
      this.dbg('point-read start');
      return this.listFriendsPage(uid, pageSize).pipe(map(page => page.items));
    });
  }

  /** Confirmação da mutação capturada na sessão que iniciou a callable. */
  prepareEndFriendship(uid: string, friendUid: string) {
    return this.endedFence.capture(uid, friendUid);
  }

  /** Ordem total compartilhada; o desempate acompanha a direção do timestamp. */
  private friendsQuery(uid: string, pageSize: number, after: FriendsPageCursor | null = null) {
    const col = collection(this.db, `users/${uid}/friends`) as CollectionReference<DocumentData>;
    const ordered = query(col, orderBy('lastInteractionAt', 'desc'), orderBy(documentId(), 'desc'));
    return after === null
      ? query(ordered, limit(pageSize))
      : query(ordered, startAfter(...friendsPageStartAfter(after)), limit(pageSize));
  }

  private projectFriends(docs: readonly { id: string; data(): DocumentData }[]): Promise<FriendForCard[]> {
    return this.hydrateFriendsWithPublicProfiles(docs.map(snapshot => {
      const data = snapshot.data() as FriendDoc;
      return {
        ...sanitizeFriendForStore({
          ...data, friendUid: this.resolveFriendUid(data, snapshot.id),
        }),
        sinceVersion: friendshipVersionOf(data.since),
      };
    }));
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
  return this.watchFriendsPage(uid, pageSize).pipe(map(page => page.items));
}

/** Primeira página viva: a mesma hidratação e o mesmo listener do fluxo principal. */
watchFriendsPage(uid: string, pageSize = 24): Observable<{
  items: FriendForCard[];
  nextAfter: FriendsPageCursor | null;
  reachedEnd: boolean;
}> {
  return defer(() => {
    const safeUid = this.normalizeText(uid);

    if (!safeUid) {
      return of({ items: [] as FriendForCard[], nextAfter: null, reachedEnd: true });
    }

    return this.sharedWatch.watch$(safeUid, pageSize, () => this.inCtxSync(() => {
      return collectionSnapshots(this.friendsQuery(safeUid, pageSize));
    }), snapshots => defer(async () => {
        const hydrated = await this.projectFriends(snapshots);

        this.dbg('watchFriends', {
          uid: safeUid,
          count: hydrated.length,
          hydrated: hydrated.filter((item) => item.nickname !== item.uid).length,
        });

        const last = snapshots.at(-1);
        return {
          items: hydrated,
          nextAfter: last ? createFriendsPageCursor(last.id, (last.data() as FriendDoc).lastInteractionAt) : null,
          reachedEnd: snapshots.length < pageSize,
        };
      })).pipe(map(page => ({
        ...page,
        // Aplicar depois da hidratação compartilhada, inclusive para resultado tardio.
        items: this.endedFence.filter(safeUid, page.items),
      })));
  });
}

  /**
   * Página de amigos, ordenada por lastInteractionAt desc.
   *
   * Cursor serializável preserva segundos, nanossegundos e ID bruto.
   */
  listFriendsPage(
    uid: string,
    pageSize = 24,
    after: FriendsPageCursor | null = null
  ): Observable<{
    items: FriendForCard[];
    nextAfter: FriendsPageCursor | null;
    reachedEnd: boolean;
  }> {
    return defer(() => {
      const safeUid = this.normalizeText(uid);
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      return this.inCtx$(async () => {

      if (!safeUid) {
        return {
          items: [],
          nextAfter: null,
          reachedEnd: true,
        };
      }

      const pageQuery = this.friendsQuery(safeUid, pageSize, after);
      // Cauda invalidada por revisão canônica nunca volta a partir de cache
      // local antigo. Falhas seguem o tratamento centralizado da paginação.
      const snap = await (after === null ? getDocs(pageQuery) : getDocsFromServer(pageQuery));
      const hydrated = await this.projectFriends(snap.docs);
      // Cursor derivado da última aresta bruta, não do último perfil visível.
      const last = snap.docs.at(-1);
      const nextAfter = last
        ? createFriendsPageCursor(last.id, (last.data() as FriendDoc).lastInteractionAt)
        : null;
      const reachedEnd = snap.docs.length < pageSize;

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
      }).pipe(map(page => {
        // A mesma UID pode pertencer a outra sessão operacional.
        if (this.session.currentAuthUser !== user ||
            this.session.terminationVersionSnapshot !== version ||
            this.session.isTerminatingSnapshot) {
          throw Object.assign(new Error('Sessão indisponível para listar conexões.'),
            { code: 'friends/session-revoked' });
        }
        return { ...page, items: this.endedFence.filter(safeUid, page.items) };
      }));
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
   * - falha técnica é propagada ao tratamento centralizado; nunca é um vazio confirmado.
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