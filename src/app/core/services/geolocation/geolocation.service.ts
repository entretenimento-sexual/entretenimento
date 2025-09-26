// src/app/core/services/geolocation/geolocation.service.ts
import { Injectable } from '@angular/core';
import { Observable, defer, from, firstValueFrom, switchMap } from 'rxjs';
import { geohashForLocation } from 'geofire-common';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';

export type UserRole = 'vip' | 'premium' | 'basico' | 'free' | string;

export interface GeoPolicy {
  geohashLen: number;    // precisão de geohash para consultas
  maxDistanceKm: number; // raio sugerido para buscas
  decimals: number;      // arredondamento de lat/lon (privacidade)
}

/** Opções extras do serviço além do PositionOptions nativo. */
export interface GeolocationExtras {
  /**
   * Se true, bloqueia a chamada quando a permissão não está “granted”,
   * forçando o fluxo a ocorrer após gesto do usuário (evita warning do browser).
   */
  requireUserGesture?: boolean;
}
export type GeolocationOptions = PositionOptions & GeolocationExtras;

/** Códigos de erro tipados (bom para i18n, logs e UI). */
export enum GeolocationErrorCode {
  UNSUPPORTED = 'UNSUPPORTED',             // Browser não tem geolocation
  INSECURE_CONTEXT = 'INSECURE_CONTEXT',   // Necessário HTTPS (exceto localhost)
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  POSITION_UNAVAILABLE = 'POSITION_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  USER_GESTURE_REQUIRED = 'USER_GESTURE_REQUIRED',
  UNKNOWN = 'UNKNOWN',
}

/** Erro padronizado do serviço. */
export class GeolocationError extends Error {
  constructor(
    message: string,
    public readonly code: GeolocationErrorCode
  ) { super(message); }
}

@Injectable({ providedIn: 'root' })
export class GeolocationService {

