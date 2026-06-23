// src/app/core/services/discovery/user-intent-status.service.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS SERVICE
// -----------------------------------------------------------------------------
// Leitura reativa e publicação segura dos status temporários de intenção.
//
// Produto:
// - status de disponibilidade/intenção com expiração curta;
// - base para Descobertas, Radar de Hoje e futuros locais patrocinados;
// - permite listar quem declarou intenção para uma região/local sem GPS preciso.
//
// Segurança:
// - lê somente documentos liberados pelas Rules;
// - publicação/ocultação usam Cloud Functions;
// - o backend usa request.auth.uid e snapshot confiável de users/{uid};
// - não usa fallback global quando região está ausente;
// - erros técnicos vão para GlobalErrorHandlerService sem vazar para a UI.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  QueryConstraint,
  collection,
  collectionData,
  doc,
  getDoc,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import {
  Functions,
  httpsCallable,
} from '@angular/fire/functions';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  IUserIntentStatus,
  IUserIntentStatusCardVm,
  IUserIntentStatusPublishInput,
  IUserIntentStatusQueryOptions,
  IUserIntentStatusRegion,
  UserIntentAvailability,
  UserIntentDestinationKind,
  UserIntentStatusState,
  UserIntentVisibility,
} from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import {
  RegionFilterService,
  UserRegion,
} from 'src/app/core/services/filtering/filters/region-filter.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const DEFAULT_STATUS_DURATION_HOURS = 12;
const MAX_STATUS_DURATION_HOURS = 12;

interface UserIntentStatusFirestoreDocument {
  id?: unknown;
  uid?: unknown;
  profile?: unknown;
  availability?: unknown;
  visibility?: unknown;
  destination?: unknown;
  moderation?: unknown;
  startsAt?: unknown;
  expiresAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface PublishUserIntentStatusPayload {
  availability: UserIntentAvailability;
  visibility: UserIntentVisibility;
  destination: {
    kind: UserIntentDestinationKind;
    label: string;
    venueId?: string | null;
    region: IUserIntentStatusRegion;
  };
  durationHours: number;
}

interface UserIntentStatusCallableResponse {
  statusId: string;
  expiresAt: number;
  state: 'active' | 'hidden';
}

@Injectable({ providedIn: 'root' })
export class UserIntentStatusService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly regionFilter = inject(RegionFilterService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly publishStatusCallable = httpsCallable<
    PublishUserIntentStatusPayload,
    UserIntentStatusCallableResponse
  >(this.functions, 'publishUserIntentStatus');

  private readonly hideStatusCallable = httpsCallable<
    Record<string, never>,
    UserIntentStatusCallableResponse
  >(this.functions, 'hideUserIntentStatus');

  watchCurrentStatus$(uid: string): Observable<IUserIntentStatusCardVm | null> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of(null);
    }

