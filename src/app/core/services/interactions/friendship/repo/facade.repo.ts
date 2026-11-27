// src/app/core/services/interactions/friendship/repo/facade.repo.ts
// Fachada de leitura do domínio de amizade no cliente.
import { Injectable, inject } from '@angular/core';
import { FriendsRepo } from './friends.repo';
import { BlocksRepo } from './blocks.repo';
import { RequestsRepo, type PendingRequestConsumer } from './requests.repo';
import { map, Observable, of } from 'rxjs';
import type { FriendsPageCursor } from '../../../../interfaces/friendship/friend.interface';
import { IUserDados } from '../../../../interfaces/iuser-dados';
import {
  PublicProfileReadBoundaryService,
} from '../../../discovery/public-profile-read-boundary.service';

@Injectable({ providedIn: 'root' })
export class FriendshipRepo {
  private friends = inject(FriendsRepo);
  private blocks = inject(BlocksRepo);
  private reqs = inject(RequestsRepo);
  private publicProfileRead = inject(PublicProfileReadBoundaryService);

  /* Friends */
  listFriends(uid: string) { return this.friends.listFriends(uid); }

  /**
 * Amigos em tempo real.
 *
 * Expõe o listener do FriendsRepo pela fachada FriendshipRepo,
 * mantendo o FriendshipService desacoplado da implementação interna.
 */
watchFriends(uid: string) {
  return this.friends.watchFriends(uid);
}

  prepareEndFriendship(uid: string, friendUid: string) {
    return this.friends.prepareEndFriendship(uid, friendUid);
  }

  watchFriendsPage(uid: string, pageSize = 24) {
    return this.friends.watchFriendsPage(uid, pageSize);
  }

  /* Blocks — leitura apenas; writes passam por FriendshipService/callables */
  listBlocked(uid: string) { return this.blocks.listBlocked(uid); }
  watchBlocked(ownerUid: string, targetUid: string) {
    return this.blocks.watchBlocked(ownerUid, targetUid);
  }

  watchBlockedUids(ownerUid: string) {
    return this.blocks.watchBlockedUids(ownerUid);
  }

  /* Requests */
  listInboundRequests(uid: string, consumer?: PendingRequestConsumer) { return consumer ? this.reqs.listInboundRequests(uid, consumer) : this.reqs.listInboundRequests(uid); }
  listOutboundRequests(uid: string, consumer?: PendingRequestConsumer) { return consumer ? this.reqs.listOutboundRequests(uid, consumer) : this.reqs.listOutboundRequests(uid); }
  watchInboundRequests(uid: string, consumer?: PendingRequestConsumer) { return consumer ? this.reqs.watchInboundRequests(uid, consumer) : this.reqs.watchInboundRequests(uid); }
  watchOutboundRequests(uid: string, consumer?: PendingRequestConsumer) { return consumer ? this.reqs.watchOutboundRequests(uid, consumer) : this.reqs.watchOutboundRequests(uid); }

  /**
   * Busca pública por apelido.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - removido query em /users com nicknameLower
   *
   * Motivo:
   * - fluxo social/público usa a projeção public_profiles;
   * - enumeração client-side foi encerrada;
   * - busca por apelido atravessa a boundary backend-time canônica.
   */
  searchUsers(term: string): Observable<IUserDados[]> {
    const q = (term ?? '').trim().toLowerCase();
    if (!q) return of([] as IUserDados[]);

    return this.publicProfileRead.read$({
      mode: 'all',
      pageSize: 40,
      filters: { nicknamePrefix: q },
    }).pipe(
      map((response) =>
        (response.items ?? []).map((raw) => ({
          ...(raw as unknown as IUserDados),
          uid: String(raw['uid'] ?? '').trim(),
          // Idade exata não integra a projeção pública.
          age: null,
        }))
      )
    );
  }

  listFriendsPage(uid: string, pageSize = 24, after: FriendsPageCursor | null = null) {
    return this.friends.listFriendsPage(uid, pageSize, after);
  }

}