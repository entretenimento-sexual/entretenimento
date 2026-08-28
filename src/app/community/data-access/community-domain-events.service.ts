import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type CommunityDiscoveryChangeReason =
  | 'created'
  | 'membership_changed'
  | 'invite_accepted'
  | 'settings_changed'
  | 'ownership_changed'
  | 'archived'
  | 'content_changed';

export interface CommunityDiscoveryChangedEvent {
  readonly reason: CommunityDiscoveryChangeReason;
  readonly communityId: string | null;
}

/**
 * Canal de domínio entre mutations de Community e projeções locais derivadas.
 * Repositories publicam apenas o fato ocorrido; consumidores como o cache de
 * descoberta decidem como reagir. NgRx não é conhecido pela camada data-access.
 */
@Injectable({ providedIn: 'root' })
export class CommunityDomainEventsService {
  private readonly discoveryChangedSubject =
    new Subject<CommunityDiscoveryChangedEvent>();

  readonly discoveryChanged$ = this.discoveryChangedSubject.asObservable();

  notifyDiscoveryChanged(
    reason: CommunityDiscoveryChangeReason,
    communityId: string | null = null
  ): void {
    const normalizedCommunityId = String(communityId ?? '').trim() || null;
    this.discoveryChangedSubject.next({
      reason,
      communityId: normalizedCommunityId,
    });
  }
}
