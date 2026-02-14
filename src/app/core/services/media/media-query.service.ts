// src/app/core/services/media/media-query.service.ts
// Query do domínio Media (fotos/vídeos).
// MVP: store in-memory (BehaviorSubject) com seed seguro e assinaturas estáveis
// para depois plugar Firestore/Storage sem quebrar componentes.

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import type { IPhotoItem } from 'src/app/core/interfaces/media/i-photo-item';

@Injectable({ providedIn: 'root' })
export class MediaQueryService {
  private readonly cache = new Map<string, Observable<IPhotoItem[]>>();
  private readonly store = new Map<string, BehaviorSubject<IPhotoItem[]>>();

  constructor(private readonly errorNotifier: ErrorNotificationService) { }

  /**
   * Lista fotos do perfil (API estável).
   * MVP: delega para watchProfilePhotos$ e cacheia.
   * Futuro: Firestore (collection) + paginação + filtros (visibilidade, idade, etc).
   */
  getProfilePhotos$(ownerUid: string): Observable<IPhotoItem[]> {
    if (!ownerUid) return of([]);

    const key = `profilePhotos:${ownerUid}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const stream$ = this.watchProfilePhotos$(ownerUid).pipe(
      map((items) => items ?? []),
      catchError((err) => {
        this.errorNotifier.showError(err);
        return of([] as IPhotoItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.cache.set(key, stream$);
    return stream$;
  }

  /**
   * Limpa cache + reseta store (no MVP isso “simula” reload).
   * No futuro: isso dispara uma nova query Firestore.
   */
  invalidateProfilePhotos(ownerUid: string): void {
    if (!ownerUid) return;

    this.cache.delete(`profilePhotos:${ownerUid}`);

    const subj = this.store.get(ownerUid);
    if (subj) {
      subj.next([]);           // evita estado “fantasma”
      this.ensureSeed(ownerUid);
    }
  }

  /**
   * Stream “ao vivo” das fotos do perfil (recomendado para UI).
   */
  watchProfilePhotos$(ownerUid: string): Observable<IPhotoItem[]> {
    if (!ownerUid) return of([]);

    const subj = this.getOrCreate(ownerUid);
    this.ensureSeed(ownerUid);

    return subj.asObservable().pipe(
      // comparador simples (barato) para evitar rerender trivial
      distinctUntilChanged((a, b) => a.length === b.length && a[0]?.id === b[0]?.id)
    );
  }

  /** Snapshot interno (usado pelo command). */
  getProfilePhotosSnapshot(ownerUid: string): IPhotoItem[] {
    return this.getOrCreate(ownerUid).value;
  }

  /** Append (usado pelo command). */
  appendProfilePhoto(ownerUid: string, item: IPhotoItem): void {
    const subj = this.getOrCreate(ownerUid);
    subj.next([item, ...subj.value]);
  }

  /** Remove (usado pelo command). */
  removeProfilePhoto(ownerUid: string, photoId: string): void {
    const subj = this.getOrCreate(ownerUid);
    subj.next(subj.value.filter((p) => p.id !== photoId));
  }

  private getOrCreate(ownerUid: string): BehaviorSubject<IPhotoItem[]> {
    const existing = this.store.get(ownerUid);
    if (existing) return existing;

    const created = new BehaviorSubject<IPhotoItem[]>([]);
    this.store.set(ownerUid, created);
    return created;
  }

  /**
   * Seed MVP (para não ficar vazio no começo).
   * Importante: aqui é “safe default” (não vaza foto real).
   */
  private ensureSeed(ownerUid: string): void {
    const subj = this.getOrCreate(ownerUid);
    if (subj.value.length > 0) return;

    const base: IPhotoItem[] = Array.from({ length: 4 }).map((_, i) => ({
      id: `seed_${ownerUid}_${i + 1}`,
      ownerUid,
      url: 'assets/imagem-padrao.webp',
      alt: `Foto ${i + 1}`,
      createdAt: Date.now() - i * 1000,
    }));

    subj.next(base);
  }
}
