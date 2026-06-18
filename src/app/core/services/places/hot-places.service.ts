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
// - a camada é reativa e cacheável por shareReplay no consumidor.
//
// Integração futura:
// - Dashboard / Descobrir: exibir cards regionais;
// - Rooms: transformar `room_cluster` em entrada para salas ativas;
// - Compatibilidade: usar compatibilitySignals e filtros por perfil atual;
// - Cloud Functions: alimentar a projeção com score agregado e anonimizado.

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
  IHotPlace,
  IHotPlaceAudience,
  IHotPlaceCardVm,
  IHotPlaceCompatibilitySignal,
  IHotPlaceKind,
  IHotPlaceQueryOptions,
  IHotPlaceRegion,
  IHotPlaceVisibility,
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

interface HotPlaceFirestoreDocument extends Partial<IHotPlace> {
  id?: unknown;
  title?: unknown;
  subtitle?: unknown;
  kind?: unknown;
  audience?: unknown;
  region?: unknown;
  metrics?: unknown;
  moderation?: unknown;
  compatibilitySignals?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class HotPlacesService {
  private readonly firestore = inject(Firestore);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly regionFilter = inject(RegionFilterService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  /**
   * Observa locais bombando na região do usuário.
   *
   * Retorna vazio quando o usuário não tem região válida, evitando fallback amplo
   * que poderia expor conteúdo fora de contexto regional.
   */
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

  /**
   * Observa locais bombando por região explícita.
   */
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
          {
            region: normalizedRegion,
            options,
          }
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
      createdAt: this.toMillis(raw.createdAt),
      updatedAt: this.toMillis(raw.updatedAt),
    };

    return {
      ...item,
      scoreLabel: this.formatScore(item.metrics.score),
      activityLabel: this.formatActivity(item.metrics.activeNowCount),
      regionLabel: `${item.region.city}, ${item.region.uf}`,
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

  private normalizeVisibility(value: unknown): IHotPlaceVisibility {
    if (value === 'visible' || value === 'hidden' || value === 'moderation_hold') {
      return value;
    }

    return 'hidden';
  }

  private normalizeKind(value: unknown): IHotPlaceKind {
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

  private normalizeAudience(value: unknown): IHotPlaceAudience {
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

  private normalizeCompatibilitySignals(
    value: unknown
  ): IHotPlaceCompatibilitySignal[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const allowed = new Set<IHotPlaceCompatibilitySignal>([
      'same_city',
      'same_state',
      'available_now',
      'intent_overlap',
      'practice_overlap',
      'verified_only',
      'subscriber_boost',
    ]);

    return value.filter((signal): signal is IHotPlaceCompatibilitySignal => {
      if (typeof signal !== 'string') {
        return false;
      }

      return allowed.has(signal as IHotPlaceCompatibilitySignal);
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
