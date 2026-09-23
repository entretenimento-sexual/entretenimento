// src/app/core/services/interactions/friendship/repo/facade.repo.ts
// Nomes trocados podem causar confusão, exporta FriendshipRepo
// Não esquecer comentários e ferramentas de debug
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
} from '@angular/fire/firestore';
import { FriendsRepo } from './friends.repo';
import { BlocksRepo } from './blocks.repo';
import { CooldownRepo } from './cooldown.repo';
import { RequestsRepo } from './requests.repo';
import { map, from, Observable, of } from 'rxjs';
import { IUserDados } from '../../../../interfaces/iuser-dados';
import {
  PublicProfileReadBoundaryService,
} from '../../../discovery/public-profile-read-boundary.service';

@Injectable({ providedIn: 'root' })
export class FriendshipRepo {
  private db = inject(Firestore);
  private friends = inject(FriendsRepo);
  private blocks = inject(BlocksRepo);
  private cd = inject(CooldownRepo);
  private reqs = inject(RequestsRepo);
  private publicProfileRead = inject(PublicProfileReadBoundaryService);

  /* Friends */
  getFriendDoc$(a: string, b: string) { return this.friends.getFriendDoc$(a, b); }
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
  getBlockedDoc$(owner: string, target: string) { return this.blocks.getBlockedDoc$(owner, target); }
  listBlocked(uid: string) { return this.blocks.listBlocked(uid); }

  /* Requests */
  listInboundRequests(uid: string) { return this.reqs.listInboundRequests(uid); }
  listOutboundRequests(uid: string) { return this.reqs.listOutboundRequests(uid); }
  findDuplicatePending(a: string, b: string) { return this.reqs.findDuplicatePending(a, b); }
  createRequest(a: string, b: string, m?: string) { return this.reqs.createRequest(a, b, m); }
  acceptRequestBatch(id: string, a: string, b: string) { return this.reqs.acceptRequestBatch(id, a, b); }
  declineRequest(id: string) { return this.reqs.declineRequest(id); }
  declineRequestWithCooldown(id: string, ms: number) { return this.reqs.declineRequestWithCooldown(id, ms); }
  cancelOutboundRequest(id: string) { return this.reqs.cancelOutboundRequest(id); }
  watchInboundRequests(uid: string) { return this.reqs.watchInboundRequests(uid); }
  watchOutboundRequests(uid: string) { return this.reqs.watchOutboundRequests(uid); }

  /* Cooldown */
  readCooldown(a: string, b: string) { return this.cd.readCooldown(a, b); }
  setCooldown(a: string, b: string, until: Date) { return this.cd.setCooldown(a, b, until); }

  /* Checks reusados no service */
  isAlreadyFriends(a: string, b: string) { return this.getFriendDoc$(a, b); }
  isBlockedByA(owner: string, target: string) { return this.getBlockedDoc$(owner, target); }

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

  /**
   * Perfil público de terceiro.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - removido get em /users/{uid}
   *
   * Motivo:
   * - para fluxo público/social, a fonte correta é /public_profiles/{uid}
   */
  getUserByUid(uid: string): Observable<IUserDados | null> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return of(null);

    return from(getDoc(doc(this.db, `public_profiles/${safeUid}`))).pipe(
      map(d => {
        if (!d.exists()) return null;
        const data = d.data() as any;
        return {
          uid: data.uid ?? d.id,
          ...data,
        } as IUserDados;
      })
    );
  }

  listFriendsPage(uid: string, pageSize = 24, after: number | null = null) {
    return this.friends.listFriendsPage(uid, pageSize, after);
  }

  /* util */
  getDocExists(path: string) { return this.reqs.getDocExists(path); }
}