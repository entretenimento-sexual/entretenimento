import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import { ref } from 'firebase/storage';
import {
  Observable, catchError, concat, defer, finalize, map, of, shareReplay, switchMap,
} from 'rxjs';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';

interface ProfileAvatarReference {
  readonly bucket: string;
  readonly path: string;
}

/**
 * A URL guardada no perfil só identifica o objeto. Tokens encontrados em
 * referências antigas nunca são usados para carregar o avatar.
 */
export function parseProfileAvatarReference(value: string): ProfileAvatarReference | null {
  try {
    const url = new URL(value);
    const firebaseHost = url.protocol === 'https:' &&
      url.hostname === 'firebasestorage.googleapis.com';
    const localEmulator = url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!firebaseHost && !localEmulator) return null;

    const match = /^\/v0\/b\/([A-Za-z0-9._-]+)\/o\/([^/]+)$/.exec(url.pathname);
    if (!match) return null;
    const path = decodeURIComponent(match[2]);
    if (!/^users\/[^/\x00-\x1f\x7f]+\/published\/avatar\/[A-Za-z0-9_.-]+$/.test(path)) return null;

    return { bucket: match[1], path };
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class ProfileAvatarReadService {
  private readonly storage = inject(Storage);
  private readonly functions = inject(Functions);
  private readonly firebaseContext = inject(FirestoreContextService);
  private readonly session = inject(AuthSessionService);
  private readonly mediaError = inject(MediaApplicationErrorService);
  private readonly pending = new Map<string, Observable<Blob | null>>();

  read$(reference: ProfileAvatarReference): Observable<Blob | null> {
    if (reference.bucket !== ref(this.storage).bucket) return of(null);
    return this.session.uid$.pipe(
      switchMap((uid) => uid
        ? concat(of(null), this.load$(uid, reference.path))
        : of(null)
      )
    );
  }

  private load$(uid: string, path: string): Observable<Blob | null> {
    const key = JSON.stringify([uid, path]);
    const pending = this.pending.get(key);
    if (pending) return pending;

    const request$ = defer(() => this.firebaseContext.deferPromise$(() =>
      httpsCallable<{ storagePath: string }, { image: string }>(
        this.functions,
        'getProfileAvatar'
      )({ storagePath: path })
    )).pipe(
      map(({ data }) => {
        const bytes = Uint8Array.from(atob(data.image), (char) => char.charCodeAt(0));
        return new Blob([bytes], { type: 'image/webp' });
      }),
      catchError((error: unknown) => {
        const code = (error as { code?: unknown } | null)?.code;
        if (code !== 'functions/not-found' && code !== 'functions/permission-denied' &&
            code !== 'functions/failed-precondition' && code !== 'functions/unauthenticated') {
          this.mediaError.reportSilently(
            error,
            'readAvatar',
            'Não foi possível exibir a foto de perfil.'
          );
        }
        return of(null);
      }),
      finalize(() => this.pending.delete(key)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.pending.set(key, request$);
    return request$;
  }
}
