// src/app/core/services/geolocation/geolocation-tracking.service.ts
import { Injectable, NgZone } from '@angular/core';
import { FirestoreService } from '../data-handling/firestore.service'; // <- pasta irmã
import { Timestamp } from 'firebase/firestore';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';

type PermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

@Injectable({ providedIn: 'root' })
export class GeolocationTrackingService {
  private watchId: number | null = null;

  private lastWrite = 0;
  private lastCoords?: GeoCoordinates;                 // ⬅️ add
  private readonly minWriteIntervalMs = 15_000;       // anti-spam básico
  private readonly distanceThresholdM = 100;          // ⬅️ add: mínima variação p/ gravar
  private readonly forceWriteIntervalMs = 120_000;    // ⬅️ add: “keepalive” a cada 2min

  private readonly consentKey = 'geoConsent';
  private readonly cacheKey = 'geo:last';             // ⬅️ add: snapshot local

  constructor(
    private ngZone: NgZone,
    private firestore: FirestoreService
  ) { }

  // ---------- CACHE LOCAL ----------
  private writeCache(coords: GeoCoordinates) {
    try { localStorage.setItem(this.cacheKey, JSON.stringify({ coords, timestamp: Date.now() })); } catch { }
  }
  getLastSnapshot(maxAgeMs = 120_000): GeoCoordinates | null {  // ⬅️ público p/ UI usar
    try {
      const raw = localStorage.getItem(this.cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { coords: GeoCoordinates; timestamp: number };
      if (!parsed?.coords || !parsed?.timestamp) return null;
      if (Date.now() - parsed.timestamp > maxAgeMs) return null;
      return parsed.coords;
    } catch { return null; }
  }

  // ---------- DISTÂNCIA ----------
  private toRad(d: number) { return d * Math.PI / 180; }
  private distanceMeters(a: GeoCoordinates, b: GeoCoordinates): number {
    const R = 6371000;
    const dLat = this.toRad(b.latitude - a.latitude);
    const dLon = this.toRad(b.longitude - a.longitude);
    const lat1 = this.toRad(a.latitude);
    const lat2 = this.toRad(b.latitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- PERMISSÃO - evita rodar em SSR ----------
  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined';
  }

  /** Lê o estado de permissão do navegador (quando suportado) */
  async queryPermission(): Promise<PermissionState> {
    if (!this.isBrowser()) return 'unsupported';
    if (!('permissions' in navigator) || !(navigator as any).permissions?.query) {
      const hint = (localStorage.getItem(this.consentKey) as PermissionState) || 'unsupported';
      return hint;
    }
    try {
      const status: PermissionStatus = await (navigator as any).permissions.query({ name: 'geolocation' });
      return status.state as PermissionState;
    } catch {
      const hint = (localStorage.getItem(this.consentKey) as PermissionState) || 'unsupported';
      return hint;
    }
  }

  /**
   * Dispara o prompt UMA vez (por ação do usuário).
   * Use isso, por ex., num botão “Ativar localização”.
   */
  requestPermissionOnce(): Promise<PermissionState> {
    return new Promise<PermissionState>((resolve) => {
      if (!this.isBrowser() || !navigator.geolocation) return resolve('unsupported');

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
   * Após o login, tenta religar o tracking automaticamente,
   * sem prompt, se a permissão já estiver concedida.
   */
  async autoStartTracking(uid: string): Promise<void> {
    if (!this.isBrowser() || !uid) return;
    const state = await this.queryPermission();
    if (state === 'granted') {
      this.startTracking(uid);
      this.bindPermissionChange(uid);
    }
  }

  // ---------- TRACK ----------
  startTracking(uid: string): void {
    if (!this.isBrowser() || !navigator.geolocation || this.watchId !== null) return;

    this.ngZone.runOutsideAngular(() => {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          const { latitude, longitude, accuracy } = pos.coords;
          const curr: GeoCoordinates = { latitude, longitude, accuracy } as any;

          const moved = this.lastCoords
            ? this.distanceMeters(this.lastCoords, curr)
            : Number.POSITIVE_INFINITY;

          // regras de economia:
          const enoughTime = (now - this.lastWrite) >= this.minWriteIntervalMs;
          const bigMove = moved >= this.distanceThresholdM;
          const keepAlive = (now - this.lastWrite) >= this.forceWriteIntervalMs;

          if (!enoughTime || (!bigMove && !keepAlive)) return;

          this.lastWrite = now;
          this.lastCoords = curr;
          this.writeCache(curr); // ⬅️ snapshot local sempre

          this.firestore.updateDocument('users', uid, {
            latitude,
            longitude,
            locationAccuracy: Math.round(accuracy ?? 0),
            lastLocationAt: Timestamp.now()
          }).subscribe({ error: () => { } });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            localStorage.setItem(this.consentKey, 'denied');
            this.stopTracking();
          }
        },
        {
          enableHighAccuracy: false,     // ⬅️ menor consumo; faça um botão “preciso” se quiser
          maximumAge: 300_000,           // ⬅️ aceita fix até 5min (reduz TIMEOUT)
          timeout: 20_000
        }
      );
    });
  }

  stopTracking(): void {
    if (!this.isBrowser()) return;
    if (this.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /** Reage a mudanças de permissão (quando o browser suporta) */
  private async bindPermissionChange(uid: string): Promise<void> {
    if (!this.isBrowser()) return;
    try {
      const perm: PermissionStatus = await (navigator as any).permissions.query({ name: 'geolocation' });
      const onChange = () => {
        const state = perm.state as PermissionState;
        if (state === 'granted') {
          localStorage.setItem(this.consentKey, 'granted');
          this.startTracking(uid);
        } else if (state === 'denied') {
          localStorage.setItem(this.consentKey, 'denied');
          this.stopTracking();
        }
      };
      // alguns browsers não implementam onchange — trate silenciosamente
      // @ts-ignore
      if (typeof perm.onchange === 'object' || typeof perm.onchange === 'function') {
        // @ts-ignore
        perm.onchange = onChange;
      }
    } catch {
      // sem Permissions API: ok, seguimos só com o watcher
    }
  }
}
