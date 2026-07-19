// src/app/community/data-access/community-create.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityCreateCommand,
  CommunityCreateResult,
  normalizeCommunityCreateResult,
} from './community-create.model';

@Injectable({ providedIn: 'root' })
export class CommunityCreateRepository {
  private readonly functions = inject(Functions);

  private readonly createCommunityCallable = httpsCallable<
    CommunityCreateCommand,
    unknown
  >(this.functions, 'createCommunity');

  createCommunity$(
    command: CommunityCreateCommand
  ): Observable<CommunityCreateResult> {
    return defer(() => from(this.createCommunityCallable(command))).pipe(
      map((result) => {
        const normalized = normalizeCommunityCreateResult(result.data);

        if (!normalized) {
          throw new Error('Resposta de criação da Comunidade inválida.');
        }

        return normalized;
      })
    );
  }
}
