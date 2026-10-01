import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  GeolocationError,
  GeolocationErrorCode,
  GeolocationService,
} from 'src/app/core/services/geolocation/geolocation.service';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import type { UserLocation } from '../models/online-users.model';

export interface OnlineUsersLocationOptions {
  requireUserGesture: boolean;
  silent: boolean;
}

@Injectable()
export class OnlineUsersLocationFacade {
  static readonly DEFAULT_MAX_DISTANCE_KM = 20;
  static readonly MIN_DISTANCE_KM = 1;
  private static readonly LAST_COORDS_TTL_MS = 15 * 60 * 1000;

  private readonly destroyRef = inject(DestroyRef);

  readonly autoCheckDone = signal(false);
  readonly loading = signal(false);
  readonly location = signal<UserLocation | null>(null);
  readonly uiDistanceKm = signal<number | undefined>(undefined);
  readonly policyMaxDistanceKm = signal(
    OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
  );

  readonly distance$ = new BehaviorSubject<number | null>(null);

  private autoEnableUid: string | null = null;
  private autoEnableInFlight = false;

  constructor(
    private readonly geolocationService: GeolocationService,
    private readonly geoTracking: GeolocationTrackingService,
    private readonly notifications: ErrorNotificationService,
    private readonly applicationError: ApplicationErrorService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {
    this.destroyRef.onDestroy(() => {
      this.geoTracking.stopTracking();
      this.distance$.complete();
    });
  }

  markAutoCheckDone(): void {
    this.autoCheckDone.set(true);
  }

  reset(): void {
    this.autoEnableUid = null;
    this.autoEnableInFlight = false;
    this.autoCheckDone.set(false);

    this.geoTracking.stopTracking();

    this.location.set(null);
    this.uiDistanceKm.set(undefined);
    this.policyMaxDistanceKm.set(
      OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
    );
    this.distance$.next(null);
  }

  async tryAutoEnable(user: IUserDados | null): Promise<void> {
    if (!user?.uid) {
      this.autoCheckDone.set(true);
      return;
    }

    if (
      this.autoEnableUid === user.uid ||
      this.autoEnableInFlight
    ) {
      return;
    }

    this.autoEnableUid = user.uid;
    this.autoEnableInFlight = true;
    this.autoCheckDone.set(false);

    try {
      const usedSnapshot = this.tryUseLastKnownSnapshot(user);
      const state = await this.geoTracking.queryPermission();

      this.log('auto-enable permission state', {
        uid: user.uid,
        state,
        usedSnapshot,
      });

      if (state === 'granted') {
        await this.enable(user, {
          requireUserGesture: false,
          silent: true,
        });

        if (this.location()) {
          this.log('auto-enable location loaded', {
            uid: user.uid,
            hasLocation: true,
          });
          return;
        }
      }

      if (!usedSnapshot) {
        this.log('auto-enable waiting for user action');
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.autoEnableInFlight = false;
      this.autoCheckDone.set(true);
    }
  }

  async enable(
    currentUser: IUserDados,
    options: OnlineUsersLocationOptions
  ): Promise<void> {
    if (this.loading() || !currentUser?.uid) {
      return;
    }

    this.loading.set(true);

    try {
      const hadSnapshot = this.tryUseLastKnownSnapshot(currentUser);

      const raw = await firstValueFrom(
        this.geolocationService.currentPosition$({
          requireUserGesture: options.requireUserGesture,
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 20_000,
        })
      );

      const { coords: safe, policy } =
        this.geolocationService.applyRolePrivacy(
          raw,
          currentUser.role,
          !!currentUser.emailVerified
        );

      await firstValueFrom(
        this.geoTracking.persistLocationOnce$(currentUser.uid, raw)
      );

      this.location.set({
        latitude: safe.latitude,
        longitude: safe.longitude,
      });

      this.policyMaxDistanceKm.set(
        policy?.maxDistanceKm ??
          OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
      );

      this.clampUiDistanceToPolicy();
      this.distance$.next(
        this.uiDistanceKm() ?? this.policyMaxDistanceKm()
      );

      this.geoTracking.startTracking(currentUser.uid);

      if (!options.silent) {
        this.notifications.showSuccess(
          hadSnapshot
            ? 'Localização atualizada.'
            : 'Localização ativada e usuários carregados.'
        );
      }
    } catch (error) {
      if (error instanceof GeolocationError) {
        if (
          error.code === GeolocationErrorCode.TIMEOUT &&
          this.location()
        ) {
          this.log(
            'timeout while refining location; keeping last snapshot'
          );
          this.notifications.showInfo(
            'Não foi possível atualizar sua posição agora; usando a última conhecida.'
          );
          return;
        }

        if (error.code === GeolocationErrorCode.PERMISSION_DENIED) {
          this.geoTracking.stopTracking();

          if (this.location()) {
            this.log(
              'permission denied; keeping last known location'
            );
            this.notifications.showInfo(
              'Permissão de localização negada. Mantendo a última posição conhecida.'
            );
            return;
          }
        }
      }

      this.handleError(error);
    } finally {
      this.loading.set(false);
    }
  }

  setUiDistance(value: number | null | undefined): number {
    const max = Math.max(
      OnlineUsersLocationFacade.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm() ||
        OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
    );

    const next = Math.min(
      max,
      Math.max(
        OnlineUsersLocationFacade.MIN_DISTANCE_KM,
        Number(value) || max
      )
    );

    this.uiDistanceKm.set(next);
    this.distance$.next(next);

    this.log('distance changed', {
      requested: value,
      applied: next,
      max,
    });

    return next;
  }

  stepRange(delta: number): number {
    const max = Math.max(
      OnlineUsersLocationFacade.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm() ||
        OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
    );

    const current = this.uiDistanceKm() ?? max;
    return this.setUiDistance(current + delta);
  }

  normalizeDistanceCap(value: number | null | undefined): number {
    const max = Math.max(
      OnlineUsersLocationFacade.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm() ||
        OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
    );

    return Math.min(
      max,
      Math.max(
        OnlineUsersLocationFacade.MIN_DISTANCE_KM,
        Number(value ?? max) || max
      )
    );
  }

  getRangeThumbPercent(value?: number | null): number {
    const min = OnlineUsersLocationFacade.MIN_DISTANCE_KM;
    const max = Math.max(
      min,
      this.policyMaxDistanceKm() || min
    );
    const safeValue = Math.min(
      max,
      Math.max(min, value ?? max)
    );

    return ((safeValue - min) * 100) / (max - min || 1);
  }

  getRangeTrackBackground(value?: number | null): string {
    const percent = this.getRangeThumbPercent(value);

    return `linear-gradient(to right, var(--primary-color) ${percent}%, var(--range-track-color) ${percent}%)`;
  }

  handleError(error: unknown): void {
    let message = 'Falha ao obter a sua localização.';
    let isGestureOnly = false;

    if (error instanceof GeolocationError) {
      switch (error.code) {
        case GeolocationErrorCode.UNSUPPORTED:
          message = 'Seu navegador não suporta geolocalização.';
          break;
        case GeolocationErrorCode.INSECURE_CONTEXT:
          message =
            'Ative HTTPS ou use localhost para permitir a geolocalização.';
          break;
        case GeolocationErrorCode.PERMISSION_DENIED:
          message = 'Permissão de localização negada.';
          break;
        case GeolocationErrorCode.USER_GESTURE_REQUIRED:
          message = 'Clique em “Ativar localização” para continuar.';
          isGestureOnly = true;
          break;
        case GeolocationErrorCode.POSITION_UNAVAILABLE:
          message = 'Posição atual indisponível.';
          break;
        case GeolocationErrorCode.TIMEOUT:
          message = 'Tempo esgotado ao tentar localizar você.';
          break;
        default:
          message =
            'Ocorreu um erro desconhecido ao obter localização.';
      }
    } else if (error instanceof Error) {
      message = error.message || message;
    }

    this.notifications.showError(message);

    const expectedPermissionDenied =
      error instanceof GeolocationError &&
      error.code === GeolocationErrorCode.PERMISSION_DENIED;

    if (!isGestureOnly && !expectedPermissionDenied) {
      this.applicationError.report(error, {
        feature: 'online-users',
        operation: 'OnlineUsersLocationFacade.handleError',
        fallbackMessage: message,
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'OnlineUsersLocationFacade',
        },
      });
    }
  }

  private tryUseLastKnownSnapshot(
    currentUser: IUserDados
  ): boolean {
    const snapshot = this.geoTracking.getLastSnapshot(
      OnlineUsersLocationFacade.LAST_COORDS_TTL_MS
    );

    if (
      snapshot?.latitude == null ||
      snapshot?.longitude == null
    ) {
      return false;
    }

    const { coords: safe, policy } =
      this.geolocationService.applyRolePrivacy(
        snapshot as any,
        currentUser.role,
        !!currentUser.emailVerified
      );

    this.location.set({
      latitude: safe.latitude,
      longitude: safe.longitude,
    });

    this.policyMaxDistanceKm.set(
      policy?.maxDistanceKm ??
        OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
    );

    this.clampUiDistanceToPolicy();
    this.distance$.next(
      this.uiDistanceKm() ?? this.policyMaxDistanceKm()
    );

    this.log('using local snapshot while refining location', {
      hasLocation: true,
      policyMaxDistanceKm: this.policyMaxDistanceKm(),
      uiDistanceKm: this.uiDistanceKm(),
    });

    return true;
  }

  private clampUiDistanceToPolicy(): void {
    const max = Math.max(
      OnlineUsersLocationFacade.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm() ||
        OnlineUsersLocationFacade.DEFAULT_MAX_DISTANCE_KM
    );

    const current = this.uiDistanceKm() ?? max;

    this.uiDistanceKm.set(
      Math.min(
        max,
        Math.max(
          OnlineUsersLocationFacade.MIN_DISTANCE_KM,
          current
        )
      )
    );
  }

  private log(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'online-users',
      `OnlineUsersLocationFacade: ${message}`,
      extra
    );
  }
}
