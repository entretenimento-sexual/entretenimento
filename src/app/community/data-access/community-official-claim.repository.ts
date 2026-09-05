// src/app/community/data-access/community-official-claim.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, throwError } from 'rxjs';

import {
  CommunityOfficialClaimCapabilityResponse,
  normalizeCommunityOfficialClaimCapabilityResponse,
} from './community-official-claim-capability.model';
import {
  MyCommunityOfficialClaimResponse,
  normalizeMyCommunityOfficialClaimResponse,
} from './community-official-claim.model';
import {
  SubmitCommunityOfficialClaimInput,
  SubmitCommunityOfficialClaimResponse,
  normalizeSubmitCommunityOfficialClaimInput,
  normalizeSubmitCommunityOfficialClaimResponse,
} from './community-official-claim-submission.model';
import type { CommunityOfficialTarget } from './community-official-target.policy';

@Injectable({ providedIn: 'root' })
export class CommunityOfficialClaimRepository {
  private readonly functions = inject(Functions);

  private readonly getMyCommunityOfficialClaimCallable = httpsCallable<
    { target: CommunityOfficialTarget },
    unknown
  >(this.functions, 'getMyCommunityOfficialClaim');

  private readonly getCapabilityCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'getCommunityOfficialClaimCapability');

  private readonly submitCallable = httpsCallable<
    SubmitCommunityOfficialClaimInput,
    unknown
  >(this.functions, 'submitCommunityOfficialClaim');

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

  getCommunityOfficialClaimCapability$(
    communityId: string
  ): Observable<CommunityOfficialClaimCapabilityResponse> {
    const normalizedCommunityId = String(communityId ?? '').trim();
    if (!normalizedCommunityId) {
      return throwError(() => new Error('Comunidade inválida para verificação oficial.'));
    }

    return defer(() =>
      from(this.getCapabilityCallable({ communityId: normalizedCommunityId }))
    ).pipe(
      map((result) => {
        const response = normalizeCommunityOfficialClaimCapabilityResponse(
          result.data
        );
        if (!response) {
          throw new Error('Resposta de elegibilidade oficial inválida.');
        }
        return response;
      })
    );
  }

  submitCommunityOfficialClaim$(
    input: SubmitCommunityOfficialClaimInput
  ): Observable<SubmitCommunityOfficialClaimResponse> {
    const normalized = normalizeSubmitCommunityOfficialClaimInput(input);
    if (!normalized) {
      return throwError(() => new Error('Solicitação de vínculo oficial inválida.'));
    }

    return defer(() => from(this.submitCallable(normalized))).pipe(
      map((result) => {
        const response = normalizeSubmitCommunityOfficialClaimResponse(result.data);
        if (!response) {
          throw new Error('Resposta de solicitação oficial inválida.');
        }
        return response;
      })
    );
  }
}
