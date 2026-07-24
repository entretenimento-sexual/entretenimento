// src/app/core/services/general/api/ibge-location.service.ts
// Catálogos públicos do IBGE e localização resumida do usuário.
//
// Políticas distintas:
// - estados/municípios: dados públicos, globais, persistentes e versionados;
// - localização do usuário: dado privado, user-scoped e somente em memória.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDAS as chaves legadas `ibge:*` gravadas sem envelope.
//   Motivo: TTL e versão agora acompanham o catálogo persistido.
// - SUPRIMIDA a persistência sem expiração de `user:location`.
//   Motivo: localização é dado privado e não deve sobreviver à sessão.
// - SUPRIMIDOS logs diretos no console.
//   Motivo: falhas técnicas passam pelo GlobalErrorHandlerService.
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { AppCacheService } from '@core/services/general/cache/app-cache.service';
import { CacheDefinition } from '@core/services/general/cache/cache-contracts';

export interface IbgeUF {
  id: number;
  sigla: string;
  nome: string;
}

export interface IbgeMunicipio {
  id: number;
  nome: string;
}

export interface UserLocation {
  uf: string;
  municipio: string;
}

@Injectable({ providedIn: 'root' })
export class IBGELocationService {
  private readonly http = inject(HttpClient);
  private readonly cache = inject(AppCacheService);
  private readonly userStore = inject(CurrentUserStoreService);
  private readonly access = inject(AccessControlService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly estadosUrl =
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
  private readonly municipiosUrlTpl =
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios';

  private readonly ttl24HoursMs = 24 * 60 * 60 * 1000;
  private readonly collator = new Intl.Collator('pt-BR', {
    sensitivity: 'base',
  });

  private estadosInFlight$: Observable<IbgeUF[]> | null = null;
  private readonly municipiosInFlight = new Map<
    string,
    Observable<IbgeMunicipio[]>
  >();

  /** Carrega a lista de UFs ordenada por nome. */
  getEstados(): Observable<IbgeUF[]> {
    const definition = this.estadosDefinition();

    return this.cache.get$(definition).pipe(
      switchMap((cached) =>
        cached.status === 'fresh'
          ? of(cached.value)
          : this.loadEstados$(definition)
      ),
      take(1)
    );
  }

  /** Carrega os municípios de uma UF, ordenados por nome. */
  getMunicipios(uf: string): Observable<IbgeMunicipio[]> {
    const normalizedUf = String(uf ?? '').trim().toUpperCase();
    if (!normalizedUf) return of([]);

    const definition = this.municipiosDefinition(normalizedUf);

    return this.cache.get$(definition).pipe(
      switchMap((cached) =>
        cached.status === 'fresh'
          ? of(cached.value)
          : this.loadMunicipios$(normalizedUf, definition)
      ),
      take(1)
    );
  }

  /**
   * Retorna localização do cache de sessão; em miss, deriva do perfil runtime.
   * O fluxo espera o tri-state sair de undefined antes de concluir ausência.
   */
  getUserLocation(): Observable<UserLocation | null> {
    const definition = this.userLocationDefinition();

    return this.cache.get$(definition).pipe(
      switchMap((cached) => {
        if (cached.status !== 'miss') {
          return of(cached.value);
        }

        return this.userStore.user$.pipe(
          filter((user) => user !== undefined),
          take(1),
          switchMap((user) => {
            const location = this.locationFromUser(user);

            if (!location) {
              return of(null);
            }

            return this.cache
              .set$(definition, location)
              .pipe(map(() => location));
          })
        );
      }),
      take(1)
    );
  }

  /**
   * Mantém assinatura void por compatibilidade.
   * Atualiza apenas o cache privado da sessão quando o ACL permitir.
   */
  updateUserLocation(newLocation: UserLocation): void {
    const location = this.normalizeLocation(newLocation);
    if (!location) return;

    this.access
      .hasAtLeast$('premium')
      .pipe(
        take(1),
        switchMap((allowed) =>
          allowed
            ? this.cache.set$(
                this.userLocationDefinition(),
                location
              )
            : of(void 0)
        ),
        catchError((error) => {
          this.report(error, 'updateUserLocation');
          return of(void 0);
        })
      )
      .subscribe();
  }

  /** Limpa a localização privada do usuário atual. */
  clearUserLocationCache(): void {
    this.cache
      .invalidate$(this.userLocationDefinition())
      .pipe(take(1))
      .subscribe({
        error: (error) => this.report(error, 'clearUserLocationCache'),
      });
  }

  /** Pré-aquece catálogos públicos para melhorar a UX. */
  warmCaches(uf?: string): void {
    this.getEstados().pipe(take(1)).subscribe();

    const normalizedUf = String(uf ?? '').trim();
    if (normalizedUf) {
      this.getMunicipios(normalizedUf).pipe(take(1)).subscribe();
    }
  }

  private loadEstados$(
    definition: CacheDefinition<IbgeUF[]>
  ): Observable<IbgeUF[]> {
    if (this.estadosInFlight$) return this.estadosInFlight$;

    const request$ = this.http.get<IbgeUF[]>(this.estadosUrl).pipe(
      map((list) =>
        [...(list ?? [])].sort((a, b) =>
          this.collator.compare(a.nome, b.nome)
        )
      ),
      switchMap((list) =>
        this.cache.set$(definition, list).pipe(map(() => list))
      ),
      catchError((error) => {
        this.report(error, 'getEstados');
        return of([] as IbgeUF[]);
      }),
      finalize(() => {
        this.estadosInFlight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.estadosInFlight$ = request$;
    return request$;
  }

  private loadMunicipios$(
    uf: string,
    definition: CacheDefinition<IbgeMunicipio[]>
  ): Observable<IbgeMunicipio[]> {
    const existing = this.municipiosInFlight.get(uf);
    if (existing) return existing;

    const url = this.municipiosUrlTpl.replace(
      '{UF}',
      encodeURIComponent(uf)
    );

    const request$ = this.http.get<IbgeMunicipio[]>(url).pipe(
      map((list) =>
        [...(list ?? [])].sort((a, b) =>
          this.collator.compare(a.nome, b.nome)
        )
      ),
      switchMap((list) =>
        this.cache.set$(definition, list).pipe(map(() => list))
      ),
      catchError((error) => {
        this.report(error, 'getMunicipios', { uf });
        return of([] as IbgeMunicipio[]);
      }),
      finalize(() => this.municipiosInFlight.delete(uf)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.municipiosInFlight.set(uf, request$);
    return request$;
  }

  private estadosDefinition(): CacheDefinition<IbgeUF[]> {
    return {
      key: 'catalog:ibge:states',
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
      ttlMs: this.ttl24HoursMs,
      version: 1,
      validate: (value: unknown): value is IbgeUF[] =>
        Array.isArray(value) &&
        value.every((item) => this.isValidUf(item)),
    };
  }

  private municipiosDefinition(
    uf: string
  ): CacheDefinition<IbgeMunicipio[]> {
    return {
      key: `catalog:ibge:municipalities:${uf}`,
      scope: 'global',
      sensitivity: 'public',
      storage: 'persistent',
      ttlMs: this.ttl24HoursMs,
      version: 1,
      validate: (value: unknown): value is IbgeMunicipio[] =>
        Array.isArray(value) &&
        value.every((item) => this.isValidMunicipio(item)),
    };
  }

  private userLocationDefinition(): CacheDefinition<UserLocation> {
    const ownerUid = this.userStore.getLoggedUserUIDSnapshot();

    const base = {
      key: 'location-summary',
      sensitivity: 'restricted' as const,
      storage: 'memory' as const,
      ttlMs: null,
      version: 1,
      validate: (value: unknown): value is UserLocation =>
        this.isValidLocation(value),
    };

    return ownerUid
      ? {
          ...base,
          scope: 'user',
          ownerUid,
        }
      : {
          ...base,
          scope: 'session',
        };
  }

  private locationFromUser(
    user: unknown
  ): UserLocation | null {
    const record = user as Record<string, unknown> | null;

    return this.normalizeLocation({
      uf: String(record?.['estado'] ?? record?.['UF'] ?? ''),
      municipio: String(
        record?.['municipio'] ?? record?.['cidade'] ?? ''
      ),
    });
  }

  private normalizeLocation(
    location: UserLocation | null | undefined
  ): UserLocation | null {
    const uf = String(location?.uf ?? '').trim().toUpperCase();
    const municipio = String(location?.municipio ?? '').trim();

    return uf && municipio ? { uf, municipio } : null;
  }

  private isValidLocation(value: unknown): value is UserLocation {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;

    return (
      typeof record['uf'] === 'string' &&
      record['uf'].trim().length > 0 &&
      typeof record['municipio'] === 'string' &&
      record['municipio'].trim().length > 0
    );
  }

  private isValidUf(value: unknown): value is IbgeUF {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;

    return (
      typeof record['id'] === 'number' &&
      Number.isFinite(record['id']) &&
      typeof record['sigla'] === 'string' &&
      typeof record['nome'] === 'string'
    );
  }

  private isValidMunicipio(
    value: unknown
  ): value is IbgeMunicipio {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;

    return (
      typeof record['id'] === 'number' &&
      Number.isFinite(record['id']) &&
      typeof record['nome'] === 'string'
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
          : new Error('[IBGELocationService] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'ibge-location';
      (wrapped as any).context = { operation, ...(context ?? {}) };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // Catálogo/localização têm fallback e não devem quebrar o app.
    }
  }
}
