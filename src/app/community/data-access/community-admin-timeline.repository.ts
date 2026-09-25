// src/app/community/data-access/community-admin-timeline.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityAdminTimelinePage,
  normalizeCommunityAdminTimelinePage,
} from './community-admin-timeline.model';

@Injectable({ providedIn: 'root' })
export class CommunityAdminTimelineRepository {
  private readonly functions = inject(Functions);

  private readonly getTimelineCallable = httpsCallable<
    {
      communityId: string;
      cursor: string | null;
      limit: number;
    },
    unknown
  >(this.functions, 'getCommunityAdminTimeline');

  getPage$(
    communityId: string,
    cursor: string | null = null,
    limit = 20
  ): Observable<CommunityAdminTimelinePage> {
    return defer(() =>
      from(
        this.getTimelineCallable({
          communityId: communityId.trim(),
          cursor: cursor?.trim() || null,
          limit,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityAdminTimelinePage(result.data);

        if (!normalized) {
          throw new Error('Histórico administrativo inválido.');
        }

        return normalized;
      })
    );
  }
}
