// src/app/community/data-access/community-create.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, tap } from 'rxjs';

import {
  CommunityCreateCommand,
  CommunityCreateResult,
  normalizeCommunityCreateResult,
} from './community-create.model';
import {
  CommunityCreationCapability,
  normalizeCommunityCreationCapability,
} from './community-capacity.model';
import { CommunityDomainEventsService } from './community-domain-events.service';

@Injectable({ providedIn: 'root' })
export class CommunityCreateRepository {
  private readonly functions = inject(Functions);
  private readonly domainEvents = inject(CommunityDomainEventsService);

  private readonly createCommunityCallable = httpsCallable<
    CommunityCreateCommand,
    unknown
  >(this.functions, 'createCommunity');

  private readonly getCreationCapabilityCallable = httpsCallable<
    Record<string, never>,
    unknown
  >(this.functions, 'getCommunityCreationCapability');

  getCreationCapability$(): Observable<CommunityCreationCapability> {
    return defer(() => from(this.getCreationCapabilityCallable({}))).pipe(
      map((result) => {
        const normalized = normalizeCommunityCreationCapability(result.data);

        if (!normalized) {
          throw new Error('Resposta de permissão para criar Comunidade inválida.');
        }

        return normalized;
      })
    );
  }

  createCommunity$(
    command: CommunityCreateCommand
  ): Observable<CommunityCreateResult> {
    return defer(() => from(this.createCommunityCallable(command))).pipe(
      map((result) => {
        const normalized = normalizeCommunityCreateResult(result.data);

        if (!normalized) {
          throw new Error('Resposta de criação da Comunidade inválida.');
        }

        return normalized;
      }),
      tap((result) =>
        this.domainEvents.notifyDiscoveryChanged('created', result.communityId)
      )
    );
  }
}
