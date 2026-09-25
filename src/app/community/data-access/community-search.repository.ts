import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';

import {
  type CommunitySearchPage,
  type CommunitySearchPageRequest,
  normalizeCommunitySearchPage,
} from './community-search.model';

@Injectable({ providedIn: 'root' })
export class CommunitySearchRepository {
  private readonly functions = inject(Functions);

  private readonly searchPageCallable = httpsCallable<
    {
      communityId: string;
      query: string;
      scope: 'members' | 'topics';
      cursor: string | null;
      limit: number;
    },
    unknown
  >(this.functions, 'getCommunitySearchPage');

  searchPage$(
    request: CommunitySearchPageRequest
  ): Observable<CommunitySearchPage> {
    return defer(() =>
      from(
        this.searchPageCallable({
          communityId: request.communityId.trim(),
          query: request.query.trim(),
          scope: request.scope,
          cursor: request.cursor?.trim() || null,
          limit: request.limit ?? 12,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunitySearchPage(result.data);
        if (!normalized || normalized.scope !== request.scope) {
          throw new Error('Resposta de busca interna inválida.');
        }
        return normalized;
      })
    );
  }
}
