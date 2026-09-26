import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, shareReplay } from 'rxjs/operators';

/**
 * Estado efêmero do viewer.
 *
 * Guarda somente o índice selecionado. A coleção de fotos e, principalmente,
 * as URLs temporárias permanecem no fluxo Observable da superfície que as
 * carregou; não entram em NgRx nem em qualquer cache persistente.
 */
@Injectable()
export class PublicPhotoViewerStateService {
  private readonly selectedIndexSubject =
    new BehaviorSubject<number | null>(null);

  readonly selectedIndex$: Observable<number | null> =
    this.selectedIndexSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  open(index: number, itemCount: number): void {
    const safeCount = this.normalizeCount(itemCount);
    const safeIndex = Math.trunc(Number(index));

    if (
      safeCount === 0 ||
      !Number.isFinite(safeIndex) ||
      safeIndex < 0 ||
      safeIndex >= safeCount
    ) {
      return;
    }

    this.selectedIndexSubject.next(safeIndex);
  }

  close(): void {
    this.selectedIndexSubject.next(null);
  }

  previous(itemCount: number): void {
    const current = this.selectedIndexSubject.value;
    const safeCount = this.normalizeCount(itemCount);

    if (current === null || safeCount === 0 || current <= 0) {
      return;
    }

    this.selectedIndexSubject.next(current - 1);
  }

  next(itemCount: number): void {
    const current = this.selectedIndexSubject.value;
    const safeCount = this.normalizeCount(itemCount);

    if (
      current === null ||
      safeCount === 0 ||
      current >= safeCount - 1
    ) {
      return;
    }

    this.selectedIndexSubject.next(current + 1);
  }

  reconcile(itemCount: number): void {
    const current = this.selectedIndexSubject.value;
    const safeCount = this.normalizeCount(itemCount);

    if (current === null) {
      return;
    }

    if (safeCount === 0) {
      this.close();
      return;
    }

    if (current >= safeCount) {
      this.selectedIndexSubject.next(safeCount - 1);
    }
  }

  private normalizeCount(value: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : 0;
  }
}
