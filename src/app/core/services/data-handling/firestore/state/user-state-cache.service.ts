// src/app/core/services/data-handling/firestore/state/user-state-cache.service.ts
// Ponte temporária entre perfis por UID em memória e o Store de domínio.
//
// Regras arquiteturais:
// - AuthSessionService continua sendo a fonte canônica do UID de sessão;
// - CurrentUserStoreService continua sendo a fonte runtime do usuário atual;
// - NgRx continua sendo o estado compartilhado de domínio;
// - este serviço apenas reduz leituras/dispatches redundantes de perfis por UID.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDA a dependência de CacheService e das chaves cruas `user:{uid}`.
//   Motivo: perfis completos são dados restricted e não devem alcançar
//   IndexedDB ou localStorage por meio de compatibilidade legada.
// - SUPRIMIDA qualquer reidratação persistente do perfil por UID.
//   Motivo: Firestore/Store permanecem autoritativos após reload.
// - SUPRIMIDOS console.debug e logs contendo UID em claro.
//   Motivo: debug segue PrivacyDebugLoggerService com metadados mínimos.
//
// APIs públicas preservadas:
// - getCachedUser$()
// - getCachedUserSnapshot()
// - upsertUser()
// - invalidate()
// - updateUserInStateAndCache()
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { IUserRegistrationData } from '@core/interfaces/iuser-registration-data';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from '@core/services/general/cache/app-cache.service';
import { CacheDefinition } from '@core/services/general/cache/cache-contracts';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { AppState } from 'src/app/store/states/app.state';
import {
  addUserToState,
  updateUserInState,
} from 'src/app/store/actions/actions.user/user.actions';
import { sanitizeUserForStore } from 'src/app/store/utils/user-store.serializer';

@Injectable({ providedIn: 'root' })
export class UserStateCacheService {
  private readonly defaultTtlMs = 300_000;

