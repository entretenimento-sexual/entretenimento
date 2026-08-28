// src/app/core/services/places/hot-places.service.ts
// -----------------------------------------------------------------------------
// HOT PLACES SERVICE
// -----------------------------------------------------------------------------
// Serviço read-only para a futura vitrine "Locais bombando".
//
// Direção arquitetural:
// - a UI lê uma projeção agregada e moderada em `regional_hot_places`;
// - o cálculo de score deve ficar fora do componente visual;
// - os documentos não devem conter UIDs, participantes ou coordenadas precisas;
// - a exibição é regional e respeita visibilidade/moderação;
// - sinais de afinidade aparecem somente como códigos agregados;
// - a camada é reativa e cacheável por shareReplay no consumidor.

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  QueryConstraint,
  collection,
  collectionData,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  HotPlaceAffinitySegment,
  HotPlaceAudience,
  HotPlaceCompatibilitySignal,
  HotPlaceKind,
  HotPlaceVisibility,
  IHotPlace,
  IHotPlaceAffinityMix,
  IHotPlaceCardVm,
  IHotPlaceQueryOptions,
  IHotPlaceRegion,
} from 'src/app/core/interfaces/places/hot-place.interface';
import {
  RegionFilterService,
  UserRegion,
} from 'src/app/core/services/filtering/filters/region-filter.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

const DEFAULT_LIMIT = 12;
const DEFAULT_MINIMUM_SCORE = 1;
const MAX_LIMIT = 30;
const MIN_AFFINITY_SAMPLE_FLOOR = 5;

interface HotPlaceFirestoreDocument {
  id?: unknown;
  title?: unknown;
  subtitle?: unknown;
  kind?: unknown;
  audience?: unknown;
  region?: unknown;
  metrics?: unknown;
  moderation?: unknown;
  compatibilitySignals?: unknown;
  affinityMix?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class HotPlacesService {
  private readonly firestore = inject(Firestore);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly regionFilter = inject(RegionFilterService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  watchHotPlacesForUserRegion$(
    uid: string,
    options: IHotPlaceQueryOptions = {}
  ): Observable<IHotPlaceCardVm[]> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of([]);
    }

    return this.regionFilter.getUserRegion(safeUid).pipe(
      switchMap((region) => this.watchHotPlacesForRegion$(region, options)),
      catchError((error) =>
        this.handleReadError<IHotPlaceCardVm>(
          error,
          'watchHotPlacesForUserRegion',
          { uid: safeUid }
        )
      )
    );
  }

  watchHotPlacesForRegion$(
    region: UserRegion | IHotPlaceRegion | null,
    options: IHotPlaceQueryOptions = {}
  ): Observable<IHotPlaceCardVm[]> {
    const normalizedRegion = this.normalizeRegion(region);

    if (!normalizedRegion) {
      return of([]);
    }

    const resultLimit = this.normalizeLimit(options.limit);
    const minimumScore = this.normalizeMinimumScore(options.minimumScore);
    const audience = options.audience ?? 'any';

    return this.firestoreContext.deferObservable$(() => {
      const hotPlacesRef = collection(this.firestore, 'regional_hot_places');
      const constraints: QueryConstraint[] = [
        where('region.uf', '==', normalizedRegion.uf),
        where('region.city', '==', normalizedRegion.city),
        where('moderation.visibility', '==', 'visible'),
        where('metrics.score', '>=', minimumScore),
        orderBy('metrics.score', 'desc'),
        firestoreLimit(resultLimit),
      ];

      if (audience !== 'any') {
        constraints.splice(3, 0, where('audience', 'in', ['all', audience]));
      }

      const hotPlacesQuery = query(hotPlacesRef, ...constraints);

      return collectionData(hotPlacesQuery, { idField: 'id' }) as Observable<
        HotPlaceFirestoreDocument[]
      >;
    }).pipe(
      map((items) =>
        (items ?? [])
          .map((item) => this.toHotPlaceCardVm(item))
          .filter((item): item is IHotPlaceCardVm => !!item)
      ),
      catchError((error) =>
        this.handleReadError<IHotPlaceCardVm>(
          error,
          'watchHotPlacesForRegion',
          { region: normalizedRegion, options }
        )
      )
    );
  }

