// src/app/core/services/data-handling/firestore/state/user-state-cache.service.ts
// Não esqueça os comentários e as ferramentas de debug.
//
// Objetivo deste service:
// - manter um cache leve de usuário por uid
// - sincronizar cache + NgRx sem duplicar responsabilidade do CurrentUserStore
// - evitar writes redundantes no state
// - reduzir risco de dado stale por comparação frágil
//
// Regras arquiteturais importantes:
// - AuthSession manda no UID canônico de sessão
// - CurrentUserStore manda no IUserDados runtime/hidratado
// - este service NÃO substitui nenhuma dessas fontes canônicas
// - ele atua como camada auxiliar de cache/state update
//
// Ajustes desta revisão:
// - upsertUser() agora diferencia add vs update
// - removido subscribe() interno em updateUserInStateAndCache()
// - removido JSON.stringify() como estratégia principal de comparação
// - tratamento de erro roteado para GlobalErrorHandlerService
// - comparação mais robusta para evitar cache stale e dispatch redundante
//
// SUPRESSÕES EXPLÍCITAS:
// 1) Foi SUPRIMIDO o subscribe() interno em updateUserInStateAndCache().
//    Motivo: evitar side effect reativo escondido e facilitar previsibilidade.
//
// 2) Foi SUPRIMIDO o uso de JSON.stringify(existing) === JSON.stringify(updatedData)
//    como estratégia principal de decisão.
//    Motivo: comparação frágil, dependente de ordem de propriedades e pouco semântica.
//
// 3) Foi SUPRIMIDO o comportamento "sempre addUserToState" em upsertUser().
//    Motivo: semanticamente incorreto quando o usuário já existe no state/cache.
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { CacheService } from '@core/services/general/cache/cache.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppState } from 'src/app/store/states/app.state';
import {
  addUserToState,
  updateUserInState,
} from 'src/app/store/actions/actions.user/user.actions';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { IUserRegistrationData } from '@core/interfaces/iuser-registration-data';
import { environment } from 'src/environments/environment';

/**
 * Shape interna e estável para comparação.
 *
 * Motivo:
 * - evita depender diretamente de Partial<IUserDados>, que herda
 *   a distinção estrita entre propriedades opcionais e null/undefined
 * - permite comparação sem conflitar com a modelagem real do domínio
 */
type ComparableUserShape = {
  uid: string;
  nickname?: string | null;
  email: string | null;
  photoURL?: string | null;
  nome?: string;
  role: IUserDados['role'];
  emailVerified?: boolean;
  estado?: string;
  municipio?: string;
  isSubscriber: boolean;
  profileCompleted?: boolean;
  subscriptionExpires?: number | null;
  roomCreationSubscriptionExpires?: number | null;
  singleRoomCreationRightExpires?: number | null;
  monthlyPayer?: boolean;
  suspended?: boolean;
  lastLogin: number;
  firstLogin?: number | null;
  createdAt?: number | null;
  registrationDate?: number | null;
  lastSeen?: number | null;
  lastOfflineAt?: number | null;
  lastOnlineAt?: number | null;
  lastLocationAt?: number | null;
  acceptedTerms?: { accepted: boolean; date: number | null };
  nicknameHistory?: Array<{ nickname: string; date: number | null }>;
  socialLinks?: IUserDados['socialLinks'];
  preferences?: string[];
  roomIds?: string[];
  gender?: string;
  orientation?: string;
  partner1Orientation?: string;
  partner2Orientation?: string;
  descricao: string;
  isOnline?: boolean;
};

@Injectable({ providedIn: 'root' })
export class UserStateCacheService {
  private readonly debug = !!environment.enableDebugTools && !environment.production;

