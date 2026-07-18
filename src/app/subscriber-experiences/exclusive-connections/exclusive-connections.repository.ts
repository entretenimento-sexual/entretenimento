// src/app/subscriber-experiences/exclusive-connections/exclusive-connections.repository.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS REPOSITORY
// -----------------------------------------------------------------------------
// Adapter AngularFire para a callable protegida pelo entitlement no backend.
//
// O uso de defer garante que nenhuma requisição seja iniciada apenas pela
// injeção do serviço. A chamada só ocorre quando a tela autorizada assina o
// Observable.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  ExclusiveConnectionsPage,
  ExclusiveConnectionsPageRequest,
  normalizeExclusiveConnectionsPageResponse,
} from './exclusive-connections.model';

@Injectable({ providedIn: 'root' })
export class ExclusiveConnectionsRepository {
  private readonly functions = inject(Functions);

  private readonly getMyExclusiveConnectionsPageCallable = httpsCallable<
    ExclusiveConnectionsPageRequest,
    unknown
  >(this.functions, 'getMyExclusiveConnectionsPage');

  getPage$(
    request: ExclusiveConnectionsPageRequest = {}
  ): Observable<ExclusiveConnectionsPage> {
    const payload: ExclusiveConnectionsPageRequest = {
      limit: request.limit ?? 12,
      cursor: request.cursor ?? null,
    };

    return defer(() =>
      from(this.getMyExclusiveConnectionsPageCallable(payload))
    ).pipe(
      map((result) => normalizeExclusiveConnectionsPageResponse(result.data))
    );
  }
}
