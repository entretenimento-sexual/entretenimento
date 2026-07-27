// src/app/core/services/discovery/public-profile-discovery.service.ts
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import type { IUserDados } from '../../interfaces/iuser-dados';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

export interface PublicProfileDiscoveryOptions { limit?: number; }

@Injectable({ providedIn: 'root' })
export class PublicProfileDiscoveryService {
  private readonly firestore = inject(Firestore);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  listDiscoverableProfiles$(options: PublicProfileDiscoveryOptions = {}): Observable<IUserDados[]> {
    const safeLimit = Math.min(Math.max(options.limit ?? 80, 1), 120);
    const q = query(
      collection(this.firestore, 'public_profiles'),
      orderBy('updatedAt', 'desc'),
      limit(safeLimit)
    );

    return collectionData(q, { idField: 'uid' }).pipe(
      map((docs) => docs
        .map((raw) => this.toUserDadosFromPublicProfile(raw))
        .filter((profile) => this.isDiscoverablePublicProfile(profile))),
      catchError((err) => {
        this.reportSilentError('PublicProfileDiscoveryService.listDiscoverableProfiles$', err);
        return of([] as IUserDados[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getPublicProfileByUid$(uid: string | null | undefined): Observable<IUserDados | null> {
    const safeUid = String(uid ?? '').trim();
    if (!safeUid) return of(null);

    return docData(doc(this.firestore, `public_profiles/${safeUid}`), { idField: 'uid' }).pipe(
      map((raw) => raw ? this.toUserDadosFromPublicProfile(raw) : null),
      catchError((err) => {
        this.reportSilentError('PublicProfileDiscoveryService.getPublicProfileByUid$', err);
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private toUserDadosFromPublicProfile(raw: Record<string, unknown>): IUserDados {
    return {
      ...(raw as unknown as IUserDados),
      uid: String(raw['uid'] ?? '').trim(),
      nickname: this.text(raw['nickname']),
      nicknameNormalized: this.text(raw['nicknameNormalized']),
      photoURL: this.text(raw['photoURL'] ?? raw['avatarUrl']),
      role: (this.text(raw['role']) ?? 'free') as IUserDados['role'],
      gender: this.text(raw['gender']) ?? undefined,
      orientation: this.text(raw['orientation']) ?? undefined,
      age: this.number(raw['age']),
      normalizedGender: this.text(raw['normalizedGender']),
      normalizedOrientation: this.text(raw['normalizedOrientation']),
      compatibilityReady: this.boolean(raw['compatibilityReady']),
      interestedInGenders: this.stringArray(raw['interestedInGenders']),
      interestedInOrientations: this.stringArray(raw['interestedInOrientations']),
      publicRelationshipIntents: this.stringArray(raw['publicRelationshipIntents']),
      publicSexualPractices: this.stringArray(raw['publicSexualPractices']),
      publicBodyTraits: this.stringArray(raw['publicBodyTraits']),
      preferenceBadgesVisible: this.boolean(raw['preferenceBadgesVisible']),
      publicPreferencesUpdatedAt: this.number(raw['publicPreferencesUpdatedAt']),
      municipio: this.text(raw['municipio']) ?? undefined,
      estado: this.text(raw['estado']) ?? undefined,
      latitude: this.number(raw['latitude']) ?? undefined,
      longitude: this.number(raw['longitude']) ?? undefined,
      geohash: this.text(raw['geohash']) ?? undefined,
      isOnline: raw['isOnline'] === true,
      lastSeen: this.number(raw['lastSeen']),
      lastOnlineAt: this.number(raw['lastOnlineAt']),
      lastOfflineAt: this.number(raw['lastOfflineAt']),
    } as IUserDados;
  }

  private isDiscoverablePublicProfile(profile: IUserDados): boolean {
    const source = profile as IUserDados & Record<string, unknown>;
    if (!profile?.uid || source['hideFromDiscovery'] === true || source['hideFromOnline'] === true) return false;
    return !!this.text(profile.nickname)
      && !!this.text(profile.gender)
      && !!this.text(profile.estado)
      && !!this.text(profile.municipio);
  }

  private text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private boolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private stringArray(value: unknown): readonly string[] | null {
    if (!Array.isArray(value)) return null;
    const values = value.filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim()).filter(Boolean);
    return values.length ? Array.from(new Set(values)) : null;
  }

  private reportSilentError(context: string, err: unknown): void {
    try {
      const error = err instanceof Error ? err : new Error(context);
      (error as Error & { context?: string }).context = context;
      (error as Error & { original?: unknown }).original = err;
      (error as Error & { skipUserNotification?: boolean }).skipUserNotification = true;
      (error as Error & { silent?: boolean }).silent = true;
      this.globalErrorHandler.handleError(error);
    } catch {
      // Telemetria não bloqueia a lista.
    }
  }
}