  constructor(
    private readonly cache: CacheService,
    private readonly store: Store<AppState>,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers básicos
  // ---------------------------------------------------------------------------

  private dbg(message: string, payload?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.debug('[UserStateCacheService]', message, payload ?? '');
  }

  private reportError(
    message: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      const err = error instanceof Error ? error : new Error(message);
      (err as any).original = error;
      (err as any).context = {
        scope: 'UserStateCacheService',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }

  private norm(uid: string): string {
    return (uid ?? '').toString().trim();
  }

  private key(uid: string): string {
    return `user:${this.norm(uid)}`;
  }

  // ---------------------------------------------------------------------------
  // Cache tri-state
  // ---------------------------------------------------------------------------

  /**
   * Cache tri-state:
   * - undefined: cache miss (não existe chave)
   * - null: inválido/expirado deliberadamente
   * - IUserDados: valor
   */
  getCachedUser$(uid: string): Observable<IUserDados | null | undefined> {
    const id = this.norm(uid);
    if (!id) return of(undefined);

    return this.cache.get<IUserDados | null>(this.key(id)).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao obter usuário do cache (Observable).',
          error,
          { op: 'getCachedUser$', uid: id }
        );
        return of(undefined);
      })
    );
  }

  getCachedUserSnapshot(uid: string): IUserDados | null | undefined {
    const id = this.norm(uid);
    if (!id) return undefined;

    try {
      return this.cache.getSync<IUserDados | null>(this.key(id));
    } catch (error) {
      this.reportError(
        'Erro ao obter usuário do cache (snapshot).',
        error,
        { op: 'getCachedUserSnapshot', uid: id }
      );
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Comparação robusta
  // ---------------------------------------------------------------------------

  /**
   * Normaliza valor para comparação estável.
   * - ordena chaves de objetos
   * - preserva arrays
   * - trata null/undefined de forma consistente
   */
  private normalizeForComparison(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeForComparison(item));
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const sortedKeys = Object.keys(obj).sort();

      return sortedKeys.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = this.normalizeForComparison(obj[key]);
        return acc;
      }, {});
    }

    return value;
  }

  private areDeepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(this.normalizeForComparison(a)) ===
      JSON.stringify(this.normalizeForComparison(b));
  }

  private extractComparableUserShape(
    user: IUserDados | null | undefined
  ): ComparableUserShape | null {
    if (!user) return null;

    return {
      uid: user.uid,
      nickname: user.nickname ?? undefined,
      email: user.email ?? null,
      photoURL: user.photoURL ?? undefined,
      nome: user.nome ?? undefined,
      role: user.role,
      emailVerified: user.emailVerified ?? false,
      estado: user.estado ?? undefined,
      municipio: user.municipio ?? undefined,
      isSubscriber: user.isSubscriber,
      profileCompleted: user.profileCompleted ?? false,
      subscriptionExpires: user.subscriptionExpires ?? null,
      roomCreationSubscriptionExpires: user.roomCreationSubscriptionExpires ?? null,
      singleRoomCreationRightExpires: user.singleRoomCreationRightExpires ?? null,
      monthlyPayer: user.monthlyPayer ?? false,
      suspended: user.suspended ?? false,
      lastLogin: user.lastLogin,
      firstLogin: user.firstLogin ?? null,
      createdAt: user.createdAt ?? null,
      registrationDate: user.registrationDate ?? null,
      lastSeen: user.lastSeen ?? null,
      lastOfflineAt: user.lastOfflineAt ?? null,
      lastOnlineAt: user.lastOnlineAt ?? null,
      lastLocationAt: user.lastLocationAt ?? null,
      acceptedTerms: user.acceptedTerms ?? undefined,
      nicknameHistory: user.nicknameHistory ?? [],
      socialLinks: user.socialLinks ?? undefined,
      preferences: user.preferences ?? [],
      roomIds: user.roomIds ?? [],
      gender: user.gender ?? undefined,
      orientation: user.orientation ?? undefined,
      partner1Orientation: user.partner1Orientation ?? undefined,
      partner2Orientation: user.partner2Orientation ?? undefined,
      descricao: user.descricao,
      isOnline: user.isOnline ?? false,
    };
  }

  private hasMeaningfulUserChanges(
    current: IUserDados | null | undefined,
    incoming: IUserDados
  ): boolean {
    const currentComparable = this.extractComparableUserShape(current);
    const incomingComparable = this.extractComparableUserShape(incoming);

    return !this.areDeepEqual(currentComparable, incomingComparable);
  }

  /**
   * Compara apenas as chaves presentes no patch.
   * Útil para update parcial sem depender de igualdade do objeto inteiro.
   */
  private hasPatchChanges<T extends object>(
    existing: T | null | undefined,
    patch: Partial<T>
  ): boolean {
    if (!existing) return true;

    const patchKeys = Object.keys((patch ?? {}) as object) as Array<keyof T>;
    if (patchKeys.length === 0) return false;

    return patchKeys.some((key) => {
      const currentValue = existing[key];
      const nextValue = patch[key];
      return !this.areDeepEqual(currentValue, nextValue);
    });
  }

  // ---------------------------------------------------------------------------
  // Upsert do usuário completo
  // ---------------------------------------------------------------------------

  /**
   * Upsert semântico:
   * - se não existe snapshot, adiciona no state
   * - se já existe e mudou, atualiza no state
   * - sempre mantém cache alinhado
   */
  upsertUser(user: IUserDados, ttlMs = 300_000): void {
    if (!user?.uid) return;

    try {
      const current = this.getCachedUserSnapshot(user.uid);

      if (!this.hasMeaningfulUserChanges(current, user)) {
        this.dbg('upsertUser ignorado (sem mudanças relevantes)', {
          uid: user.uid,
        });
        return;
      }

      const isNew = current === undefined || current === null;

      if (isNew) {
        this.store.dispatch(addUserToState({ user }));
        this.dbg('addUserToState disparado', { uid: user.uid });
      } else {
        this.store.dispatch(
          updateUserInState({
            uid: user.uid,
            updatedData: user,
          })
        );
        this.dbg('updateUserInState disparado via upsertUser', { uid: user.uid });
      }

      this.cache.set(this.key(user.uid), user, ttlMs);
      this.dbg('cache atualizado via upsertUser', {
        uid: user.uid,
        ttlMs,
      });
    } catch (error) {
      this.reportError(
        'Erro ao fazer upsert do usuário em state/cache.',
        error,
        { op: 'upsertUser', uid: user?.uid ?? null }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Invalidação
  // ---------------------------------------------------------------------------

  invalidate(uid: string): void {
    const id = this.norm(uid);
    if (!id) return;

    try {
      this.cache.delete(this.key(id));
      this.dbg('cache invalidado por delete', { uid: id });
    } catch (error) {
      this.reportError(
        'Falha ao invalidar cache via delete. Aplicando fallback null curto.',
        error,
        { op: 'invalidate', uid: id }
      );

      try {
        this.cache.set(this.key(id), null as any, 1);
        this.dbg('cache invalidado via fallback null curto', { uid: id });
      } catch (fallbackError) {
        this.reportError(
          'Falha também no fallback de invalidação do cache.',
          fallbackError,
          { op: 'invalidate:fallback', uid: id }
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Update parcial
  // ---------------------------------------------------------------------------

  /**
   * Atualiza cache + state com patch parcial.
   *
   * Ajuste importante:
   * - não usa subscribe() interno
   * - usa snapshot síncrono do cache para reduzir side-effect oculto
   * - só faz dispatch/cache write se houver mudança real nas chaves do patch
   */
  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(
    uid: string,
    updatedData: T
  ): void {
    const id = this.norm(uid);
    if (!id) return;

    try {
      const key = this.key(id);
      const existing = this.getCachedUserSnapshot(id) as T | null | undefined;

      if (!updatedData || typeof updatedData !== 'object') {
        this.dbg('updateUserInStateAndCache ignorado (patch inválido)', { uid: id });
        return;
      }

      if (!this.hasPatchChanges(existing ?? undefined, updatedData)) {
        this.dbg('updateUserInStateAndCache ignorado (sem mudanças)', { uid: id });
        return;
      }

      const mergedValue = {
        ...(existing ?? {}),
        ...(updatedData ?? {}),
      } as T;

      this.cache.set(key, mergedValue, 300_000);
      this.store.dispatch(
        updateUserInState({
          uid: id,
          updatedData: mergedValue as unknown as IUserDados,
        })
      );

      this.dbg('updateUserInStateAndCache aplicado', {
        uid: id,
        updatedKeys: Object.keys(updatedData as object),
      });
    } catch (error) {
      this.reportError(
        'Erro ao atualizar usuário em state/cache.',
        error,
        {
          op: 'updateUserInStateAndCache',
          uid: id,
          updatedKeys:
            updatedData && typeof updatedData === 'object'
              ? Object.keys(updatedData as object)
              : [],
        }
      );
    }
  }
}