  private toHotPlaceCardVm(
    raw: HotPlaceFirestoreDocument
  ): IHotPlaceCardVm | null {
    const id = String(raw.id ?? '').trim();
    const title = String(raw.title ?? '').trim();
    const region = this.normalizeRegion(raw.region as IHotPlaceRegion | null);
    const metrics = this.normalizeMetrics(raw.metrics);
    const moderation = this.normalizeModeration(raw.moderation);
    const affinityMix = this.normalizeAffinityMix(raw.affinityMix);

    if (!id || !title || !region || !metrics || moderation.visibility !== 'visible') {
      return null;
    }

    const item: IHotPlace = {
      id,
      title,
      subtitle: this.normalizeOptionalText(raw.subtitle),
      kind: this.normalizeKind(raw.kind),
      audience: this.normalizeAudience(raw.audience),
      region,
      metrics,
      moderation,
      compatibilitySignals: this.normalizeCompatibilitySignals(
        raw.compatibilitySignals
      ),
      affinityMix,
      createdAt: this.toMillis(raw.createdAt),
      updatedAt: this.toMillis(raw.updatedAt),
    };

    const affinitySegmentLabels = this.formatAffinitySegments(affinityMix);

    return {
      ...item,
      scoreLabel: this.formatScore(item.metrics.score),
      activityLabel: this.formatActivity(item.metrics.activeNowCount),
      regionLabel: `${item.region.city}, ${item.region.uf}`,
      affinitySummaryLabel: affinitySegmentLabels.length > 0
        ? `Afinidade: ${affinitySegmentLabels.slice(0, 2).join(' / ')}`
        : null,
      affinitySegmentLabels,
      isVisible: item.moderation.visibility === 'visible',
    };
  }

  private normalizeRegion(
    region: UserRegion | IHotPlaceRegion | null | undefined
  ): IHotPlaceRegion | null {
    const uf = String(region?.uf ?? '').trim().toUpperCase();
    const city = String(region?.city ?? '').trim().toLowerCase();

    if (!uf || !city) {
      return null;
    }

    return { uf, city };
  }

  private normalizeMetrics(raw: unknown): IHotPlace['metrics'] | null {
    const source = raw as Partial<IHotPlace['metrics']> | null | undefined;
    const score = this.toFiniteNumber(source?.score, 0);

    if (score <= 0) {
      return null;
    }

    return {
      score,
      activeNowCount: this.toNullableNumber(source?.activeNowCount),
      roomCount: this.toNullableNumber(source?.roomCount),
      compatibleProfileCount: this.toNullableNumber(source?.compatibleProfileCount),
      lastActivityAt: this.toMillis(source?.lastActivityAt),
    };
  }

  private normalizeModeration(raw: unknown): IHotPlace['moderation'] {
    const source = raw as Partial<IHotPlace['moderation']> | null | undefined;
    const visibility = this.normalizeVisibility(source?.visibility);

    return {
      visibility,
      reviewedAt: this.toMillis(source?.reviewedAt),
      reviewedBy: this.normalizeOptionalText(source?.reviewedBy),
      reason: this.normalizeOptionalText(source?.reason),
    };
  }

  private normalizeAffinityMix(raw: unknown): IHotPlaceAffinityMix | null {
    const source = raw as Partial<IHotPlaceAffinityMix> | null | undefined;
    const sampleFloor = this.toNullableNumber(source?.sampleFloor) ?? 0;

    if (!source || sampleFloor < MIN_AFFINITY_SAMPLE_FLOOR) {
      return null;
    }

    const primarySegments = this.normalizeAffinitySegments(source.primarySegments);
    const secondarySegments = this.normalizeAffinitySegments(source.secondarySegments);

    if (primarySegments.length === 0) {
      return null;
    }

    return {
      sampleFloor,
      primarySegments,
      secondarySegments,
      confidence: this.normalizeAffinityConfidence(source.confidence),
      generatedAt: this.toMillis(source.generatedAt),
    };
  }

