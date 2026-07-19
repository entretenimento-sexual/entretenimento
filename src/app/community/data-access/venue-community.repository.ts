// src/app/community/data-access/venue-community.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  VenueCommunityCreateCommand,
  VenueCommunityCreateResult,
  normalizeVenueCommunityCreateResult,
} from './venue-community-create.model';

@Injectable({ providedIn: 'root' })
export class VenueCommunityRepository {
  private readonly functions = inject(Functions);

  private readonly createVenueCommunityCallable = httpsCallable<
    VenueCommunityCreateCommand,
    unknown
  >(this.functions, 'createVenueCommunity');

  createVenueCommunity$(
    command: VenueCommunityCreateCommand
  ): Observable<VenueCommunityCreateResult> {
    return defer(() => from(this.createVenueCommunityCallable(command))).pipe(
      map((result) => {
        const normalized = normalizeVenueCommunityCreateResult(result.data);

        if (!normalized) {
          throw new Error('Resposta de criação do local inválida.');
        }

        return normalized;
      })
    );
  }
}
