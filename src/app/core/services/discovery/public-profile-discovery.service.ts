// src/app/core/services/discovery/public-profile-discovery.service.ts

import { Injectable, inject } from '@angular/core';

import {
  Firestore,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';

import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { IUserDados } from '../../interfaces/iuser-dados';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

export interface PublicProfileDiscoveryOptions {
  limit?: number;
}

/**
 * Lê perfis públicos para modos de descoberta como:
 * - Todos
 * - Perto de mim
 * - Novos
 * - Destaques
 *
 * Este service NÃO deve ler users/{uid}.
 * A fonte pública de discovery é public_profiles/{uid}.
 */
@Injectable({ providedIn: 'root' })
export class PublicProfileDiscoveryService {
  private readonly firestore = inject(Firestore);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  listDiscoverableProfiles$(
    options: PublicProfileDiscoveryOptions = {}
  ): Observable<IUserDados[]> {
    const safeLimit = Math.min(Math.max(options.limit ?? 80, 1), 120);

    const ref = collection(this.firestore, 'public_profiles');

    const q = query(
      ref,
      orderBy('updatedAt', 'desc'),
      limit(safeLimit)
    );

    return collectionData(q, { idField: 'uid' }).pipe(
      map((docs) =>
        docs
          .map((raw) => this.toUserDadosFromPublicProfile(raw))
          .filter((profile) => this.isDiscoverablePublicProfile(profile))
      ),
      catchError((err) => {
        this.reportSilentError(
          'PublicProfileDiscoveryService.listDiscoverableProfiles$',
          err
        );

        return of([] as IUserDados[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private toUserDadosFromPublicProfile(raw: any): IUserDados {
    const uid = String(raw?.uid ?? '').trim();

    return {
      uid,

      nickname: raw?.nickname ?? null,
      nicknameNormalized: raw?.nicknameNormalized ?? null,

      photoURL: raw?.photoURL ?? raw?.avatarUrl ?? null,

      role: raw?.role ?? 'free',
      gender: raw?.gender ?? null,
      orientation: raw?.orientation ?? null,

      municipio: raw?.municipio ?? null,
      estado: raw?.estado ?? null,

      latitude: raw?.latitude ?? null,
      longitude: raw?.longitude ?? null,
      geohash: raw?.geohash ?? null,

      isOnline: raw?.isOnline ?? false,
      lastSeen: raw?.lastSeen ?? null,
      lastOnlineAt: raw?.lastOnlineAt ?? null,
      lastOfflineAt: raw?.lastOfflineAt ?? null,
    } as unknown as IUserDados;
  }

  private isDiscoverablePublicProfile(profile: IUserDados): boolean {
    const anyProfile = profile as any;

    if (!profile?.uid) return false;
    if (anyProfile?.hideFromDiscovery === true) return false;
    if (anyProfile?.hideFromOnline === true) return false;

    const hasIdentity =
      typeof anyProfile.nickname === 'string' &&
      anyProfile.nickname.trim() !== '';

    const hasBasics =
      typeof anyProfile.gender === 'string' &&
      anyProfile.gender.trim() !== '' &&
      typeof anyProfile.estado === 'string' &&
      anyProfile.estado.trim() !== '' &&
      typeof anyProfile.municipio === 'string' &&
      anyProfile.municipio.trim() !== '';

    const hasLocation =
      Number.isFinite(Number(anyProfile.latitude)) &&
      Number.isFinite(Number(anyProfile.longitude));

    return hasIdentity && hasBasics && hasLocation;
  }

  private reportSilentError(context: string, err: unknown): void {
    try {
      const e = err instanceof Error ? err : new Error(context);

      (e as any).context = context;
      (e as any).original = err;
      (e as any).skipUserNotification = true;
      (e as any).silent = true;

      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }
}