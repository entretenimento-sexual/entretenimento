// src/app/core/services/geolocation/ibge-location.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap, take } from 'rxjs/operators';

// ✅ Substitui Service anterior por store/ACL reativos
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';

// Cache central (mesmo usado no app)
import { CacheService } from '@core/services/general/cache/cache.service';

/** Tipos mínimos dos endpoints do IBGE */
export interface IbgeUF {
  id: number;
  sigla: string;
  nome: string;
  // regiao?: { id: number; sigla: string; nome: string };
}

export interface IbgeMunicipio {
  id: number;
  nome: string;
  // microrregiao?: any;
}

export interface UserLocation {
  uf: string;           // ex.: 'RJ'
  municipio: string;    // ex.: 'Rio de Janeiro'
}

@Injectable({ providedIn: 'root' })
export class IBGELocationService {
  private readonly http = inject(HttpClient);
  private readonly cache = inject(CacheService);
  private readonly userStore = inject(CurrentUserStoreService);
  private readonly access = inject(AccessControlService);

  private readonly estadosUrl = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
  private readonly municipiosUrlTpl = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios';

  private readonly estadosCacheKey = 'ibge:estados';
  private readonly municipiosCacheKey = 'ibge:municipios';
  private readonly userLocationCacheKey = 'user:location';

  // 24h (ms)
  private readonly TTL_24H = 24 * 60 * 60 * 1000;

  // Collator pt-BR para ordenação estável de nomes
  private readonly collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

  /** Carrega e cacheia a lista de UFs (ordenada por nome). */
  getEstados(): Observable<IbgeUF[]> {
    return this.cache.get<IbgeUF[]>(this.estadosCacheKey).pipe(
      switchMap(cached => {
        if (cached) return of(cached);

        return this.http.get<IbgeUF[]>(this.estadosUrl).pipe(
          map(list => [...list].sort((a, b) => this.collator.compare(a.nome, b.nome))),
          tap(list => this.cache.set(this.estadosCacheKey, list, this.TTL_24H)),
          catchError(err => {
            console.log('[IBGELocationService] Erro ao carregar estados:', err);
            return of<IbgeUF[]>([]);
          })
        );
      })
    );
  }

  /**
   * Carrega e cacheia os municípios de uma UF (ordenados por nome).
   * @param uf Sigla (ex.: 'RJ', 'SP')
   */
  getMunicipios(uf: string): Observable<IbgeMunicipio[]> {
    const UF = (uf || '').trim().toUpperCase();
    if (!UF) return of<IbgeMunicipio[]>([]);

    const cacheKey = `${this.municipiosCacheKey}:${UF}`;

    return this.cache.get<IbgeMunicipio[]>(cacheKey).pipe(
      switchMap(cached => {
        if (cached) return of(cached);

        const url = this.municipiosUrlTpl.replace('{UF}', encodeURIComponent(UF));
        return this.http.get<IbgeMunicipio[]>(url).pipe(
          map(list => [...list].sort((a, b) => this.collator.compare(a.nome, b.nome))),
          tap(list => this.cache.set(cacheKey, list, this.TTL_24H)),
          catchError(err => {
            console.log(`[IBGELocationService] Erro ao carregar municípios de ${UF}:`, err);
            return of<IbgeMunicipio[]>([]);
          })
        );
      })
    );
  }

  /**
   * Retorna a localização do usuário (UF/município) do cache; se não houver,
   * tenta derivar do usuário logado no store e então persiste em cache.
   */
  getUserLocation(): Observable<UserLocation | null> {
    return this.cache.get<UserLocation>(this.userLocationCacheKey).pipe(
      switchMap(cached => {
        if (cached) return of(cached);

        // ⚠️ user$ pode emitir undefined na resolução inicial → pegamos 1 valor “estável”
        return this.userStore.user$.pipe(
          take(1),
          map(u => {
            // Mantém compat com campos já usados no seu projeto
            const uf = (u as any)?.estado || (u as any)?.UF || '';
            const municipio = (u as any)?.municipio || (u as any)?.cidade || '';
            if (uf && municipio) {
              const loc = { uf: String(uf).toUpperCase(), municipio: String(municipio) } as UserLocation;
              this.cache.set(this.userLocationCacheKey, loc); // sem expiração
              return loc;
            }
            return null;
          })
        );
      })
    );
  }

  /**
   * Atualiza o cache local de localização do usuário SE o usuário tiver
   * permissão mínima (premium ou superior). A checagem usa AccessControlService.
   *
   * Obs.: Mantive assinatura void; a operação é assíncrona/reativa internamente.
   * Se você quiser feedback para a UI, crie uma variante que retorne Observable<boolean>.
   */
  updateUserLocation(newLocation: UserLocation): void {
    const loc: UserLocation = {
      uf: (newLocation?.uf || '').trim().toUpperCase(),
      municipio: (newLocation?.municipio || '').trim(),
    };
    if (!loc.uf || !loc.municipio) {
      console.log('[IBGELocationService] updateUserLocation ignorado: payload inválido.', newLocation);
      return;
    }

    this.access.hasAtLeast$('premium').pipe(take(1)).subscribe(allowed => {
      if (allowed) {
        this.cache.set(this.userLocationCacheKey, loc); // persistência local sem expiração
        console.log('[IBGELocationService] Localização atualizada no cache:', loc);
      } else {
        console.log('[IBGELocationService] Role insuficiente para alterar localização (precisa premium+).');
      }
    });
  }

  /** Limpa o cache da localização do usuário. */
  clearUserLocationCache(): void {
    this.cache.delete(this.userLocationCacheKey);
    console.log('[IBGELocationService] Cache de localização limpo.');
  }

  /** (Opcional) pré-aquece caches típicos para UX mais fluida. */
  warmCaches(uf?: string): void {
    this.getEstados().pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
    if (uf) this.getMunicipios(uf).pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
  }
}
