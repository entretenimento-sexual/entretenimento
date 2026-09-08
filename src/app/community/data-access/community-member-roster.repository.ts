// src/app/community/data-access/community-member-roster.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';

import {
  CommunityMemberRosterPage,
  CommunityMemberRosterPageRequest,
  normalizeCommunityMemberRosterPage,
} from './community-member-roster.model';

@Injectable({ providedIn: 'root' })
export class CommunityMemberRosterRepository {
  private readonly functions = inject(Functions);

  private readonly getPageCallable = httpsCallable<
    {
      communityId: string;
      cursor: string | null;
      limit: number;
    },
    unknown
  >(this.functions, 'getCommunityMemberRosterPage');

  getPage$(
    request: CommunityMemberRosterPageRequest
  ): Observable<CommunityMemberRosterPage> {
    return defer(() =>
      from(
        this.getPageCallable({
          communityId: String(request.communityId ?? '').trim(),
          cursor: request.cursor?.trim() || null,
          limit: request.limit ?? 20,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityMemberRosterPage(result.data);
        if (!normalized) {
          throw new Error('Lista de integrantes inválida.');
        }
        return normalized;
      })
    );
  }
}
