// Serviço para rastreamento de geolocalização do usuário
// - Evita spam de escrita (intervalo mínimo + distância mínima + keepalive)
// - Evita rodar em SSR
// - Mantém snapshot local para UI consumir
// - Expõe snapshot reativo para recomposição imediata da descoberta
// - Isola watcher/cache por UID para impedir vazamento entre sessões
// - Escrita via FirestoreWriteService (elimina FirestoreService legado)
import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, EMPTY, Observable, of } from 'rxjs';
import { catchError, take } from 'rxjs/operators';

import {
  GeoCoordinates,
  GeoPermissionState,
  normalizeGeoPermissionState,
} from '../../interfaces/geolocation.interface';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { geohashForLocation } from 'geofire-common';
import { isValidGeoCoordinatePair } from './utils/geolocation-coordinate.utils';

interface CachedGeoSnapshot {
  uid: string;
  coords: GeoCoordinates;
  timestamp: number;
}

export interface StopGeolocationTrackingOptions {
  clearCachedLocation?: boolean;
}

@Injectable({ providedIn: 'root' })
export class GeolocationTrackingService {
  private watchId: number | null = null;
  private trackingUid: string | null = null;
  private permissionStatus: PermissionStatus | null = null;

  private lastWrite = 0;
  private lastCoords?: GeoCoordinates;

  private readonly snapshotSubject = new BehaviorSubject<GeoCoordinates | null>(null);
  readonly snapshot$ = this.snapshotSubject.asObservable();

  private readonly minWriteIntervalMs = 15_000;
  private readonly distanceThresholdM = 100;
  private readonly forceWriteIntervalMs = 120_000;

  private readonly consentKey = 'geoConsent';
  private readonly cacheKey = 'geo:last';

  private lastNotifyAt = 0;
  private readonly notifyThrottleMs = 12_000;

  constructor(
    private readonly ngZone: NgZone,
    private readonly write: FirestoreWriteService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService,
  ) {}

  // ---------- CACHE LOCAL ----------
  private writeCache(uid: string, coords: GeoCoordinates): void {
    try {
      const snapshot: CachedGeoSnapshot = {
        uid,
        coords,
        timestamp: Date.now(),
      };
      localStorage.setItem(this.cacheKey, JSON.stringify(snapshot));
    } catch {
      // best-effort
    }
  }

  private clearCache(): void {
    try {
      localStorage.removeItem(this.cacheKey);
    } catch {
      // best-effort
    }
  }

  /**
   * Snapshot recente para UI consumir.
   *
   * Segurança de sessão:
   * - o cache precisa pertencer ao UID que está sendo rastreado agora;
   * - payload legado sem uid é ignorado;
   * - uma conta nunca recebe posição deixada pela sessão anterior.
   */
  getLastSnapshot(maxAgeMs = 120_000): GeoCoordinates | null {
    try {
      const raw = localStorage.getItem(this.cacheKey);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as Partial<CachedGeoSnapshot>;
      const cacheUid = String(parsed?.uid ?? '').trim();
      const activeUid = String(this.trackingUid ?? '').trim();

      if (!cacheUid || !activeUid || cacheUid !== activeUid) {
        return null;
      }

      if (!parsed?.coords || !parsed?.timestamp) return null;
      if (Date.now() - parsed.timestamp > maxAgeMs) return null;

      return parsed.coords;
    } catch {
      return null;
    }
  }

  // ---------- DISTÂNCIA ----------
  private toRad(d: number): number {
    return d * Math.PI / 180;
  }

  private distanceMeters(a: GeoCoordinates, b: GeoCoordinates): number {
    const R = 6371000;
    const dLat = this.toRad(b.latitude - a.latitude);
    const dLon = this.toRad(b.longitude - a.longitude);
    const lat1 = this.toRad(a.latitude);
    const lat2 = this.toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- PERMISSÃO ----------
  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined';
  }

  async queryPermission(): Promise<GeoPermissionState> {
    if (!this.isBrowser()) {
      return 'unsupported';
    }

    if (!('permissions' in navigator) || !(navigator as any).permissions?.query) {
      const hint = localStorage.getItem(this.consentKey);
      return normalizeGeoPermissionState(hint);
    }

    try {
      const status: PermissionStatus = await (navigator as any).permissions.query({
        name: 'geolocation',
      });
      return normalizeGeoPermissionState(status?.state);
    } catch {
      const hint = localStorage.getItem(this.consentKey);
      return normalizeGeoPermissionState(hint);
    }
  }

  /** Dispara prompt somente por ação explícita do usuário. */
  requestPermissionOnce(): Promise<GeoPermissionState> {
    return new Promise<GeoPermissionState>((resolve) => {
      if (!this.isBrowser() || !navigator.geolocation) {
        return resolve('unsupported');
      }

      navigator.geolocation.getCurrentPosition(
        () => {
          localStorage.setItem(this.consentKey, 'granted');
          resolve('granted');
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            localStorage.setItem(this.consentKey, 'denied');
            resolve('denied');
          } else {
            resolve('prompt');
          }
        },
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    });
  }

  /**
   * Após login, religa tracking sem prompt quando a permissão já está concedida.
   * Se o UID mudou, encerra imediatamente o watcher da sessão anterior.
   */
  async autoStartTracking(uid: string): Promise<void> {
    const safeUid = String(uid ?? '').trim();
    if (!this.isBrowser() || !safeUid) return;

    if (this.trackingUid && this.trackingUid !== safeUid) {
      this.stopTracking({ clearCachedLocation: true });
    }

    const state = await this.queryPermission();
    if (state === 'granted') {
      this.startTracking(safeUid);
      await this.bindPermissionChange(safeUid);
    }
  }

