// src/app/core/services/interactions/friendship/repo/base.repo.ts
// Não esquecer os comentários explicativos.
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Observable, defer, from, isObservable } from 'rxjs';

export abstract class FirestoreRepoBase {
  constructor(
    protected db: Firestore,
    private env: EnvironmentInjector,
  ) { }

  // Overloads para melhor inferência
  protected inCtx$<T>(work: () => Promise<T> | T): Observable<T>;
  protected inCtx$<T>(work: () => Observable<T>): Observable<T>;
  protected inCtx$<T>(work: () => Promise<T> | T | Observable<T>): Observable<T> {
    return defer(() =>
      runInInjectionContext(this.env, () => {
        const r = work();
        // Se já for Observable, usa direto; caso contrário, empacota em Promise e converte
        return (isObservable(r) ? r as Observable<T> : from(Promise.resolve(r as T)));
      })
    );
  }

  protected inCtxSync<T>(work: () => T): T {
    return runInInjectionContext(this.env, () => work());
  }
}
