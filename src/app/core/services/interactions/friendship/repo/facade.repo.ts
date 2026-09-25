// src/app/core/services/interactions/friendship/repo/facade.repo.ts
// Fachada de leitura do domínio de amizade no cliente.
import { Injectable, inject } from '@angular/core';
import { FriendsRepo } from './friends.repo';
import { BlocksRepo } from './blocks.repo';
import { RequestsRepo } from './requests.repo';
import { map, Observable, of } from 'rxjs';
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

  /* Blocks — leitura apenas; writes passam por FriendshipService/callables */
  listBlocked(uid: string) { return this.blocks.listBlocked(uid); }

  /* Requests */
  listInboundRequests(uid: string) { return this.reqs.listInboundRequests(uid); }
  listOutboundRequests(uid: string) { return this.reqs.listOutboundRequests(uid); }
  watchInboundRequests(uid: string) { return this.reqs.watchInboundRequests(uid); }
  watchOutboundRequests(uid: string) { return this.reqs.watchOutboundRequests(uid); }

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

  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.friends.listFriendsPage(uid, pageSize, after);
  }

}