  constructor(
    private readonly cache: AppCacheService,
    private readonly store: Store<AppState>,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  getCachedUser$(
    uid: string
  ): Observable<IUserDados | null | undefined> {
    const id = this.normalizeUid(uid);
    if (!id) return of(undefined);

    return this.cache.get$(this.definition(id)).pipe(
      map((result) =>
        result.status === 'miss' ? undefined : result.value
      ),
      catchError((error) => {
        this.report(error, 'getCachedUser$');
        return of(undefined);
      })
    );
  }

  /** Snapshot síncrono exclusivamente da memória tipada. */
  getCachedUserSnapshot(
    uid: string
  ): IUserDados | null | undefined {
    const id = this.normalizeUid(uid);
    if (!id) return undefined;

    try {
      const result = this.cache.peek(this.definition(id));
      return result.status === 'miss' ? undefined : result.value;
    } catch (error) {
      this.report(error, 'getCachedUserSnapshot');
      return undefined;
    }
  }

  upsertUser(user: IUserDados, ttlMs = this.defaultTtlMs): void {
    if (!user?.uid) return;

    try {
      const safeUser = sanitizeUserForStore(user);
      const current = this.getCachedUserSnapshot(safeUser.uid);

      if (!this.hasMeaningfulChanges(current, safeUser)) {
        this.debug('upsert ignorado', { reason: 'unchanged' });
        return;
      }

      if (current === undefined || current === null) {
        this.store.dispatch(addUserToState({ user: safeUser }));
        this.debug('perfil adicionado ao Store');
      } else {
        this.store.dispatch(
          updateUserInState({
            uid: safeUser.uid,
            updatedData: safeUser,
          })
        );
        this.debug('perfil atualizado no Store');
      }

      this.writeMemoryBestEffort(
        safeUser.uid,
        safeUser,
        ttlMs,
        'upsertUser'
      );
    } catch (error) {
      this.report(error, 'upsertUser', {
        hasUser: !!user,
      });
    }
  }

  /** Invalida somente o perfil do UID informado. */
  invalidate(uid: string): void {
    const id = this.normalizeUid(uid);
    if (!id) return;

    this.cache
      .invalidate$(this.definition(id))
      .pipe(take(1))
      .subscribe({
        next: () => this.debug('perfil invalidado'),
        error: (error) => this.report(error, 'invalidate'),
      });
  }

  /**
   * Atualiza Store e cache de memória com patch parcial.
   * O payload mesclado é sanitizado antes do dispatch para manter o Store
   * serializável e coerente com as demais entradas de usuário.
   */
  updateUserInStateAndCache<
    T extends IUserRegistrationData | IUserDados
  >(uid: string, updatedData: T): void {
    const id = this.normalizeUid(uid);
    if (!id || !updatedData || typeof updatedData !== 'object') return;

    try {
      const existing = this.getCachedUserSnapshot(id) as
        | T
        | null
        | undefined;

      if (!this.hasPatchChanges(existing, updatedData)) {
        this.debug('patch ignorado', { reason: 'unchanged' });
        return;
      }

      const mergedValue = sanitizeUserForStore({
        ...(existing ?? {}),
        ...updatedData,
        uid: id,
      } as unknown as IUserDados);

      this.store.dispatch(
        updateUserInState({
          uid: id,
          updatedData: mergedValue,
        })
      );

      this.writeMemoryBestEffort(
        id,
        mergedValue,
        this.defaultTtlMs,
        'updateUserInStateAndCache'
      );

      this.debug('patch aplicado', {
        updatedKeyCount: Object.keys(updatedData).length,
      });
    } catch (error) {
      this.report(error, 'updateUserInStateAndCache', {
        updatedKeyCount: Object.keys(updatedData ?? {}).length,
      });
    }
  }

  private definition(
    uid: string,
    ttlMs = this.defaultTtlMs
  ): CacheDefinition<IUserDados | null> {
    return {
      key: 'profile-state',
      scope: 'user',
      ownerUid: uid,
      sensitivity: 'restricted',
      storage: 'memory',
      ttlMs: this.normalizeTtl(ttlMs),
      version: 1,
      validate: (
        value: unknown
      ): value is IUserDados | null =>
        value === null || this.isValidUser(value),
    };
  }

  private writeMemoryBestEffort(
    uid: string,
    user: IUserDados,
    ttlMs: number,
    operation: string
  ): void {
    this.cache
      .set$(this.definition(uid, ttlMs), user)
      .pipe(take(1))
      .subscribe({
        error: (error) => this.report(error, operation),
      });
  }

  private normalizeUid(uid: string): string {
    return String(uid ?? '').trim();
  }

  private normalizeTtl(ttlMs: number): number {
    const value = Number(ttlMs);
    return Number.isFinite(value)
      ? Math.max(0, value)
      : this.defaultTtlMs;
  }

  private isValidUser(value: unknown): value is IUserDados {
    if (!value || typeof value !== 'object') return false;

    const record = value as Record<string, unknown>;
    return (
      typeof record['uid'] === 'string' &&
      record['uid'].trim().length > 0
    );
  }

  private hasMeaningfulChanges(
    current: IUserDados | null | undefined,
    incoming: IUserDados
  ): boolean {
    if (!current) return true;

    return !this.areDeepEqual(current, incoming);
  }

  private hasPatchChanges<T extends object>(
    existing: T | null | undefined,
    patch: Partial<T>
  ): boolean {
    if (!existing) return true;

    const keys = Object.keys(patch ?? {}) as Array<keyof T>;
    if (!keys.length) return false;

    return keys.some((key) =>
      !this.areDeepEqual(existing[key], patch[key])
    );
  }

  private areDeepEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;

    try {
      return (
        JSON.stringify(this.normalizeForComparison(left)) ===
        JSON.stringify(this.normalizeForComparison(right))
      );
    } catch {
      return false;
    }
  }

  private normalizeForComparison(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeForComparison(item));
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;

      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((output, key) => {
          output[key] = this.normalizeForComparison(record[key]);
          return output;
        }, {});
    }

    return value;
  }

  private debug(
    message: string,
    data?: Record<string, unknown>
  ): void {
    this.privacyDebug.log(
      'cache',
      `UserStateCacheService: ${message}`,
      data
    );
  }

  private report(
    error: unknown,
    operation: string,
    context?: Record<string, unknown>
  ): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[UserStateCacheService] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'user-state-cache';
      (wrapped as any).context = {
        operation,
        ...(context ?? {}),
      };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // Cache auxiliar não deve quebrar o fluxo de domínio.
    }
  }
}
