// src/app/community/data-access/community-official-claim.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  MyCommunityOfficialClaimResponse,
  normalizeMyCommunityOfficialClaimResponse,
} from './community-official-claim.model';
import type { CommunityOfficialTarget } from './community-official-target.policy';

@Injectable({ providedIn: 'root' })
export class CommunityOfficialClaimRepository {
  private readonly functions = inject(Functions);

  private readonly getMyCommunityOfficialClaimCallable = httpsCallable<
    { target: CommunityOfficialTarget },
    unknown
  >(this.functions, 'getMyCommunityOfficialClaim');

  getMyCommunityOfficialClaim$(
    target: CommunityOfficialTarget
  ): Observable<MyCommunityOfficialClaimResponse> {
    const normalizedTarget: CommunityOfficialTarget = {
      type: target.type,
      id: String(target.id ?? '').trim(),
    };

    return defer(() =>
      from(this.getMyCommunityOfficialClaimCallable({ target: normalizedTarget }))
    ).pipe(
      map((result) => {
        const response = normalizeMyCommunityOfficialClaimResponse(result.data);
        if (!response) {
          throw new Error('Resposta de vínculo oficial inválida.');
        }
        return response;
      })
    );
  }
}
