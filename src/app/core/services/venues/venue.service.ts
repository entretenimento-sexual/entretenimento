// src/app/core/services/venues/venue.service.ts
// -----------------------------------------------------------------------------
// VENUE SERVICE
// -----------------------------------------------------------------------------
// Leitura reativa de estabelecimentos moderados.
//
// Produto:
// - alimentar seleção de local no Status de Hoje;
// - preparar salas de estabelecimento;
// - preparar destaque patrocinado;
// - manter texto livre separado de local gerenciado.
//
// Segurança:
// - leitura respeita Rules;
// - sem fallback global quando região está ausente;
// - escrita direta de cliente comum não é oferecida.
// -----------------------------------------------------------------------------

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
  IVenue,
  IVenueCardVm,
  IVenueQueryOptions,
  IVenueRegion,
  VenueKind,
  VenueModerationState,
  VenueSponsorshipState,
  VenueVisibility,
} from 'src/app/core/interfaces/venues/venue.interface';
import {
  RegionFilterService,
  UserRegion,
} from 'src/app/core/services/filtering/filters/region-filter.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

interface VenueFirestoreDocument {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  kind?: unknown;
  description?: unknown;
  region?: unknown;
  addressHint?: unknown;
  visibility?: unknown;
  moderation?: unknown;
  sponsorship?: unknown;
  chat?: unknown;
  ownerUid?: unknown;
  adminUids?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class VenueService {
  private readonly firestore = inject(Firestore);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly regionFilter = inject(RegionFilterService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  watchVenuesForUserRegion$(
    uid: string,
    options: IVenueQueryOptions = {}
  ): Observable<IVenueCardVm[]> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of([]);
    }

    return this.regionFilter.getUserRegion(safeUid).pipe(
      switchMap((region) => this.watchVenuesForRegion$(region, options)),
      catchError((error) =>
        this.handleReadError<IVenueCardVm>(
          error,
          'watchVenuesForUserRegion',
          { uid: safeUid }
        )
      )
    );
  }

  watchVenuesForRegion$(
    region: UserRegion | IVenueRegion | null,
    options: IVenueQueryOptions = {}
  ): Observable<IVenueCardVm[]> {
    const normalizedRegion = this.normalizeRegion(region);

    if (!normalizedRegion) {
      return of([]);
    }

    const resultLimit = this.normalizeLimit(options.limit);
    const constraints: QueryConstraint[] = [
      where('region.uf', '==', normalizedRegion.uf),
      where('region.city', '==', normalizedRegion.city),
      where('moderation.state', '==', 'active'),
      where('visibility', 'in', ['public', 'members_only']),
      orderBy('sponsorship.priority', 'desc'),
      orderBy('name', 'asc'),
      firestoreLimit(resultLimit),
    ];

    if (options.kind && options.kind !== 'any') {
      constraints.splice(4, 0, where('kind', '==', options.kind));
    }

    return this.firestoreContext.deferObservable$(() => {
      const venuesRef = collection(this.firestore, 'venues');
      const venuesQuery = query(venuesRef, ...constraints);

      return collectionData(venuesQuery, { idField: 'id' }) as Observable<
        VenueFirestoreDocument[]
      >;
    }).pipe(
      map((items) =>
        (items ?? [])
          .map((item) => this.toVenueCardVm(item))
          .filter((item): item is IVenueCardVm => !!item)
      ),
      catchError((error) =>
        this.handleReadError<IVenueCardVm>(
          error,
          'watchVenuesForRegion',
          { region: normalizedRegion, options }
        )
      )
    );
  }

  private toVenueCardVm(raw: VenueFirestoreDocument): IVenueCardVm | null {
    const id = String(raw.id ?? '').trim();
    const name = String(raw.name ?? '').trim();
    const slug = String(raw.slug ?? '').trim();
    const region = this.normalizeRegion(raw.region as IVenueRegion | null);
    const moderation = this.normalizeModeration(raw.moderation);

    if (!id || !name || !slug || !region || moderation.state !== 'active') {
      return null;
    }

    const venue: IVenue = {
      id,
      name,
      slug,
      kind: this.normalizeKind(raw.kind),
      description: this.normalizeOptionalText(raw.description),
      region,
      addressHint: this.normalizeOptionalText(raw.addressHint),
      visibility: this.normalizeVisibility(raw.visibility),
      moderation,
      sponsorship: this.normalizeSponsorship(raw.sponsorship),
      chat: this.normalizeChat(raw.chat),
      ownerUid: this.normalizeOptionalText(raw.ownerUid),
      adminUids: Array.isArray(raw.adminUids)
        ? raw.adminUids.filter((uid): uid is string => typeof uid === 'string')
        : [],
      createdAt: this.toMillis(raw.createdAt),
      updatedAt: this.toMillis(raw.updatedAt),
    };

    return {
      ...venue,
      regionLabel: this.formatRegion(venue.region),
      kindLabel: this.formatKind(venue.kind),
      sponsorshipLabel: this.formatSponsorship(venue.sponsorship.state),
      canShowChatEntry: venue.chat.enabled,
    };
  }

