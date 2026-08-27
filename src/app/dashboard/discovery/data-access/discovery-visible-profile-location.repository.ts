// src/app/dashboard/discovery/data-access/discovery-visible-profile-location.repository.ts
// -----------------------------------------------------------------------------
// Listener leve para a projeção pública de localização dos cards visíveis.
//
// Regras:
// - não substitui a paginação one-shot do discovery;
// - observa somente UIDs já carregados/visíveis;
// - agrupa UIDs em lotes pequenos para evitar um listener por card;
// - expõe somente latitude/longitude/geohash públicos;
// - não altera ordem, ranking ou cursor do feed.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { combineLatest, Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { documentId, where } from 'firebase/firestore';

import { FirestoreReadService } from 'src/app/core/services/data-handling/firestore/core/firestore-read.service';

export interface DiscoveryVisibleProfileLocation {
  readonly uid: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly geohash: string | null;
}

@Injectable({ providedIn: 'root' })
export class DiscoveryVisibleProfileLocationRepository {
  private static readonly COLLECTION = 'public_profiles';
  private static readonly UID_BATCH_SIZE = 10;

  constructor(private readonly read: FirestoreReadService) {}

  watchByUids$(
    uids: readonly string[] | null | undefined
  ): Observable<readonly DiscoveryVisibleProfileLocation[]> {
    const normalizedUids = this.normalizeUids(uids);

    if (!normalizedUids.length) {
      return of([]);
    }

    const batches = this.chunk(
      normalizedUids,
      DiscoveryVisibleProfileLocationRepository.UID_BATCH_SIZE
    );

    const batchStreams = batches.map((batch) =>
      this.read
        .getDocumentsLiveSafe<Record<string, unknown>>(
          DiscoveryVisibleProfileLocationRepository.COLLECTION,
          [where(documentId(), 'in', batch)],
          {
            mapIdField: 'uid',
            requireAuth: true,
          }
        )
        .pipe(
          map((documents) =>
            (documents ?? [])
              .map((document) => this.toLocation(document))
              .filter(
                (
                  location
                ): location is DiscoveryVisibleProfileLocation =>
                  location !== null
              )
          )
        )
    );

    return combineLatest(batchStreams).pipe(
      map((parts) => parts.flat()),
      map((locations) => this.orderByRequestedUids(locations, normalizedUids)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private toLocation(
    raw: Record<string, unknown>
  ): DiscoveryVisibleProfileLocation | null {
    const uid = this.cleanText(raw['uid']);
    if (!uid) return null;

    return {
      uid,
      latitude: this.firstNumber(raw, ['latitude', 'lat']),
      longitude: this.firstNumber(raw, ['longitude', 'lng', 'lon']),
      geohash: this.firstText(raw, ['geohash']),
    };
  }

  private orderByRequestedUids(
    locations: readonly DiscoveryVisibleProfileLocation[],
    requestedUids: readonly string[]
  ): readonly DiscoveryVisibleProfileLocation[] {
    const byUid = new Map(locations.map((location) => [location.uid, location]));

    return requestedUids
      .map((uid) => byUid.get(uid) ?? null)
      .filter(
        (
          location
        ): location is DiscoveryVisibleProfileLocation => location !== null
      );
  }

  private normalizeUids(
    uids: readonly string[] | null | undefined
  ): string[] {
    return Array.from(
      new Set(
        (uids ?? [])
          .map((uid) => this.cleanText(uid))
          .filter((uid): uid is string => uid !== null)
      )
    ).sort();
  }

  private chunk<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private firstText(
    source: Record<string, unknown>,
    keys: readonly string[]
  ): string | null {
    for (const key of keys) {
      const value = this.cleanText(source[key]);
      if (value) return value;
    }

    return null;
  }

  private firstNumber(
    source: Record<string, unknown>,
    keys: readonly string[]
  ): number | null {
    for (const key of keys) {
      const value = source[key];
      const numberValue =
        typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? Number(value)
            : Number.NaN;

      if (Number.isFinite(numberValue)) {
        return numberValue;
      }
    }

    return null;
  }

  private cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text || null;
  }
}