  /** ✅ Suporte à API. */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.geolocation;
  }

  /** ✅ HTTPS é obrigatório, mas localhost (e variações) são permitidos; jsdom pode ter hostname vazio */
  isSecureContext(): boolean {
    if (typeof window === 'undefined') return true; // ambiente de teste/SSR
    const h = window.location?.hostname || '';
    const isLocal =
      h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
    return !!(window as any).isSecureContext || isLocal;
  }

  /** ✅ Consulta a Permissions API (pode ser 'unsupported' em alguns navegadores). */
  async queryPermission(): Promise<PermissionState | 'unsupported'> {
    try {
      const permissions = (navigator as any).permissions;
      if (!permissions?.query) return 'unsupported';
      const status = await permissions.query({ name: 'geolocation' as any });
      return (status?.state ?? 'unsupported') as PermissionState | 'unsupported';
    } catch {
      return 'unsupported';
    }
  }

  /** ✅ Defaults conservadores (acessibilidade + bateria). */
  private buildOptions(options?: GeolocationOptions): GeolocationOptions {
    return {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 0,
      requireUserGesture: false,
      ...(options || {})
    };
  }

  /** 🔎 Pré-checagens que podem lançar um erro tipado. */
  private async preflight(options?: GeolocationOptions): Promise<void> {
    if (!this.isSupported()) {
      throw new GeolocationError(
        'Geolocalização não suportada pelo navegador.',
        GeolocationErrorCode.UNSUPPORTED
      );
    }
    if (!this.isSecureContext()) {
      throw new GeolocationError(
        'Geolocalização requer HTTPS ou localhost.',
        GeolocationErrorCode.INSECURE_CONTEXT
      );
    }

    const permission = await this.queryPermission();
    // Se o chamador pede gesto do usuário, e ainda não é "granted", aborta agora.
    if (options?.requireUserGesture && permission !== 'granted') {
      throw new GeolocationError(
        'Solicite a localização após um gesto do usuário (ex.: clique em “Ativar localização”).',
        GeolocationErrorCode.USER_GESTURE_REQUIRED
      );
    }
  }

  /** ↔️ Mapeia o erro do DOM (por código numérico 1/2/3) para nossos códigos. */
  private mapDomError(err: GeolocationPositionError | any): GeolocationError {
    const code: number = typeof err?.code === 'number' ? err.code : -1;
    switch (code) {
      case 1: /* PERMISSION_DENIED */
        return new GeolocationError('Permissão de localização negada.', GeolocationErrorCode.PERMISSION_DENIED);
      case 2: /* POSITION_UNAVAILABLE */
        return new GeolocationError('Posição não disponível.', GeolocationErrorCode.POSITION_UNAVAILABLE);
      case 3: /* TIMEOUT */
        return new GeolocationError('O tempo de solicitação de localização expirou.', GeolocationErrorCode.TIMEOUT);
      default:
        return new GeolocationError('Erro desconhecido ao tentar obter localização.', GeolocationErrorCode.UNKNOWN);
    }
  }

  // =============================================================
  // API PRINCIPAL — OBSERVABLES
  // =============================================================

  /**
   * ✅ One-shot reativo: obtém a posição atual e completa.
   * DICA: chame **após um gesto do usuário** ou use `{ requireUserGesture: true }`
   * para evitar o warning do navegador.
   */
  currentPosition$(options?: GeolocationOptions): Observable<GeoCoordinates> {
    const opts = this.buildOptions(options);

    return defer(() => from(this.preflight(opts))).pipe(
      switchMap(() =>
        new Observable<GeoCoordinates>((subscriber) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed } = pos.coords;
              const geohash = geohashForLocation([latitude, longitude]);
              subscriber.next({ latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed, geohash });
              subscriber.complete();
            },
            (err) => subscriber.error(this.mapDomError(err)),
            opts
          );
        })
      )
    );
  }

  /**
   * ✅ Stream contínuo: acompanha mudanças de posição.
   * Cancele com `unsubscribe()` / `takeUntil` para evitar *leaks*.
   * Ideal também iniciar após gesto do usuário.
   */
  watchPosition$(options?: GeolocationOptions): Observable<GeoCoordinates> {
    const opts = this.buildOptions(options);

    return defer(() => from(this.preflight(opts))).pipe(
      switchMap(() =>
        new Observable<GeoCoordinates>((subscriber) => {
          const watchId = navigator.geolocation.watchPosition(
            (pos) => {
              const { latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed } = pos.coords;
              const geohash = geohashForLocation([latitude, longitude]);
              subscriber.next({ latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed, geohash });
            },
            (err) => subscriber.error(this.mapDomError(err)),
            opts
          );
          // cleanup ao cancelar a inscrição
          return () => navigator.geolocation.clearWatch(watchId);
        })
      )
    );
  }

  // =============================================================
  // PRIVACIDADE / PAYWALL POR ROLE
  // =============================================================

  /** Reduz a precisão do geohash (privacidade / paywall por role). */
  toCoarseGeohash(geohash: string | undefined, len: number): string | undefined {
    if (!geohash) return geohash;
    return geohash.slice(0, Math.max(1, Math.min(len, geohash.length)));
  }

  /** Arredonda latitude/longitude para reduzir precisão (privacidade). */
  toCoarseCoords(coords: GeoCoordinates, decimals: number): GeoCoordinates {
    const clamp = (n: number) => Math.max(0, Math.min(6, n));
    const round = (v: number | null | undefined) =>
      typeof v === 'number' ? Number(v.toFixed(clamp(decimals))) : (v as any);

    return {
      ...coords,
      latitude: round(coords.latitude),
      longitude: round(coords.longitude),
    };
  }

  /** Política padrão por role, ajustada se o e-mail NÃO estiver verificado. */
  getPolicyFor(role: UserRole | undefined, emailVerified: boolean): GeoPolicy {
    const r = (role || 'free').toString().toLowerCase();
    const base: Record<string, GeoPolicy> = {
      vip: { geohashLen: 9, maxDistanceKm: 100, decimals: 5 },
      premium: { geohashLen: 8, maxDistanceKm: 50, decimals: 4 },
      basico: { geohashLen: 7, maxDistanceKm: 20, decimals: 3 },
      free: { geohashLen: 5, maxDistanceKm: 10, decimals: 2 },
    };
    const policy = base[r] || base['free']; // <- index access p/ noPropertyAccessFromIndexSignature

    if (!emailVerified) {
      return {
        geohashLen: Math.min(5, policy.geohashLen),
        maxDistanceKm: Math.min(20, policy.maxDistanceKm),
        decimals: Math.min(2, policy.decimals),
      };
    }
    return policy;
  }

  /** Aplica a política (role + verificação) às coordenadas e ao geohash. */
  applyRolePrivacy(
    coords: GeoCoordinates,
    role: UserRole | undefined,
    emailVerified: boolean
  ): { coords: GeoCoordinates; geohash: string | undefined; policy: GeoPolicy } {
    const policy = this.getPolicyFor(role, emailVerified);
    const coarseCoords = this.toCoarseCoords(coords, policy.decimals);
    const fullHash = coords.geohash || geohashForLocation([coords.latitude, coords.longitude]);
    const geohash = this.toCoarseGeohash(fullHash, policy.geohashLen);
    return { coords: coarseCoords, geohash, policy };
  }

  // =============================================================
  // LEGACY / COMPATIBILIDADE (PROMISE)
  // =============================================================

  /**
   * @deprecated Prefira `currentPosition$().pipe(take(1))`.
   * Mantida para compatibilidade com código existente.
   */
  getCurrentLocation(options?: GeolocationOptions): Promise<GeoCoordinates> {
    return firstValueFrom(this.currentPosition$(options));
  }
}
