// src/app/core/services/preferences/user-preferences.service.ts
// =============================================================================
// USER PREFERENCES SERVICE (SWR)
// ----------------------------------------------------------------------------
// Padrão “grandes plataformas” aplicado:
//
// 1) API Observable-first.
// 2) Leitura em camadas:
//    - Store (NgRx)
//    - Cache (com TTL)
//    - Firestore
// 3) Stale-While-Revalidate (SWR):
//    - Se houver cache STALE, retorna imediatamente (UX rápida)
//    - Em paralelo, revalida no Firestore e atualiza Store/Cache quando chegar
// 4) Coalescência de leituras em voo por UID:
//    - Evita múltiplos getDocs concorrentes para o mesmo uid
// 5) Sanitização forte do patch (allowlist + normalização).
// 6) AngularFire function-based APIs sempre dentro do Injection Context
//    via FirestoreContextService.
// 7) Erros centralizados:
//    - GlobalErrorHandlerService: log/telemetria
//    - ErrorNotificationService: feedback (somente quando apropriado)
//
// Cache TTL:
// - preferences:{uid}      -> payload IUserPreferences
// - preferences:{uid}:meta -> { cachedAt: number }
// =============================================================================

import { Injectable } from '@angular/core';
import {
  type Firestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from '@angular/fire/firestore';

import { Observable, combineLatest, concat, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { IUserPreferences } from '../../interfaces/interfaces-user-dados/iuser-preferences';
import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { CacheService } from '../general/cache/cache.service';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

import {
  loadUserPreferencesSuccess,
  updateUserPreferences,
} from '../../../store/actions/actions.user/user-preferences.actions';

import { selectUserPreferences } from '../../../store/selectors/selectors.user/user-preferences.selectors';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';

type CacheMeta = { cachedAt: number };

type CacheState<T> =
  | { kind: 'miss' }
  | { kind: 'fresh'; value: T }
  | { kind: 'stale'; value: T };

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly db: Firestore;

  /**
   * TTL do cache local de preferências.
   * Ajuste conforme seu produto:
   * - Preferências mudam pouco -> TTL maior
   * - Se quiser refletir mudanças quase imediatas -> TTL menor
   */
  private readonly cacheTtlMs = 10 * 60 * 1000; // 10 minutos

  /**
   * Allowlist: impede “docs extras” contaminarem o objeto tipado.
   */
  private readonly allowedKeys: Array<keyof IUserPreferences> = [
    'genero',
    'praticaSexual',
    'preferenciaFisica',
    'relacionamento',
  ];

  /**
   * Coalescência: 1 leitura Firestore por uid (compartilhada).
   */
  private readonly inFlightReads = new Map<string, Observable<IUserPreferences>>();

  constructor(
    private readonly firestoreService: FirestoreService,
    private readonly cacheService: CacheService,
    private readonly store: Store<AppState>,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService,
    private readonly firestoreCtx: FirestoreContextService,
  ) {
    this.db = this.firestoreService.getFirestoreInstance();
  }

  // =============================================================================
  // API PÚBLICA
  // =============================================================================

  /**
   * Salva as preferências do usuário, atualizando Store + Cache.
   * - Batch: grava apenas as categorias presentes no patch.
   * - Cache recebe MERGE determinístico para não perder outras categorias.
   */
  saveUserPreferences$(uid: string, preferences: Partial<IUserPreferences>): Observable<void> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) {
      return throwError(() => new Error('[UserPreferencesService] UID inválido.'));
    }

    const patch = this.sanitizePatch(preferences);

    // No-op: evita batch vazio.
    if (this.isEmptyPatch(patch)) {
      return of(void 0);
    }

    return this.store.select(selectUserPreferences(safeUid)).pipe(
      take(1),

      switchMap((stored) =>
        this.saveUserPreferencesInternal$(safeUid, patch).pipe(
          tap(() => {
            // 1) Store (patch)
            this.store.dispatch(updateUserPreferences({ uid: safeUid, preferences: patch }));

            // 2) Cache (merge seguro)
            const merged = this.mergePreferences(stored ?? this.defaultPreferences(), patch);
            this.setCache(safeUid, merged);
          })
        )
      ),

      catchError((err) => {
        this.routeError(err, 'saveUserPreferences$', 'Erro ao salvar preferências. Tente novamente mais tarde.');
        return throwError(() => err);
      })
    );
  }

  /**
   * Obtém preferências com SWR:
   * 1) Store
   * 2) Cache (fresh -> retorna)
   * 3) Cache (stale -> retorna e revalida no Firestore)
   * 4) Firestore (se miss -> busca e retorna)
   */
  getUserPreferences$(uid: string): Observable<IUserPreferences> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) {
      return throwError(() => new Error('[UserPreferencesService] UID inválido.'));
    }

    return this.store.select(selectUserPreferences(safeUid)).pipe(
      distinctUntilChanged(),

      switchMap((storedPreferences) => {
        // 1) Store
        if (storedPreferences) return of(storedPreferences);

        // 2) Cache (com estado: miss/fresh/stale)
        return this.getCacheState$(safeUid).pipe(
          switchMap((state) => {
            if (state.kind === 'fresh') {
              // Mantém Store coerente com cache fresh
              this.store.dispatch(loadUserPreferencesSuccess({ uid: safeUid, preferences: state.value }));
              return of(state.value);
            }

            if (state.kind === 'stale') {
              // SWR:
              // - Emite imediatamente o cache (para UX rápida)
              // - Revalida em background e emite novamente se vier algo (store/cache atualizados)
              const cached$ = of(state.value).pipe(
                tap((pref) => this.store.dispatch(loadUserPreferencesSuccess({ uid: safeUid, preferences: pref })))
              );

              const refresh$ = this.getOrCreateFirestoreRead$(safeUid, {
                // refresh em background: loga, mas evita toast agressivo se falhar
                notifyOnError: false,
              });

              return concat(cached$, refresh$).pipe(
                // Evita “piscar” se o refresh retornar igual ao cache
                distinctUntilChanged((a, b) => this.deepEqual(a, b))
              );
            }

            // MISS: só Firestore
            return this.getOrCreateFirestoreRead$(safeUid, {
              // aqui faz sentido notificar, porque a UI não tem fallback
              notifyOnError: true,
              userMessage: 'Erro ao carregar preferências do usuário.',
            });
          })
        );
      }),

      catchError((err) => {
        // fallback final
        this.routeError(err, 'getUserPreferences$', 'Erro ao carregar preferências do usuário.');
        return throwError(() => err);
      }),

      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Preferências por token (pré-cadastro).
   * - Retorna null se não existir ou se falhar (sem quebrar UI).
   */
  getUserPreferencesByToken$(token: string): Observable<any | null> {
    const safeToken = (token ?? '').trim();
    if (!safeToken) return of(null);

    return this.firestoreCtx.deferPromise$(() => {
      const preRegisterCollection = collection(this.db, 'preRegisterPreferences');
      const preRegisterQuery = query(preRegisterCollection, where('token', '==', safeToken));
      return getDocs(preRegisterQuery);
    }).pipe(
      map((snap) => (snap.empty ? null : snap.docs[0].data())),
      catchError((err) => {
        this.routeError(err, 'getUserPreferencesByToken$', 'Erro ao buscar preferências pelo token.');
        return of(null);
      })
    );
  }

  // =============================================================================
  // FIRESTORE (internos)
  // =============================================================================

  private saveUserPreferencesInternal$(uid: string, preferences: Partial<IUserPreferences>): Observable<void> {
    return this.firestoreCtx.deferPromise$(() => {
      const userRef = doc(this.db, `users/${uid}`);
      const preferencesCollection = collection(userRef, 'preferences');

      const batch = writeBatch(this.db);

      for (const key of this.allowedKeys) {
        if (!(key in preferences)) continue;
        const values = preferences[key] ?? [];
        const prefDocRef = doc(preferencesCollection, String(key));
        batch.set(prefDocRef, { value: values }, { merge: true });
      }

      return batch.commit();
    }).pipe(map(() => void 0));
  }

  private getUserPreferencesInternal$(uid: string): Observable<IUserPreferences> {
    return this.firestoreCtx.deferPromise$(() => {
      const preferencesCollectionRef = collection(this.db, `users/${uid}/preferences`);
      return getDocs(preferencesCollectionRef);
    }).pipe(
      map((querySnapshot) => {
        const preferences = this.defaultPreferences();

        querySnapshot.forEach((prefDoc) => {
          const key = prefDoc.id as keyof IUserPreferences;
          if (!this.allowedKeys.includes(key)) return;

          const data = prefDoc.data() as any;
          preferences[key] = this.normalizeStringArray(data?.value);
        });

        return preferences;
      })
    );
  }

  /**
   * Coalescência + atualização de Store/Cache.
   * - Se já existe read em voo, reaproveita.
   * - Sempre que obtém sucesso, grava Store+Cache.
   */
  private getOrCreateFirestoreRead$(
    uid: string,
    opts: { notifyOnError: boolean; userMessage?: string }
  ): Observable<IUserPreferences> {
    const inFlight = this.inFlightReads.get(uid);
    if (inFlight) return inFlight;

    const read$ = this.getUserPreferencesInternal$(uid).pipe(
      tap((pref) => {
        this.setCache(uid, pref);
        this.store.dispatch(loadUserPreferencesSuccess({ uid, preferences: pref }));
      }),
      catchError((err) => {
        this.routeError(
          err,
          'getUserPreferencesInternal$',
          opts.notifyOnError ? (opts.userMessage ?? 'Erro ao carregar preferências do usuário.') : undefined
        );
        return throwError(() => err);
      }),
      finalize(() => this.inFlightReads.delete(uid)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inFlightReads.set(uid, read$);
    return read$;
  }

  // =============================================================================
  // CACHE (com TTL + estado)
  // =============================================================================

  private cacheKey(uid: string): string {
    return `preferences:${uid}`;
  }

  private cacheMetaKey(uid: string): string {
    return `preferences:${uid}:meta`;
  }

  /**
   * Retorna o estado do cache:
   * - miss: não tem payload
   * - fresh: payload existe e TTL ok
   * - stale: payload existe mas TTL expirou (bom p/ SWR)
   */
  private getCacheState$(uid: string): Observable<CacheState<IUserPreferences>> {
    const key = this.cacheKey(uid);
    const metaKey = this.cacheMetaKey(uid);

    return combineLatest([
      this.cacheService.get<IUserPreferences>(key).pipe(take(1)),
      this.cacheService.get<CacheMeta>(metaKey).pipe(take(1)),
    ]).pipe(
      map(([pref, meta]) => {
        if (!pref) return { kind: 'miss' } as const;

        const cachedAt = meta?.cachedAt;
        const fresh = this.isCacheFresh(cachedAt);

        return fresh
          ? ({ kind: 'fresh', value: pref } as const)
          : ({ kind: 'stale', value: pref } as const);
      })
    );
  }

  private setCache(uid: string, pref: IUserPreferences): void {
    // payload (persistente por padrão no seu CacheService)
    this.cacheService.set(this.cacheKey(uid), pref);
    // meta TTL
    this.cacheService.set(this.cacheMetaKey(uid), { cachedAt: Date.now() } as CacheMeta);
  }

  private isCacheFresh(cachedAt: unknown): boolean {
    if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return false;
    return Date.now() - cachedAt <= this.cacheTtlMs;
  }

  // =============================================================================
  // HELPERS (default/sanitize/merge/error)
  // =============================================================================

  private defaultPreferences(): IUserPreferences {
    return {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: [],
    };
  }

  private sanitizePatch(patch: Partial<IUserPreferences>): Partial<IUserPreferences> {
    const out: Partial<IUserPreferences> = {};

    for (const key of this.allowedKeys) {
      if (!(key in (patch ?? {}))) continue;
      const v = (patch as any)?.[key];
      out[key] = this.normalizeStringArray(v);
    }

    return out;
  }

  private isEmptyPatch(patch: Partial<IUserPreferences>): boolean {
    return !patch || Object.keys(patch).length === 0;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    const cleaned = value
      .filter((x) => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);

    // Dedup determinístico
    return Array.from(new Set(cleaned));
  }

  private mergePreferences(base: IUserPreferences, patch: Partial<IUserPreferences>): IUserPreferences {
    return {
      genero: patch['genero'] ?? base['genero'] ?? [],
      praticaSexual: patch['praticaSexual'] ?? base['praticaSexual'] ?? [],
      preferenciaFisica: patch['preferenciaFisica'] ?? base['preferenciaFisica'] ?? [],
      relacionamento: patch['relacionamento'] ?? base['relacionamento'] ?? [],
    };
  }

  /**
   * Igualdade simples (suficiente para payloads plain/pequenos).
   * Evita dupla emissão no SWR quando refresh não muda nada.
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private routeError(err: unknown, context: string, userMessage?: string): void {
    const e = err instanceof Error ? err : new Error(`[UserPreferencesService] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;
    (e as any).feature = 'user-preferences';

    this.errorHandler.handleError(e);

    if (userMessage) {
      this.notifier.showError(userMessage);
    }
  }
}  // Linha 452
