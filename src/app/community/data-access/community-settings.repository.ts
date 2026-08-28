import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, tap } from 'rxjs';

import { CommunityDomainEventsService } from './community-domain-events.service';
import {
  CommunitySettingsUpdateCommand,
  CommunitySettingsUpdateResult,
  normalizeCommunitySettingsUpdateResult,
} from './community-settings.model';

@Injectable({ providedIn: 'root' })
export class CommunitySettingsRepository {
  private readonly functions = inject(Functions);
  private readonly domainEvents = inject(CommunityDomainEventsService);

  private readonly updateCommunitySettingsCallable = httpsCallable<
    CommunitySettingsUpdateCommand,
    unknown
  >(this.functions, 'updateCommunitySettings');

  updateSettings$(
    command: CommunitySettingsUpdateCommand
  ): Observable<CommunitySettingsUpdateResult> {
    const communityId = command.communityId.trim();
    return defer(() => from(this.updateCommunitySettingsCallable(command))).pipe(
      map((result) => {
        const normalized = normalizeCommunitySettingsUpdateResult(result.data);

        if (!normalized) {
          throw new Error('Resposta de edição da Comunidade inválida.');
        }

        return normalized;
      }),
      tap(() =>
        this.domainEvents.notifyDiscoveryChanged('settings_changed', communityId)
      )
    );
  }
}