    return this.firestoreContext.deferPromise$(() => {
      const statusRef = doc(
        this.firestore,
        'user_intent_statuses',
        `current_${safeUid}`
      );

      return getDoc(statusRef);
    }).pipe(
      map((statusSnap) => {
        if (!statusSnap.exists()) {
          return null;
        }

        return this.toStatusCardVm({
          id: statusSnap.id,
          ...(statusSnap.data() as Record<string, unknown>),
        });
      }),
      catchError((error) =>
        this.handleSingleReadError(
          error,
          'watchCurrentStatus',
          { uid: safeUid }
        )
      )
    );
  }

  watchActiveStatusesForUserRegion$(
    uid: string,
    options: IUserIntentStatusQueryOptions = {}
  ): Observable<IUserIntentStatusCardVm[]> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of([]);
    }

    return this.regionFilter.getUserRegion(safeUid).pipe(
      switchMap((region) => this.watchActiveStatusesForRegion$(region, options)),
      catchError((error) =>
        this.handleReadError<IUserIntentStatusCardVm>(
          error,
          'watchActiveStatusesForUserRegion',
          { uid: safeUid }
        )
      )
    );
  }

  watchActiveStatusesForRegion$(
    region: UserRegion | IUserIntentStatusRegion | null,
    options: IUserIntentStatusQueryOptions = {}
  ): Observable<IUserIntentStatusCardVm[]> {
    const normalizedRegion = this.normalizeRegion(region);

    if (!normalizedRegion) {
      return of([]);
    }

    const now = Date.now();
    const resultLimit = this.normalizeLimit(options.limit);
    const venueId = String(options.includeVenueId ?? '').trim();

    return this.firestoreContext.deferObservable$(() => {
      const constraints: QueryConstraint[] = [
        where('destination.region.uf', '==', normalizedRegion.uf),
        where('destination.region.city', '==', normalizedRegion.city),
        where('moderation.state', '==', 'active'),
        where('visibility', '==', 'public_discovery'),
        where('expiresAt', '>', now),
        orderBy('expiresAt', 'asc'),
        firestoreLimit(resultLimit),
      ];

      if (venueId) {
        constraints.splice(4, 0, where('destination.venueId', '==', venueId));
      }

      const statusesRef = collection(this.firestore, 'user_intent_statuses');
      const statusesQuery = query(statusesRef, ...constraints);

      return collectionData(statusesQuery, { idField: 'id' }) as Observable<
        UserIntentStatusFirestoreDocument[]
      >;
    }).pipe(
      map((items) =>
        (items ?? [])
          .map((item) => this.toStatusCardVm(item))
          .filter((item): item is IUserIntentStatusCardVm => !!item)
      ),
      catchError((error) =>
        this.handleReadError<IUserIntentStatusCardVm>(
          error,
          'watchActiveStatusesForRegion',
          { region: normalizedRegion, options }
        )
      )
    );
  }

  publishStatus$(input: IUserIntentStatusPublishInput): Observable<void> {
    const normalizedInput = this.normalizePublishInput(input);

    if (!normalizedInput) {
      return throwError(() => new Error('Status de intenção inválido.'));
    }

    const payload: PublishUserIntentStatusPayload = {
      availability: normalizedInput.availability,
      visibility: normalizedInput.visibility,
      destination: normalizedInput.destination,
      durationHours: normalizedInput.durationHours ?? DEFAULT_STATUS_DURATION_HOURS,
    };

    return defer(() => from(this.publishStatusCallable(payload))).pipe(
      map(() => undefined),
      catchError((error) => {
        this.handleWriteError(error, 'publishStatus', {
          uid: normalizedInput.uid,
          destination: normalizedInput.destination,
        });
        return throwError(() => error);
      })
    );
  }

  hideCurrentStatus$(uid: string): Observable<void> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('UID ausente para ocultar status.'));
    }

    return defer(() => from(this.hideStatusCallable({}))).pipe(
      map(() => undefined),
      catchError((error) => {
        this.handleWriteError(error, 'hideCurrentStatus', { uid: safeUid });
        return throwError(() => error);
      })
    );
  }

  private normalizePublishInput(
    input: IUserIntentStatusPublishInput
  ):
    | (IUserIntentStatusPublishInput & {
      startsAt: number;
      expiresAt: number;
    })
    | null {
    const uid = String(input.uid ?? '').trim();
    const nickname = String(input.profile?.nickname ?? '').trim();
    const region = this.normalizeRegion(input.destination?.region ?? null);
    const label = String(input.destination?.label ?? '').trim();
    const now = Date.now();
    const startsAt = Math.trunc(input.startsAt || now);
    const durationHours = Math.min(
      Math.max(Math.trunc(input.durationHours || DEFAULT_STATUS_DURATION_HOURS), 1),
      MAX_STATUS_DURATION_HOURS
    );
    const expiresAt = startsAt + durationHours * 60 * 60 * 1000;

    if (!uid || nickname.length < 2 || !region || label.length < 2) {
      return null;
    }

    return {
      uid,
      profile: {
        uid,
        nickname: nickname.slice(0, 40),
        photoURL: this.normalizeOptionalText(input.profile.photoURL),
        age: this.toNullableNumber(input.profile.age),
      },
      availability: this.normalizeAvailability(input.availability),
      visibility: this.normalizeVisibility(input.visibility),
      destination: {
        kind: this.normalizeDestinationKind(input.destination.kind),
        label: label.slice(0, 80),
        venueId: this.normalizeOptionalText(input.destination.venueId),
        region,
      },
      startsAt,
      expiresAt,
      durationHours,
    };
  }

  private toStatusCardVm(
    raw: UserIntentStatusFirestoreDocument
  ): IUserIntentStatusCardVm | null {
    const id = String(raw.id ?? '').trim();
    const uid = String(raw.uid ?? '').trim();
    const profile = this.normalizeProfile(raw.profile, uid);
    const destination = this.normalizeDestination(raw.destination);
    const moderation = this.normalizeModeration(raw.moderation);
    const startsAt = this.toMillis(raw.startsAt) ?? 0;
    const expiresAt = this.toMillis(raw.expiresAt) ?? 0;

    if (
      !id ||
      !uid ||
      !profile ||
      !destination ||
      moderation.state !== 'active' ||
      expiresAt <= Date.now()
    ) {
      return null;
    }

    const item: IUserIntentStatus = {
      id,
      uid,
      profile,
      availability: this.normalizeAvailability(raw.availability),
      visibility: this.normalizeVisibility(raw.visibility),
      destination,
      moderation,
      startsAt,
      expiresAt,
      createdAt: this.toMillis(raw.createdAt),
      updatedAt: this.toMillis(raw.updatedAt),
    };

    return {
      ...item,
      destinationLabel: this.formatDestination(item.destination),
      availabilityLabel: this.formatAvailability(item.availability),
      expiresInLabel: this.formatExpiresIn(item.expiresAt),
      isActive: item.moderation.state === 'active' && item.expiresAt > Date.now(),
    };
  }

  private normalizeProfile(raw: unknown, uid: string): IUserIntentStatus['profile'] | null {
    const source = raw as Partial<IUserIntentStatus['profile']> | null | undefined;
    const nickname = String(source?.nickname ?? '').trim();

    if (!uid || nickname.length < 2) {
      return null;
    }

    return {
      uid,
      nickname,
      photoURL: this.normalizeOptionalText(source?.photoURL),
      age: this.toNullableNumber(source?.age),
    };
  }

  private normalizeDestination(raw: unknown): IUserIntentStatus['destination'] | null {
    const source = raw as Partial<IUserIntentStatus['destination']> | null | undefined;
    const region = this.normalizeRegion(source?.region ?? null);
    const label = String(source?.label ?? '').trim();

    if (!region || label.length < 2) {
      return null;
    }

    return {
      kind: this.normalizeDestinationKind(source?.kind),
      label,
      venueId: this.normalizeOptionalText(source?.venueId),
      region,
    };
  }

  private normalizeRegion(
    region: UserRegion | IUserIntentStatusRegion | null | undefined
  ): IUserIntentStatusRegion | null {
    const uf = String(region?.uf ?? '').trim().toUpperCase();
    const city = String(region?.city ?? '').trim().toLowerCase();

    if (!uf || !city) {
      return null;
    }

    return { uf, city };
  }

  private normalizeModeration(raw: unknown): IUserIntentStatus['moderation'] {
    const source = raw as Partial<IUserIntentStatus['moderation']> | null | undefined;

    return {
      state: this.normalizeState(source?.state),
      reviewedAt: this.toMillis(source?.reviewedAt),
      reviewedBy: this.normalizeOptionalText(source?.reviewedBy),
      reason: this.normalizeOptionalText(source?.reason),
    };
  }

  private normalizeState(value: unknown): UserIntentStatusState {
    if (
      value === 'active' ||
      value === 'expired' ||
      value === 'hidden' ||
      value === 'moderation_hold'
    ) {
      return value;
    }

    return 'hidden';
  }

  private normalizeAvailability(value: unknown): UserIntentAvailability {
    if (
      value === 'available_now' ||
      value === 'available_today' ||
      value === 'planning_later'
    ) {
      return value;
    }

    return 'available_today';
  }

  private normalizeVisibility(value: unknown): UserIntentVisibility {
    if (
      value === 'public_discovery' ||
      value === 'members_only' ||
      value === 'friends_only'
    ) {
      return value;
    }

    return 'public_discovery';
  }

  private normalizeDestinationKind(value: unknown): UserIntentDestinationKind {
    if (
      value === 'region' ||
      value === 'venue' ||
      value === 'event' ||
      value === 'undecided'
    ) {
      return value;
    }

    return 'undecided';
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

  private formatDestination(destination: IUserIntentStatus['destination']): string {
    return `${destination.label} · ${destination.region.city}, ${destination.region.uf}`;
  }

  private formatAvailability(availability: UserIntentAvailability): string {
    switch (availability) {
    case 'available_now':
      return 'Disponível agora';
    case 'planning_later':
      return 'Planejando ir depois';
    case 'available_today':
    default:
      return 'Disponível hoje';
    }
  }

  private formatExpiresIn(expiresAt: number): string {
    const remainingMs = Math.max(expiresAt - Date.now(), 0);
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));

    if (remainingHours <= 1) {
      return 'Expira em até 1h';
    }

    return `Expira em ${remainingHours}h`;
  }

  private handleSingleReadError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): Observable<null> {
    if (!this.isPermissionDenied(error)) {
      this.reportReadError(error, operation, context);
    }

    return of(null);
  }

  private handleReadError<T>(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): Observable<T[]> {
    if (this.isPermissionDenied(error)) {
      return of([]);
    }

    try {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(`[UserIntentStatusService.${operation}] leitura falhou.`);

      (normalizedError as any).feature = 'user_intent_statuses';
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

  private reportReadError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(`[UserIntentStatusService.${operation}] leitura falhou.`);

      (normalizedError as any).feature = 'user_intent_statuses';
      (normalizedError as any).operation = operation;
      (normalizedError as any).context = context;
      (normalizedError as any).original = error;
      (normalizedError as any).skipUserNotification = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }
  }

  private handleWriteError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(`[UserIntentStatusService.${operation}] escrita falhou.`);

      (normalizedError as any).feature = 'user_intent_statuses';
      (normalizedError as any).operation = operation;
      (normalizedError as any).context = context;
      (normalizedError as any).original = error;
      (normalizedError as any).skipUserNotification = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }
  }
  private isPermissionDenied(error: unknown): boolean {
    const source = error as { code?: unknown; message?: unknown } | null | undefined;
    const code = String(source?.code ?? '').toLowerCase();
    const message = String(source?.message ?? '').toLowerCase();

    return code.includes('permission-denied')
      || message.includes('permission')
      || message.includes('no matching allow statements');
  }
}
