// src/app/core/services/action-state/action-registry.service.ts
// -----------------------------------------------------------------------------
// ACTION REGISTRY SERVICE
// -----------------------------------------------------------------------------
// Registro reativo de operações assíncronas por chave. Permite que serviços de
// domínio exponham progresso sem acoplar componentes a Promises ou callbacks.
// -----------------------------------------------------------------------------
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, defer } from 'rxjs';
import { distinctUntilChanged, finalize, map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ActionRegistryService {
  private readonly pendingCounts = new Map<string, number>();
  private readonly pendingKeysSubject =
    new BehaviorSubject<ReadonlySet<string>>(new Set());

  readonly pendingKeys$ = this.pendingKeysSubject.asObservable();

  isPending$(key: string): Observable<boolean> {
    const normalizedKey = this.normalizeKey(key);

    return this.pendingKeys$.pipe(
      map((keys) => !!normalizedKey && keys.has(normalizedKey)),
      distinctUntilChanged()
    );
  }

  isPendingSnapshot(key: string): boolean {
    const normalizedKey = this.normalizeKey(key);
    return !!normalizedKey && this.pendingCounts.has(normalizedKey);
  }

  track$<T>(
    key: string,
    sourceFactory: () => Observable<T>
  ): Observable<T> {
    const normalizedKey = this.requireKey(key);

    return defer(() => {
      this.begin(normalizedKey);

      return sourceFactory().pipe(
        finalize(() => this.end(normalizedKey))
      );
    });
  }

  private begin(key: string): void {
    this.pendingCounts.set(key, (this.pendingCounts.get(key) ?? 0) + 1);
    this.emit();
  }

  private end(key: string): void {
    const current = this.pendingCounts.get(key) ?? 0;

    if (current <= 1) {
      this.pendingCounts.delete(key);
    } else {
      this.pendingCounts.set(key, current - 1);
    }

    this.emit();
  }

  private emit(): void {
    this.pendingKeysSubject.next(new Set(this.pendingCounts.keys()));
  }

  private requireKey(value: unknown): string {
    const key = this.normalizeKey(value);
    if (!key) throw new Error('Chave de ação inválida.');
    return key;
  }

  private normalizeKey(value: unknown): string {
    return String(value ?? '').trim().slice(0, 240);
  }
}
