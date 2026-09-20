// src/app/community/data-access/official-community-create.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, tap } from 'rxjs';

import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import {
  type OfficialCommunityCreateCommand,
  type OfficialCommunityCreateResult,
  normalizeOfficialCommunityCreateResult,
} from './official-community-create.model';

@Injectable({ providedIn: 'root' })
export class OfficialCommunityCreateRepository {
  private readonly functions = inject(Functions);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);

  private readonly createCallable = httpsCallable<
    OfficialCommunityCreateCommand,
    unknown
  >(this.functions, 'createOfficialCommunity');

  createOfficialCommunity$(
    command: OfficialCommunityCreateCommand
  ): Observable<OfficialCommunityCreateResult> {
    return defer(() => from(this.createCallable(command))).pipe(
      map((result) => {
        const normalized = normalizeOfficialCommunityCreateResult(result.data);
        if (!normalized) {
          throw new Error('Resposta de criação da Comunidade Oficial inválida.');
        }
        return normalized;
      }),
      tap((result) => {
        this.discoveryCache.invalidateCurrentViewer({
          sourceType: result.target.type === 'venue' ? 'venue' : 'community',
        });
      })
    );
  }
}