  private normalizeVisibility(value: unknown): HotPlaceVisibility {
    if (value === 'visible' || value === 'hidden' || value === 'moderation_hold') {
      return value;
    }

    return 'hidden';
  }

  private normalizeKind(value: unknown): HotPlaceKind {
    if (
      value === 'city_area' ||
      value === 'venue' ||
      value === 'event' ||
      value === 'room_cluster' ||
      value === 'online_pulse'
    ) {
      return value;
    }

    return 'city_area';
  }

  private normalizeAudience(value: unknown): HotPlaceAudience {
    if (
      value === 'all' ||
      value === 'singles' ||
      value === 'couples' ||
      value === 'verified' ||
      value === 'subscribers'
    ) {
      return value;
    }

    return 'all';
  }

  private normalizeAffinityConfidence(value: unknown): IHotPlaceAffinityMix['confidence'] {
    if (value === 'low' || value === 'medium' || value === 'high') {
      return value;
    }

    return 'low';
  }

  private normalizeAffinitySegments(value: unknown): HotPlaceAffinitySegment[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const allowed = new Set<HotPlaceAffinitySegment>([
      'h_m',
      'm_h',
      'h_h',
      'm_m',
      'casais',
      'casais_solos',
      'misto',
      'lgbtq',
      'bi',
      'aberto',
    ]);

    return value
      .filter((segment): segment is HotPlaceAffinitySegment => {
        if (typeof segment !== 'string') {
          return false;
        }

        return allowed.has(segment as HotPlaceAffinitySegment);
      })
      .slice(0, 6);
  }

  private normalizeCompatibilitySignals(
    value: unknown
  ): HotPlaceCompatibilitySignal[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const allowed = new Set<HotPlaceCompatibilitySignal>([
      'same_city',
      'same_state',
      'available_now',
      'intent_overlap',
      'practice_overlap',
      'verified_only',
      'subscriber_boost',
    ]);

    return value.filter((signal): signal is HotPlaceCompatibilitySignal => {
      if (typeof signal !== 'string') {
        return false;
      }

      return allowed.has(signal as HotPlaceCompatibilitySignal);
    });
  }

  private normalizeOptionalText(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Math.trunc(this.toFiniteNumber(value, DEFAULT_LIMIT));
    return Math.min(Math.max(parsed, 1), MAX_LIMIT);
  }

  private normalizeMinimumScore(value: unknown): number {
    return Math.max(this.toFiniteNumber(value, DEFAULT_MINIMUM_SCORE), 0);
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return Math.max(Math.trunc(value), 0);
  }

  private toFiniteNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ) {
      return (value as { toMillis: () => number }).toMillis();
    }

    return null;
  }

  private formatScore(score: number): string {
    return `${Math.round(score)} pts`;
  }

  private formatActivity(activeNowCount: number | null | undefined): string {
    if (!activeNowCount) {
      return 'Atividade em alta';
    }

    if (activeNowCount === 1) {
      return '1 pessoa ativa agora';
    }

    return `${activeNowCount} pessoas ativas agora`;
  }

  private formatAffinitySegments(
    mix: IHotPlaceAffinityMix | null
  ): string[] {
    if (!mix) {
      return [];
    }

    return [...mix.primarySegments, ...(mix.secondarySegments ?? [])]
      .map((segment) => segment.toUpperCase().replace('_', '-'))
      .filter((label, index, labels) => !!label && labels.indexOf(label) === index)
      .slice(0, 4);
  }

  private handleReadError<T>(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): Observable<T[]> {
    try {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(`[HotPlacesService.${operation}] leitura falhou.`);

      (normalizedError as any).feature = 'hot_places';
      (normalizedError as any).operation = operation;
      (normalizedError as any).context = context;
      (normalizedError as any).original = error;
      (normalizedError as any).skipUserNotification = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }

    return of([]);
  }
}
