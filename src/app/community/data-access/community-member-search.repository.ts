// src/app/community/data-access/community-member-search.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';

import {
  CommunityMemberSearchPage,
  CommunityMemberSearchPageRequest,
  normalizeCommunityMemberSearchPage,
} from './community-member-search.model';

@Injectable({ providedIn: 'root' })
export class CommunityMemberSearchRepository {
  private readonly functions = inject(Functions);

  private readonly searchPageCallable = httpsCallable<
    {
      communityId: string;
      query: string;
      cursor: string | null;
      limit: number;
    },
    unknown
  >(this.functions, 'searchCommunityMembersPage');

  searchPage$(
    request: CommunityMemberSearchPageRequest
  ): Observable<CommunityMemberSearchPage> {
    return defer(() =>
      from(
        this.searchPageCallable({
          communityId: String(request.communityId ?? '').trim(),
          query: String(request.query ?? '').trim(),
          cursor: request.cursor?.trim() || null,
          limit: request.limit ?? 20,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityMemberSearchPage(result.data);
        if (!normalized) {
          throw new Error('Resultado da busca de integrantes inválido.');
        }
        return normalized;
      })
    );
  }
}
