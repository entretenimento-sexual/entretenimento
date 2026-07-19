// src/app/community/data-access/community-preview.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityDiscoveryPage,
  CommunityDiscoveryPageRequest,
  CommunityPreviewResponse,
  normalizeCommunityDiscoveryPageResponse,
  normalizeCommunityPreviewResponse,
} from './community-preview.model';

@Injectable({ providedIn: 'root' })
export class CommunityPreviewRepository {
  private readonly functions = inject(Functions);

  private readonly getDiscoveryPageCallable = httpsCallable<
    CommunityDiscoveryPageRequest,
    unknown
  >(this.functions, 'getCommunityDiscoveryPage');

  private readonly getPreviewCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'getCommunityPreview');

  getDiscoveryPage$(
    request: CommunityDiscoveryPageRequest = {}
  ): Observable<CommunityDiscoveryPage> {
    return defer(() =>
      from(
        this.getDiscoveryPageCallable({
          limit: request.limit ?? 12,
          cursor: request.cursor ?? null,
          sourceType: request.sourceType ?? null,
        })
      )
    ).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data))
    );
  }

  getPreview$(communityId: string): Observable<CommunityPreviewResponse> {
    return defer(() =>
      from(this.getPreviewCallable({ communityId: communityId.trim() }))
    ).pipe(
      map((result) => {
        const preview = normalizeCommunityPreviewResponse(result.data);

        if (!preview) {
          throw new Error('Resposta de comunidade inválida.');
        }

        return preview;
      })
    );
  }
}