  private normalizeRegion(
    region: UserRegion | IVenueRegion | null | undefined
  ): IVenueRegion | null {
    const uf = String(region?.uf ?? '').trim().toUpperCase();
    const city = String(region?.city ?? '').trim().toLowerCase();
    const district = this.normalizeOptionalText((region as IVenueRegion | null)?.district);

    if (!uf || !city) {
      return null;
    }

    return { uf, city, district };
  }

  private normalizeModeration(raw: unknown): IVenue['moderation'] {
    const source = raw as Partial<IVenue['moderation']> | null | undefined;

    return {
      state: this.normalizeModerationState(source?.state),
      reviewedAt: this.toMillis(source?.reviewedAt),
      reviewedBy: this.normalizeOptionalText(source?.reviewedBy),
      reason: this.normalizeOptionalText(source?.reason),
    };
  }

  private normalizeSponsorship(raw: unknown): IVenue['sponsorship'] {
    const source = raw as Partial<IVenue['sponsorship']> | null | undefined;

    return {
      state: this.normalizeSponsorshipState(source?.state),
      priority: this.toNullableNumber(source?.priority),
      startsAt: this.toMillis(source?.startsAt),
      endsAt: this.toMillis(source?.endsAt),
    };
  }

  private normalizeChat(raw: unknown): IVenue['chat'] {
    const source = raw as Partial<IVenue['chat']> | null | undefined;
    const mode = source?.mode;

    return {
      enabled: source?.enabled === true,
      mode:
        mode === 'public_preview' ||
        mode === 'frequenters_only' ||
        mode === 'hybrid'
          ? mode
          : 'hybrid',
      roomId: this.normalizeOptionalText(source?.roomId),
    };
  }

  private normalizeKind(value: unknown): VenueKind {
    if (
      value === 'bar' ||
      value === 'club' ||
      value === 'restaurant' ||
      value === 'pub' ||
      value === 'event_space' ||
      value === 'hotel' ||
      value === 'other'
    ) {
      return value;
    }

    return 'other';
  }

  private normalizeVisibility(value: unknown): VenueVisibility {
    if (value === 'public' || value === 'members_only' || value === 'hidden') {
      return value;
    }

    return 'hidden';
  }

  private normalizeModerationState(value: unknown): VenueModerationState {
    if (
      value === 'active' ||
      value === 'pending_review' ||
      value === 'hidden' ||
      value === 'rejected'
    ) {
      return value;
    }

    return 'hidden';
  }

  private normalizeSponsorshipState(value: unknown): VenueSponsorshipState {
    if (
      value === 'none' ||
      value === 'eligible' ||
      value === 'sponsored' ||
      value === 'paused'
    ) {
      return value;
    }

    return 'none';
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Math.trunc(this.toFiniteNumber(value, DEFAULT_LIMIT));
    return Math.min(Math.max(parsed, 1), MAX_LIMIT);
  }

  private normalizeOptionalText(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
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

  private formatRegion(region: IVenueRegion): string {
    const district = region.district ? `${region.district} · ` : '';
    return `${district}${region.city}, ${region.uf}`;
  }

  private formatKind(kind: VenueKind): string {
    const labels: Record<VenueKind, string> = {
      bar: 'Bar',
      club: 'Boate',
      restaurant: 'Restaurante',
      pub: 'Choperia',
      event_space: 'Espaço de eventos',
      hotel: 'Hotel',
      other: 'Outro local',
    };

    return labels[kind];
  }

  private formatSponsorship(state: VenueSponsorshipState): string | null {
    if (state === 'sponsored') {
      return 'Patrocinado';
    }

    if (state === 'eligible') {
      return 'Elegível para destaque';
    }

    return null;
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
          : new Error(`[VenueService.${operation}] leitura falhou.`);

      (normalizedError as any).feature = 'venues';
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
