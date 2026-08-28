// src/app/core/services/geolocation/location-persistence.service.ts
// Serviço para persistir localização do usuário no Firestore
// Não esquecer os comentários

import { Injectable } from '@angular/core';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GeoCoordinates } from '../../interfaces/geolocation.interface';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class LocationPersistenceService {
  constructor(
    private readonly fs: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalError: GlobalErrorHandlerService
  ) { }

  /**
   * Versão reativa (padrão do projeto):
   * - Tudo roda dentro do Injection Context
   * - Erro é roteado para o handler global
   * - Não quebra o app (best-effort) — retorna void 0
   */
  saveUserLocation$(
    uid: string,
    coords: GeoCoordinates,
    geohash?: string
  ): Observable<void> {
    const userId = (uid ?? '').trim();
    if (!userId) return of(void 0);

    const ref = this.ctx.run(() => doc(this.fs, 'users', userId));

    return this.ctx.deferPromise$(() =>
      setDoc(
        ref,
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          geohash: geohash ?? coords.geohash ?? null,
          locationUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        // Centraliza observabilidade; não gera toast aqui (stream/rotina)
        try {
          const e = new Error('[LocationPersistenceService] saveUserLocation falhou (ignorado).');
          (e as any).original = err;
          (e as any).meta = { uid: userId };
          this.globalError.handleError(e);
        } catch { }
        return of(void 0);
      })
    );
  }

  /**
   * Mantém assinatura Promise para compatibilidade onde você já usa await.
   * Internamente segue o padrão Observable.
   */
  saveUserLocation(uid: string, coords: GeoCoordinates, geohash?: string): Promise<void> {
    return firstValueFrom(this.saveUserLocation$(uid, coords, geohash));
  }
}
