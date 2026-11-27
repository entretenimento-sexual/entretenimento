import type { User } from 'firebase/auth';
import type { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import type { Friend, FriendshipVersion } from '../../../../interfaces/friendship/friend.interface';
import { friendshipVersionOf, isFriendshipAfter } from '../../../../utils/friendship-generation';

type SessionScope = Pick<AuthSessionService, 'currentAuthUser' |
  'terminationVersionSnapshot' | 'isTerminatingSnapshot'>;

interface Scope {
  readonly user: User;
  readonly version: number;
  readonly ended: Map<string, FriendshipVersion | null>;
}

/**
 * Barreira local de projeção, não autorização. A confirmação da callable
 * delimita a geração removida. Não expira por relógio e não é liberada por
 * ausência em uma página limitada, cache ou perfil público indisponível.
 */
export class EndedFriendshipFence {
  private scope?: Scope;
  constructor(private readonly session: SessionScope) {}

  private current(uid: string): Scope | undefined {
    const user = this.session.currentAuthUser;
    const version = this.session.terminationVersionSnapshot;
    if (this.scope && (this.scope.user !== user || this.scope.version !== version ||
        this.session.isTerminatingSnapshot)) this.scope = undefined;
    if (!user || user.uid !== uid || this.session.isTerminatingSnapshot) return undefined;
    return this.scope ??= { user, version, ended: new Map() };
  }

  /** Captura a sessão no início da mutação, antes de abrir a callable. */
  capture(uid: string, friendUid: string): (value: FriendshipVersion | null) => void {
    const scope = this.current(uid);
    return value => {
      if (!scope || this.current(uid) !== scope || !friendUid) return;
      const cutoff = friendshipVersionOf(value);
      const previous = scope.ended.get(friendUid);
      if (previous === null) return; // contrato legado: fail closed durante a sessão
      if (previous === undefined || cutoff === null || isFriendshipAfter(cutoff, previous)) {
        scope.ended.set(friendUid, cutoff);
      }
    };
  }

  filter<T extends Friend>(uid: string, items: T[]): T[] {
    const scope = this.current(uid);
    if (!scope) return [];
    return items.filter(item => {
      const cutoff = scope.ended.get(item.friendUid);
      return cutoff === undefined || isFriendshipAfter(item.sinceVersion, cutoff);
    });
  }
}
