// src/app/core/services/discovery/public-profile-read-boundary.service.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE READ BOUNDARY
// -----------------------------------------------------------------------------
// Cliente canônico para listagens/hidratações públicas de perfis.
// Nenhuma coleção public_profiles deve ser enumerada diretamente pelo cliente.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from } from 'rxjs';
import { map } from 'rxjs/operators';

export type PublicProfileReadMode = 'all' | 'compatible';

export interface PublicProfileReadCursor {
  readonly updatedAtMs: number;
  readonly uid: string;
}

export interface PublicProfileReadFilters {
  readonly gender?: string | null;
  readonly orientation?: string | null;
  readonly municipio?: string | null;
  readonly estado?: string | null;
  readonly nicknamePrefix?: string | null;
}

export interface PublicProfileReadRequest {
  readonly mode?: PublicProfileReadMode;
  readonly pageSize?: number;
  readonly cursor?: PublicProfileReadCursor | null;
  readonly uids?: readonly string[];
  readonly filters?: PublicProfileReadFilters | null;
}

export interface PublicProfileReadResponse {
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: PublicProfileReadCursor | null;
  readonly reachedEnd: boolean;
  readonly fetchedAt: number;
  readonly scanned: number;
}

@Injectable({ providedIn: 'root' })
export class PublicProfileReadBoundaryService {
  private readonly functions = inject(Functions);

  private readonly getPublicProfilesPageCallable = httpsCallable<
    PublicProfileReadRequest,
    PublicProfileReadResponse
  >(this.functions, 'getPublicProfilesPage');

  read$(
    request: PublicProfileReadRequest
  ): Observable<PublicProfileReadResponse> {
    return defer(() =>
      from(this.getPublicProfilesPageCallable(request))
    ).pipe(
      map((response) => response.data)
    );
  }

  readByUids$(
    uids: readonly string[]
  ): Observable<PublicProfileReadResponse> {
    return this.read$({ uids });
  }
}
