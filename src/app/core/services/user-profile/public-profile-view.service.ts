import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  docSnapshots,
} from '@angular/fire/firestore';
import {
  Observable,
  combineLatest,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  throwError,
} from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import {
  IUserDados,
  UserTierRole,
} from '../../interfaces/iuser-dados';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { DistanceCalculationService } from '../geolocation/distance-calculation.service';
import {
  SafeGeoCoordinates,
  extractValidGeoCoordinates,
} from '../geolocation/utils/geolocation-coordinate.utils';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';

interface PublicProfileProjection {
  readonly profile: IUserDados;
  readonly coordinates: SafeGeoCoordinates | null;
}

const USER_ROLES = new Set<UserTierRole>([
  'visitante',
  'free',
  'basic',
  'premium',
  'vip',
  'admin',
]);

@Injectable({ providedIn: 'root' })
export class PublicProfileViewService {
  private readonly firestore = inject(Firestore);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly distanceCalculation = inject(DistanceCalculationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  watchProfile$(targetUid: string): Observable<IUserDados | null> {
    const safeTargetUid = this.normalizeUid(targetUid);

    if (!safeTargetUid) {
      return throwError(() => new Error('Perfil público inválido.'));
    }

    const publicProfile$ = this.firestoreContext
      .deferObservable$(() =>
        docSnapshots(
          doc(this.firestore, `public_profiles/${safeTargetUid}`)
        )
      )
      .pipe(
        map((snapshot) =>
          snapshot.exists()
            ? this.toProjection(
                snapshot.data() as Record<string, unknown>,
                safeTargetUid
              )
            : null
        )
      );

    const viewer$ = this.currentUserStore.user$.pipe(
      map((viewer) => viewer ?? null),
      startWith(this.currentUserStore.getSnapshot() ?? null),
      distinctUntilChanged((previous, current) =>
        this.sameCoordinates(previous, current)
      )
    );

    return combineLatest([publicProfile$, viewer$]).pipe(
      map(([projection, viewer]) =>
        projection
          ? this.withViewerDistance(projection, viewer)
          : null
      ),
      tap((profile) => {
        this.privacyDebug.log(
          'profile',
          'PublicProfileViewService: public profile resolved',
          {
            hasProfile: !!profile,
            hasDescription: !!profile?.descricao,
            hasDistance: typeof profile?.distanciaKm === 'number',
            relationshipIntentCount:
              profile?.publicRelationshipIntents?.length ?? 0,
            sexualPracticeCount:
              profile?.publicSexualPractices?.length ?? 0,
            bodyTraitCount: profile?.publicBodyTraits?.length ?? 0,
          }
        );
      }),
      catchError((error: unknown) => {
        this.reportError(error, safeTargetUid);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private toProjection(
    raw: Record<string, unknown>,
    fallbackUid: string
  ): PublicProfileProjection | null {
    const uid = this.firstText(raw, ['uid']) ?? fallbackUid;
    const nickname = this.firstText(raw, ['nickname']);

    if (!uid || !nickname) {
      return null;
    }

    const age = this.firstNumber(raw, ['age', 'idade']);
    const coordinates = extractValidGeoCoordinates({
      latitude: this.firstNumber(raw, ['latitude', 'lat']),
      longitude: this.firstNumber(raw, ['longitude', 'lng', 'lon']),
    });
    const relationshipIntents = this.firstStringArray(raw, [
      'publicRelationshipIntents',
    ]);
    const sexualPractices = this.firstStringArray(raw, [
      'publicSexualPractices',
    ]);
    const bodyTraits = this.firstStringArray(raw, [
      'publicBodyTraits',
    ]);
    const legacyPreferences = this.firstStringArray(raw, [
      'preferences',
      'preferencias',
    ]);

    const profile = {
      uid,
      nickname,
      email: null,
      photoURL: this.firstText(raw, [
        'photoURL',
        'photoUrl',
        'avatarUrl',
        'avatarURL',
      ]),
      role: this.normalizeRole(raw['role']),
      lastLogin: 0,
      descricao:
        this.firstDescription(raw, ['descricao', 'description', 'bio']) ?? '',
      isSubscriber: false,
      gender: this.firstText(raw, ['gender', 'genero']) ?? undefined,
      age,
      idade: age ?? undefined,
      orientation:
        this.firstText(raw, [
          'orientation',
          'sexualOrientation',
          'orientacao',
          'orientacaoSexual',
        ]) ?? undefined,
      partner1Orientation:
        this.firstText(raw, [
          'partner1Orientation',
          'orientation1',
          'orientacaoParceiro1',
        ]) ?? undefined,
      partner2Orientation:
        this.firstText(raw, [
          'partner2Orientation',
          'orientation2',
          'orientacaoParceiro2',
        ]) ?? undefined,
      municipio:
        this.firstText(raw, ['municipio', 'cidade', 'city']) ?? undefined,
      estado:
        this.firstText(raw, ['estado', 'uf', 'state']) ?? undefined,
      geohash: this.firstText(raw, ['geohash']) ?? undefined,
      preferences: legacyPreferences,
      publicRelationshipIntents: relationshipIntents,
      publicSexualPractices: sexualPractices,
      publicBodyTraits: bodyTraits,
      bodyTraits,
      preferenceBadgesVisible:
        typeof raw['preferenceBadgesVisible'] === 'boolean'
          ? raw['preferenceBadgesVisible']
          : null,
      createdAt: this.toMillis(raw['createdAt']),
      updatedAt: this.toMillis(raw['updatedAt']),
      mediaCount: this.firstNumber(raw, [
        'mediaCount',
        'publicMediaCount',
      ]),
      publicMediaCount: this.firstNumber(raw, [
        'publicMediaCount',
        'mediaCount',
      ]),
      photosCount: this.firstNumber(raw, [
        'photosCount',
        'publicPhotosCount',
      ]),
      publicPhotosCount: this.firstNumber(raw, [
        'publicPhotosCount',
        'photosCount',
      ]),
      videosCount: this.firstNumber(raw, [
        'videosCount',
        'publicVideosCount',
      ]),
      publicVideosCount: this.firstNumber(raw, [
        'publicVideosCount',
        'videosCount',
      ]),
      viewsCount: this.firstNumber(raw, [
        'viewsCount',
        'profileViewsCount',
        'profileViews',
      ]),
      likesCount: this.firstNumber(raw, [
        'likesCount',
        'publicLikesCount',
        'reactionsCount',
      ]),
      isOnline:
        typeof raw['isOnline'] === 'boolean'
          ? raw['isOnline']
          : undefined,
    } as IUserDados;

    return { profile, coordinates };
  }

  private withViewerDistance(
    projection: PublicProfileProjection,
    viewer: IUserDados | null
  ): IUserDados {
    const viewerCoordinates = extractValidGeoCoordinates(viewer);
    const targetCoordinates = projection.coordinates;

    if (!viewerCoordinates || !targetCoordinates) {
      return {
        ...projection.profile,
        distanciaKm: undefined,
      };
    }

    const distanciaKm = this.distanceCalculation.calculateDistanceInKm(
      viewerCoordinates.latitude,
      viewerCoordinates.longitude,
      targetCoordinates.latitude,
      targetCoordinates.longitude
    );

    return {
      ...projection.profile,
      distanciaKm: distanciaKm ?? undefined,
    };
  }

  private sameCoordinates(
    previous: IUserDados | null,
    current: IUserDados | null
  ): boolean {
    const previousCoordinates = extractValidGeoCoordinates(previous);
    const currentCoordinates = extractValidGeoCoordinates(current);

    return (
      previousCoordinates?.latitude === currentCoordinates?.latitude &&
      previousCoordinates?.longitude === currentCoordinates?.longitude
    );
  }

  private firstText(
    raw: Record<string, unknown>,
    keys: readonly string[]
  ): string | null {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value !== 'string') {
        continue;
      }

      const normalized = value.replace(/\s+/g, ' ').trim();
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private firstDescription(
    raw: Record<string, unknown>,
    keys: readonly string[]
  ): string | null {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value !== 'string') {
        continue;
      }

      const normalized = value
        .replace(/\r\n?/g, '\n')
        .replace(/[\t ]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 1000);

      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private firstNumber(
    raw: Record<string, unknown>,
    keys: readonly string[]
  ): number | null {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  private firstStringArray(
    raw: Record<string, unknown>,
    keys: readonly string[]
  ): string[] {
    for (const key of keys) {
      const value = raw[key];
      if (!Array.isArray(value)) {
        continue;
      }

      return Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      );
    }

    return [];
  }

  private toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    const timestamp = value as {
      toMillis?: () => number;
    } | null | undefined;

    return typeof timestamp?.toMillis === 'function'
      ? timestamp.toMillis()
      : null;
  }

  private normalizeRole(value: unknown): UserTierRole {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase() as UserTierRole;

    return USER_ROLES.has(normalized) ? normalized : 'free';
  }

  private normalizeUid(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private reportError(error: unknown, targetUid: string): void {
    const normalized =
      error instanceof Error
        ? error
        : new Error('Falha ao carregar o perfil público.');

    (normalized as any).context = {
      scope: 'PublicProfileViewService',
      op: 'watchProfile$',
      hasTargetUid: !!targetUid,
    };
    (normalized as any).original = error;
    (normalized as any).skipUserNotification = true;

    try {
      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
