// src/app/core/services/discovery/public-profile-read-boundary.service.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE READ BOUNDARY
// -----------------------------------------------------------------------------
// Cliente canônico para listagens/hidratações públicas de perfis.
// Nenhuma coleção public_profiles deve ser enumerada diretamente pelo cliente.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { SessionReadInFlight } from '@core/services/autentication/auth/session-read-in-flight';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { map, tap } from 'rxjs/operators';

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

export interface PublicProfileNearbyBound {
  readonly start: string;
  readonly end: string;
}

export interface PublicProfileNearbyRequest {
  readonly latitude: number;
  readonly longitude: number;
  readonly maxDistanceKm: number;
  readonly bounds: readonly PublicProfileNearbyBound[];
}

export interface PublicProfileReadRequest {
  readonly mode?: PublicProfileReadMode;
  readonly pageSize?: number;
  readonly cursor?: PublicProfileReadCursor | null;
  readonly uids?: readonly string[];
  readonly filters?: PublicProfileReadFilters | null;
  readonly nearby?: PublicProfileNearbyRequest | null;
  readonly suggestByIntimateInterests?: boolean;
}

export interface PublicProfileReadResponse {
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: PublicProfileReadCursor | null;
  readonly reachedEnd: boolean;
  readonly fetchedAt: number;
  readonly scanned: number;
  readonly suggestedOrder?: readonly string[];
}

@Injectable({ providedIn: 'root' })
export class PublicProfileReadBoundaryService {
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);

  // Compartilha apenas solicitações simultâneas. Respostas concluídas NÃO são
  // armazenadas: a autorização e o ciclo de vida seguem no backend.
  private readonly inFlight = new SessionReadInFlight<PublicProfileReadResponse>(this.session);
  private readonly quotaCooldownByViewer = new Map<
    string, { until: number; error: unknown }
  >();

  private readonly getPublicProfilesPageCallable = httpsCallable<
    PublicProfileReadRequest,
    PublicProfileReadResponse
  >(this.functions, 'getPublicProfilesPage');

  read$(
    request: PublicProfileReadRequest,
    preferencesRevision?: number
  ): Observable<PublicProfileReadResponse> {
    return defer(() => {
      const viewerUid = this.session.currentAuthUser?.uid?.trim() ?? '';
      const now = Date.now();

      // O backend fornece retryAfterMs ao bloquear. Evita novos POSTs durante
      // a janela, sem inventar autorização nem devolver perfis antigos.
      for (const [uid, state] of this.quotaCooldownByViewer) {
        if (state.until <= now) this.quotaCooldownByViewer.delete(uid);
      }
      const cooldown = viewerUid
        ? this.quotaCooldownByViewer.get(viewerUid)
        : undefined;
      if (cooldown && cooldown.until > now) {
        return throwError(() => cooldown.error);
      }

      return this.inFlight.read$(
        JSON.stringify([request, preferencesRevision]),
        () => defer(() => from(this.getPublicProfilesPageCallable(request))).pipe(
          map((response) => response.data),
          tap({
            error: (error: unknown) => {
              if (!viewerUid || !this.isRateLimited(error)) return;
              this.quotaCooldownByViewer.set(viewerUid, {
                until: Date.now() + this.retryAfterMs(error),
                error,
              });
            },
          })
        )
      );
    });
  }

  private isRateLimited(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'functions/resource-exhausted'
      || code === 'resource-exhausted';
  }

  private retryAfterMs(error: unknown): number {
    const details = (error as { details?: { retryAfterMs?: unknown } } | null)
      ?.details;
    const value = details?.retryAfterMs;
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1_000, Math.min(10 * 60_000, Math.ceil(value)))
      : 60_000;
  }

  readByUids$(
    uids: readonly string[]
  ): Observable<PublicProfileReadResponse> {
    return this.read$({ uids });
  }
}
