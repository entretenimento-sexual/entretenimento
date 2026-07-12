// src/app/dashboard/discovery/data-access/discovery-public-profiles.repository.ts
// -----------------------------------------------------------------------------
// Repositório paginado da Discovery V2.
//
// Responsabilidades:
// - consultar public_profiles em páginas limitadas;
// - usar cursor serializável updatedAtMs + uid;
// - aplicar chave de cache determinística por usuário/modo/página;
// - emitir cache primeiro e revalidar no servidor;
// - mapear somente a projeção pública segura.
//
// Não calcula compatibilidade, score, distância ou presença.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from '@angular/fire/firestore';
import type { QueryConstraint } from 'firebase/firestore';

import { EMPTY, Observable, concat, of, throwError } from 'rxjs';
import { switchMap, take, tap } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';

import {
  CachedDiscoveryFeedPage,
  DiscoveryFeedCursor,
  DiscoveryFeedPage,
  DiscoveryFeedRequest,
  buildDiscoveryFeedPageCacheKey,
  normalizeDiscoveryCursor,
  normalizeDiscoveryRequest,
} from '../models/discovery-feed-page.model';
import { PublicProfileCard } from '../models/public-profile-card.model';
import {
  mapPublicProfileCard,
  toSerializableEpoch,
} from './public-profile-card.mapper';

const PUBLIC_PROFILES_COLLECTION = 'public_profiles';
const DISCOVERY_PAGE_CACHE_TTL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class DiscoveryPublicProfilesRepository {
  private readonly firestore = inject(Firestore);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly cache = inject(CacheService);

  loadPage$(
    request: DiscoveryFeedRequest,
    cursor: DiscoveryFeedCursor | null = null
  ): Observable<DiscoveryFeedPage> {
    const normalizedRequest = normalizeDiscoveryRequest(request);
    const normalizedCursor = normalizeDiscoveryCursor(cursor);

    if (!normalizedRequest) {
      return throwError(
        () => new Error('[DiscoveryPublicProfilesRepository] consulta inválida')
      );
    }

    const cacheKey = buildDiscoveryFeedPageCacheKey(
      normalizedRequest,
      normalizedCursor
    );

    const server$ = this.fetchServerPage$(
      normalizedRequest,
      normalizedCursor
    ).pipe(
      tap((page) => {
        const cachedPage: CachedDiscoveryFeedPage = {
          items: page.items,
          nextCursor: page.nextCursor,
          reachedEnd: page.reachedEnd,
          fetchedAt: page.fetchedAt,
        };

        this.cache.set(
          cacheKey,
          cachedPage,
          DISCOVERY_PAGE_CACHE_TTL_MS,
          { persist: true }
        );
      })
    );

    return this.cache.get<CachedDiscoveryFeedPage>(cacheKey).pipe(
      take(1),
      switchMap((cached) =>
        concat(
          cached
            ? of<DiscoveryFeedPage>({
                ...cached,
                source: 'cache',
              })
            : EMPTY,
          server$
        )
      )
    );
  }

  private fetchServerPage$(
    request: DiscoveryFeedRequest,
    cursor: DiscoveryFeedCursor | null
  ): Observable<DiscoveryFeedPage> {
    return this.firestoreContext.deferPromise$(async () => {
      const collectionRef = collection(
        this.firestore,
        PUBLIC_PROFILES_COLLECTION
      );

      const constraints = this.buildConstraints(request, cursor);
      const snapshot = await getDocsFromServer(
        query(collectionRef, ...constraints)
      );

      const items = snapshot.docs
        .map((documentSnapshot) =>
          mapPublicProfileCard(
            {
              ...documentSnapshot.data(),
              uid: documentSnapshot.id,
            },
            documentSnapshot.id
          )
        )
        .filter((item): item is PublicProfileCard => item !== null);

      const lastDocument = snapshot.docs.at(-1) ?? null;
      const nextCursor = this.toCursor(lastDocument?.id, lastDocument?.data());
      const reachedEnd =
        snapshot.docs.length < request.pageSize || nextCursor === null;

      return {
        items,
        nextCursor,
        reachedEnd,
        source: 'server' as const,
        fetchedAt: Date.now(),
      };
    });
  }

  private buildConstraints(
    request: DiscoveryFeedRequest,
    cursor: DiscoveryFeedCursor | null
  ): QueryConstraint[] {
    const constraints: QueryConstraint[] = [];

    if (request.mode === 'compatible') {
      constraints.push(where('compatibilityReady', '==', true));
    }

    constraints.push(
      orderBy('updatedAt', 'desc'),
      orderBy(documentId(), 'asc')
    );

    if (cursor) {
      constraints.push(
        startAfter(Timestamp.fromMillis(cursor.updatedAtMs), cursor.uid)
      );
    }

    constraints.push(limit(request.pageSize));

    return constraints;
  }

  private toCursor(
    uidValue: unknown,
    raw: unknown
  ): DiscoveryFeedCursor | null {
    const uid = String(uidValue ?? '').trim();
    const source =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    const updatedAtMs = toSerializableEpoch(source['updatedAt']);

    if (!uid || updatedAtMs === null) {
      return null;
    }

    return {
      uid,
      updatedAtMs,
    };
  }
}
