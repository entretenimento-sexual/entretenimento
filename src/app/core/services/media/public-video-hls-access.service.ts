import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export interface IPublicVideoHlsPlaylist {
  readonly placeholder: string;
  readonly manifest: string;
}

export interface IPublicVideoHlsAccess {
  readonly ownerUid: string;
  readonly videoId: string;
  readonly masterManifest: string;
  readonly playlists: readonly IPublicVideoHlsPlaylist[];
  readonly expiresAt: number;
}

interface PublicVideoHlsAccessRequest {
  ownerUid: string;
  videoId: string;
}

const ACCESS_EXPIRY_SAFETY_MS = 60_000;
const MAX_MASTER_MANIFEST_CHARACTERS = 256 * 1024;
const MAX_PLAYLIST_MANIFEST_CHARACTERS = 512 * 1024;
const MAX_PLAYLISTS = 8;
const PLACEHOLDER_PATTERN = /^__ENTRETENIMENTO_HLS_PLAYLIST_\d+__$/;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeManifest(value: unknown, maxLength: number): string {
  const manifest = String(value ?? '').replace(/^\uFEFF/, '');

  return manifest.startsWith('#EXTM3U') && manifest.length <= maxLength
    ? manifest
    : '';
}

function normalizeAccess(
  value: unknown,
  ownerUid: string,
  videoId: string
): IPublicVideoHlsAccess | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const responseOwnerUid = cleanId(data['ownerUid']);
  const responseVideoId = cleanId(data['videoId']);
  const masterManifest = normalizeManifest(
    data['masterManifest'],
    MAX_MASTER_MANIFEST_CHARACTERS
  );
  const expiresAt = Number(data['expiresAt'] ?? 0);
  const rawPlaylists = Array.isArray(data['playlists'])
    ? data['playlists']
    : [];

  if (
    responseOwnerUid !== ownerUid ||
    responseVideoId !== videoId ||
    !masterManifest ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() + ACCESS_EXPIRY_SAFETY_MS ||
    !rawPlaylists.length ||
    rawPlaylists.length > MAX_PLAYLISTS
  ) {
    return null;
  }

  const placeholders = new Set<string>();
  const playlists = rawPlaylists.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      return [];
    }

    const item = candidate as Record<string, unknown>;
    const placeholder = String(item['placeholder'] ?? '').trim();
    const manifest = normalizeManifest(
      item['manifest'],
      MAX_PLAYLIST_MANIFEST_CHARACTERS
    );

    if (
      !PLACEHOLDER_PATTERN.test(placeholder) ||
      placeholders.has(placeholder) ||
      !manifest ||
      !masterManifest.includes(placeholder)
    ) {
      return [];
    }

    placeholders.add(placeholder);
    return [{ placeholder, manifest }];
  });

  if (playlists.length !== rawPlaylists.length) {
    return null;
  }

  return {
    ownerUid,
    videoId,
    masterManifest,
    playlists,
    expiresAt: Math.trunc(expiresAt),
  };
}

@Injectable({ providedIn: 'root' })
export class PublicVideoHlsAccessService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly cache = new Map<string, IPublicVideoHlsAccess>();
  private readonly inFlight = new Map<
    string,
    Observable<IPublicVideoHlsAccess | null>
  >();
  private lastSessionUid: string | null | undefined = undefined;

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {
    this.authSession.uid$
      .pipe(
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((uid) => {
        const normalizedUid = uid?.trim() || null;

        if (
          this.lastSessionUid !== undefined &&
          this.lastSessionUid !== normalizedUid
        ) {
          this.cache.clear();
          this.inFlight.clear();
        }

        this.lastSessionUid = normalizedUid;
      });
  }

  getAccess$(
    ownerUidValue: string,
    videoIdValue: string,
    forceRefresh = false
  ): Observable<IPublicVideoHlsAccess | null> {
    const ownerUid = cleanId(ownerUidValue);
    const videoId = cleanId(videoIdValue);

    if (!ownerUid || !videoId) {
      return of(null);
    }

    const key = `${ownerUid}:${videoId}`;
    const cached = this.cache.get(key);

    if (
      !forceRefresh &&
      cached &&
      cached.expiresAt > Date.now() + ACCESS_EXPIRY_SAFETY_MS
    ) {
      return of(cached);
    }

    if (cached) {
      this.cache.delete(key);
    }

    const pending = this.inFlight.get(key);

    if (pending && !forceRefresh) {
      return pending;
    }

    const request$ = this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        PublicVideoHlsAccessRequest,
        unknown
      >(this.functions, 'getPublicVideoHlsAccess');
      const response = await callable({ ownerUid, videoId });
      return response.data;
    }).pipe(
      map((response) => normalizeAccess(response, ownerUid, videoId)),
      map((access) => {
        if (access) {
          this.cache.set(key, access);
        }

        return access;
      }),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'getAccess$',
          ownerUid,
          videoId,
        });

        return of(null);
      }),
      finalize(() => {
        if (this.inFlight.get(key) === request$) {
          this.inFlight.delete(key);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlight.set(key, request$);
    return request$;
  }

  invalidate(ownerUidValue: string, videoIdValue: string): void {
    const ownerUid = cleanId(ownerUidValue);
    const videoId = cleanId(videoIdValue);

    if (ownerUid && videoId) {
      this.cache.delete(`${ownerUid}:${videoId}`);
    }
  }

  requireAccess$(
    ownerUid: string,
    videoId: string,
    forceRefresh = false
  ): Observable<IPublicVideoHlsAccess> {
    return this.getAccess$(ownerUid, videoId, forceRefresh).pipe(
      map((access) => {
        if (!access) {
          throw new Error('Sessão HLS indisponível.');
        }

        return access;
      }),
      catchError((error) => throwError(() => error))
    );
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Erro ao autorizar streaming adaptativo.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'PublicVideoHlsAccessService',
        ...context,
      };
      (normalizedError as any).skipUserNotification = true;
      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