  // ---------- TRACK ----------
  startTracking(uid: string): void {
    const safeUid = String(uid ?? '').trim();
    if (!this.isBrowser() || !navigator.geolocation || !safeUid) return;

    if (this.watchId !== null && this.trackingUid === safeUid) {
      return;
    }

    if (this.watchId !== null || (this.trackingUid && this.trackingUid !== safeUid)) {
      this.stopTracking({ clearCachedLocation: true });
    }

    this.trackingUid = safeUid;
    this.lastWrite = 0;
    this.lastCoords = undefined;
    this.snapshotSubject.next(this.getLastSnapshot());

    this.ngZone.runOutsideAngular(() => {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          // Callback antigo já enfileirado não pode escrever no UID anterior.
          if (this.trackingUid !== safeUid) return;

          const now = Date.now();
          const { latitude, longitude, accuracy } = pos.coords;
          const curr: GeoCoordinates = {
            latitude,
            longitude,
            accuracy,
          } as GeoCoordinates;

          // A UI pode recalcular distância imediatamente, independentemente do
          // throttle de persistência usado para proteger o Firestore.
          this.snapshotSubject.next(curr);

          const moved = this.lastCoords
            ? this.distanceMeters(this.lastCoords, curr)
            : Number.POSITIVE_INFINITY;

          const enoughTime = (now - this.lastWrite) >= this.minWriteIntervalMs;
          const bigMove = moved >= this.distanceThresholdM;
          const keepAlive = (now - this.lastWrite) >= this.forceWriteIntervalMs;

          if (!enoughTime || (!bigMove && !keepAlive)) return;

          this.lastWrite = now;
          this.lastCoords = curr;
          this.writeCache(safeUid, curr);

          this.persistLocation$(safeUid, latitude, longitude, accuracy)
            .pipe(take(1))
            .subscribe();
        },
        (err) => {
          if (this.trackingUid !== safeUid) return;

          if (err.code === err.PERMISSION_DENIED) {
            localStorage.setItem(this.consentKey, 'denied');
            this.stopTracking({ clearCachedLocation: true });
          }
        },
        {
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 20_000,
        }
      );
    });
  }

  stopTracking(options: StopGeolocationTrackingOptions = {}): void {
    if (!this.isBrowser()) return;

    if (this.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }

    this.watchId = null;
    this.trackingUid = null;
    this.lastWrite = 0;
    this.lastCoords = undefined;
    this.snapshotSubject.next(null);
    this.unbindPermissionChange();

    if (options.clearCachedLocation === true) {
      this.clearCache();
    }
  }

  /**
   * Persiste uma posição pontual em users/{uid}.
   * public_profiles/{uid} é derivado pelo trigger syncPublicProfileDiscovery.
   */
  persistLocationOnce$(uid: string, coords: GeoCoordinates): Observable<void> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid || !this.isValidCoordinates(coords?.latitude, coords?.longitude)) {
      return of(void 0);
    }

    return this.persistLocation$(
      safeUid,
      coords.latitude,
      coords.longitude,
      coords.accuracy
    );
  }

  private isValidCoordinates(latitude: unknown, longitude: unknown): boolean {
    return isValidGeoCoordinatePair(latitude, longitude);
  }

  /**
   * Escrita centralizada em users/{uid}.
   * O backend deriva a projeção pública com a política de precisão do discovery.
   */
  private persistLocation$(
    uid: string,
    latitude: number,
    longitude: number,
    accuracy?: number | null
  ): Observable<void> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid || !this.isValidCoordinates(latitude, longitude)) {
      return of(void 0);
    }

    const geohash = geohashForLocation([latitude, longitude]);

    return this.write.updateDocument(
      'users',
      safeUid,
      {
        latitude,
        longitude,
        geohash,
        locationAccuracy: Math.round(accuracy ?? 0),
        lastLocationAt: Date.now(),
      },
      {
        silent: true,
        context: 'GeolocationTrackingService.persistLocation$',
      }
    ).pipe(
      catchError((err) => {
        this.handleWriteError(err);
        return EMPTY;
      })
    );
  }

  private handleWriteError(err: unknown): void {
    try {
      const e = err instanceof Error ? err : new Error('Falha ao persistir localização.');
      (e as any).context = 'GeolocationTrackingService.persistLocation$';
      (e as any).original = err;
      (e as any).silent = true;
      (e as any).skipUserNotification = true;
      this.globalError.handleError(e);
    } catch {
      // no-op
    }

    const now = Date.now();
    if (now - this.lastNotifyAt > this.notifyThrottleMs) {
      this.lastNotifyAt = now;
      this.notifier.showError('Falha ao atualizar localização.');
    }
  }

  /** Reage a mudanças de permissão (quando o browser suporta). */
  private async bindPermissionChange(uid: string): Promise<void> {
    if (!this.isBrowser()) return;

    this.unbindPermissionChange();

    try {
      const perm: PermissionStatus = await (navigator as any).permissions.query({
        name: 'geolocation',
      });

      this.permissionStatus = perm;
      perm.onchange = () => {
        // Listener de sessão antiga nunca pode reativar tracking.
        if (this.trackingUid !== uid) {
          return;
        }

        const state = normalizeGeoPermissionState(perm.state);

        if (state === 'granted') {
          localStorage.setItem(this.consentKey, 'granted');
          this.startTracking(uid);
          return;
        }

        if (state === 'denied') {
          localStorage.setItem(this.consentKey, 'denied');
          this.stopTracking({ clearCachedLocation: true });
        }
      };
    } catch {
      // sem Permissions API: ok
    }
  }

  private unbindPermissionChange(): void {
    if (!this.permissionStatus) return;

    try {
      this.permissionStatus.onchange = null;
    } catch {
      // best-effort
    }

    this.permissionStatus = null;
  }
}
