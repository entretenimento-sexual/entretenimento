// src/app/dashboard/discovery/data-access/discovery-visible-profile-location.repository.ts
// -----------------------------------------------------------------------------
// Overlay reativo de localização para cards já carregados.
//
// Não enumera public_profiles. Cada UID visível usa leitura documental, que cai
// na Rule de get temporal. A própria projeção é revalidada localmente a cada
// emissão para não manter localização visível após validUntil.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { combineLatest, Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import {
  FirestoreReadService,
} from 'src/app/core/services/data-handling/firestore/core/firestore-read.service';

export interface DiscoveryVisibleProfileLocation {
  readonly uid: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly geohash: string | null;
}

@Injectable({ providedIn: 'root' })
export class DiscoveryVisibleProfileLocationRepository {
  private static readonly COLLECTION = 'public_profiles';

  constructor(private readonly read: FirestoreReadService) {}

  watchByUids$(
    uids: readonly string[] | null | undefined
  ): Observable<readonly DiscoveryVisibleProfileLocation[]> {
    const normalizedUids = this.normalizeUids(uids);

    if (!normalizedUids.length) {
      return of([]);
    }

    const documentStreams = normalizedUids.map((uid) =>
      this.read
        .getDocumentLiveSafe<Record<string, unknown>>(
          DiscoveryVisibleProfileLocationRepository.COLLECTION,
          uid,
          {
            idField: 'uid',
            requireAuth: true,
          }
        )
    );

    return combineLatest(documentStreams).pipe(
      map((documents) =>
        documents
          .map((document) => this.toLocation(document))
          .filter(
            (
              location
            ): location is DiscoveryVisibleProfileLocation =>
              location !== null
          )
      ),
      map((locations) =>
        this.orderByRequestedUids(locations, normalizedUids)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private toLocation(
    raw: Record<string, unknown> | null
  ): DiscoveryVisibleProfileLocation | null {
    if (!raw || !this.hasCurrentAgeEligibility(raw)) {
      return null;
    }

    const uid = this.cleanText(raw['uid']);
    if (!uid) return null;

    return {
      uid,
      latitude: this.firstNumber(raw, ['latitude', 'lat']),
      longitude: this.firstNumber(raw, ['longitude', 'lng', 'lon']),
      geohash: this.firstText(raw, ['geohash']),
    };
  }

  private hasCurrentAgeEligibility(
    source: Record<string, unknown>
  ): boolean {
    if (source['ageEligibilityVerifiedAdult'] !== true) {
      return false;
    }

    const value = source['ageEligibilityValidUntil'] as
      | number
      | Date
      | { toMillis?: unknown }
      | null
      | undefined;

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > Date.now();
    }

    if (value instanceof Date) {
      return value.getTime() > Date.now();
    }

    return !!value
      && typeof (value as { toMillis?: unknown }).toMillis === 'function'
      && (value as { toMillis: () => number }).toMillis() > Date.now();
  }

  private orderByRequestedUids(
    locations: readonly DiscoveryVisibleProfileLocation[],
    requestedUids: readonly string[]
  ): readonly DiscoveryVisibleProfileLocation[] {
    const byUid = new Map(
      locations.map((location) => [location.uid, location])
    );

    return requestedUids
      .map((uid) => byUid.get(uid) ?? null)
      .filter(
        (
          location
        ): location is DiscoveryVisibleProfileLocation =>
          location !== null
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
