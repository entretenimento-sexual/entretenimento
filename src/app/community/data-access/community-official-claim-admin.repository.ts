// src/app/community/data-access/community-official-claim-admin.repository.ts

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityOfficialClaimAdminReviewCommand,
  CommunityOfficialClaimReviewQueueResponse,
  normalizeCommunityOfficialClaimReviewQueueResponse,
} from './community-official-claim-admin.model';

@Injectable({ providedIn: 'root' })
export class CommunityOfficialClaimAdminRepository {
  private readonly functions = inject(Functions);

  private readonly getQueueCallable = httpsCallable<void, unknown>(
    this.functions,
    'getCommunityOfficialClaimReviewQueue'
  );

  private readonly reviewCallable = httpsCallable<
    CommunityOfficialClaimAdminReviewCommand,
    { associationKey: string; status: string }
  >(this.functions, 'reviewCommunityOfficialClaim');

  getReviewQueue$(): Observable<CommunityOfficialClaimReviewQueueResponse> {
    return defer(() => from(this.getQueueCallable())).pipe(
      map((result) => {
        const response = normalizeCommunityOfficialClaimReviewQueueResponse(
          result.data
        );
        if (!response) {
          throw new Error('Resposta da fila de Comunidades Oficiais inválida.');
        }
        return response;
      })
    );
  }

  review$(
    command: CommunityOfficialClaimAdminReviewCommand
  ): Observable<{ associationKey: string; status: string }> {
    return defer(() => from(this.reviewCallable(command))).pipe(
      map((result) => {
        const associationKey = String(result.data?.associationKey ?? '').trim();
        const status = String(result.data?.status ?? '').trim();
        if (!associationKey || !status) {
          throw new Error('Resposta de revisão de Comunidade Oficial inválida.');
        }
        return { associationKey, status };
      })
    );
  }
}
