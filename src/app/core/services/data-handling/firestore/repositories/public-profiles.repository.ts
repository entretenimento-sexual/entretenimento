// src/app/core/services/data-handling/firestore/repositories/public-profiles.repository.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';

import { serverTimestamp as afServerTimestamp } from '@angular/fire/firestore';

import { FirestoreReadService } from '../core/firestore-read.service';
import { FirestoreWriteService } from '../core/firestore-write.service';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

/**
 * =============================================================================
 * PUBLIC PROFILES REPOSITORY (Write)
 * - Coleção "public_profiles" é o perfil público consultável (discovery).
 * - NÃO confundir com "public_index" (índice técnico: nickname:xxx, etc.).
 * - Mantém writes simples e observáveis.
 * - UID vem do AuthSession (fonte da verdade).
 * - Erros passam pelo handler central (observabilidade).
 *
 * Modelo recomendado:
 * - public_profiles/{uid}  -> campos públicos (filtro/search)
 * - public_index/nickname:xxx -> unicidade/lookup técnico (create-only)
 * =============================================================================
 */

export type PublicProfilePatch = Partial<{
  nickname: string | null;
  avatarUrl: string | null; // ou photoURL (você escolhe um padrão e mantém compat no mapper)
  municipio: string | null;
  estado: string | null;
  gender: string | null;
  orientation: string | null;

  // se for público no seu app:
  latitude: number | null;
  longitude: number | null;
  geohash: string | null;

  role: string | null; // se realmente for público (senão, remova)
}>;

@Injectable({ providedIn: 'root' })
export class PublicProfilesRepository {
  private static readonly COL = 'public_profiles';

  constructor(
    private readonly read: FirestoreReadService,
    private readonly write: FirestoreWriteService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly authSession: AuthSessionService
  ) { }

  /**
   * Upsert do meu perfil público:
   * - tenta update (barato, preserva campos)
   * - se NOT_FOUND => cria (set)
   *
   * Obs:
   * - esse repo não valida nickname único (isso é do PublicIndexRepository).
   * - esse repo só replica o que é "público" e consultável.
   */
  upsertMyPublicProfile$(patch: PublicProfilePatch): Observable<void> {
    const safePatch = patch ?? {};

    return this.authSession.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) {
          return throwError(() =>
            Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
          );
        }

        const data = {
          uid,
          ...safePatch,
          updatedAt: afServerTimestamp(),
        };

        return this.write.updateDocument(PublicProfilesRepository.COL, uid, data).pipe(
          catchError((err) => {
            if (!this.isNotFound(err)) {
              return this.firestoreError.handleFirestoreError(err);
            }

            // seed (criação)
            const seed = {
              uid,
              nickname: safePatch.nickname ?? null,
              avatarUrl: safePatch.avatarUrl ?? null,
              municipio: safePatch.municipio ?? null,
              estado: safePatch.estado ?? null,
              gender: safePatch.gender ?? null,
              orientation: safePatch.orientation ?? null,
              latitude: safePatch.latitude ?? null,
              longitude: safePatch.longitude ?? null,
              geohash: safePatch.geohash ?? null,
              role: safePatch.role ?? 'basic',
              createdAt: afServerTimestamp(),
              updatedAt: afServerTimestamp(),
            };

            return this.write.setDocument(PublicProfilesRepository.COL, uid, seed);
          })
        );
      })
    );
  }

  /**
   * Leitura pontual do perfil público (útil pra debug/painel).
   */
  getPublicProfileOnce$(uid: string): Observable<any | null> {
    const clean = (uid ?? '').trim();
    if (!clean) return of(null);

    return this.read.getDocument<any>(PublicProfilesRepository.COL, clean, { source: 'server' }).pipe(
      catchError((err) => this.firestoreError.handleFirestoreError(err))
    );
  }

  private isNotFound(err: any): boolean {
    const code = err?.code ?? err?.message ?? '';
    return String(code).includes('not-found') || String(code).includes('NOT_FOUND');
  }
} //130 linhas

