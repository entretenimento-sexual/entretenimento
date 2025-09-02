// src/app/core/services/geolocation/geolocation-tracking.service.ts
import { Injectable, NgZone } from '@angular/core';
import { FirestoreService } from '../data-handling/firestore.service'; // <- pasta irmã
import { Timestamp } from 'firebase/firestore';

type PermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

@Injectable({ providedIn: 'root' })
export class GeolocationTrackingService {
  private watchId: number | null = null;
  private lastWrite = 0;
  private readonly minWriteIntervalMs = 15_000; // reduz writes no Firestore
  private readonly consentKey = 'geoConsent';   // pista local para browsers sem Permissions API

  constructor(
    private ngZone: NgZone,
    private firestore: FirestoreService
  ) { }

  /** Evita rodar em SSR */
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

  /** Inicia o watchPosition (requer permissão concedida) */
  startTracking(uid: string): void {
    if (!this.isBrowser() || !navigator.geolocation || this.watchId !== null) return;

    this.ngZone.runOutsideAngular(() => {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          if (now - this.lastWrite < this.minWriteIntervalMs) return;
          this.lastWrite = now;

          const { latitude, longitude, accuracy } = pos.coords;
          this.firestore.updateDocument('users', uid, {
            latitude,
            longitude,
            locationAccuracy: Math.round(accuracy ?? 0),
            lastLocationAt: Timestamp.now()
          }).subscribe({
            error: () => { /* ignora falhas intermitentes de rede */ }
          });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            localStorage.setItem(this.consentKey, 'denied');
            this.stopTracking();
          }
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
      );
    });
  }

  /** Para o watcher (ex.: no logout) */
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
