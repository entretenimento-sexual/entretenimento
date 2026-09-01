import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, tap } from 'rxjs';

import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import {
  CommunitySettingsUpdateCommand,
  CommunitySettingsUpdateResult,
  normalizeCommunitySettingsUpdateResult,
} from './community-settings.model';

@Injectable({ providedIn: 'root' })
export class CommunitySettingsRepository {
  private readonly functions = inject(Functions);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);

  private readonly updateCommunitySettingsCallable = httpsCallable<
    CommunitySettingsUpdateCommand,
    unknown
  >(this.functions, 'updateCommunitySettings');

  updateSettings$(
    command: CommunitySettingsUpdateCommand
  ): Observable<CommunitySettingsUpdateResult> {
    return defer(() => from(this.updateCommunitySettingsCallable(command))).pipe(
      map((result) => {
        const normalized = normalizeCommunitySettingsUpdateResult(result.data);

        if (!normalized) {
          throw new Error('Resposta de edição da Comunidade inválida.');
        }

        return normalized;
      }),
      tap((result) => {
        if (!result.updated) return;

        if (result.changedFields.includes('tagIds')) {
          this.discoveryCache.invalidateCurrentViewer({
            sourceType: 'community',
          });
          return;
        }

        this.discoveryCache.invalidateCurrentViewer({
          sourceType: 'community',
          communityId: result.communityId,
        });
      })
    );
  }
}
