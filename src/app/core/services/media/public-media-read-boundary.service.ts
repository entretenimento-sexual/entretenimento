// src/app/core/services/media/public-media-read-boundary.service.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA DISCOVERY READ BOUNDARY
// -----------------------------------------------------------------------------
// Cliente canônico das listagens globais/multi-owner de mídia pública.
// Galerias de um proprietário conhecido continuam sob Rules owner-scoped.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from } from 'rxjs';
import { map } from 'rxjs/operators';

export type PublicMediaReadType = 'PHOTO' | 'VIDEO';
export type PublicMediaReadMode =
  | 'RECENT_BY_OWNERS'
  | 'LATEST'
  | 'TOP'
  | 'BOOSTED';

export interface PublicMediaReadRequest {
  readonly mediaType: PublicMediaReadType;
  readonly mode: PublicMediaReadMode;
  readonly ownerUids?: readonly string[] | null;
  readonly limit?: number;
}

export interface PublicMediaReadResponse {
  readonly items: readonly Record<string, unknown>[];
  readonly fetchedAt: number;
  readonly scanned: number;
}

@Injectable({ providedIn: 'root' })
export class PublicMediaReadBoundaryService {
  private readonly functions = inject(Functions);

  private readonly callable = httpsCallable<
    PublicMediaReadRequest,
    PublicMediaReadResponse
  >(this.functions, 'getPublicMediaDiscovery');

  read$(
    request: PublicMediaReadRequest
  ): Observable<PublicMediaReadResponse> {
    return defer(() => from(this.callable(request))).pipe(
      map((response) => response.data)
    );
  }
}
