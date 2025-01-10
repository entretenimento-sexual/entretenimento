// src/app/core/services/geolocation/ibge-location.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { AuthService } from '../../autentication/auth.service';
import { CacheService } from '../cache.service';

@Injectable({
  providedIn: 'root',
})
export class IBGELocationService {
  private readonly estadosUrl = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
  private readonly municipiosUrl = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios';

  private estadosCacheKey = 'ibge:estados';
  private municipiosCacheKey = 'ibge:municipios';
  private userLocationCacheKey = 'user:location';

    constructor(private http: HttpClient,
                private authService: AuthService,
                private cacheService: CacheService) { }

  /**
   * Retorna a lista de estados (com cache).
   */
  getEstados(): Observable<any[]> {
    const cachedEstados = this.cacheService.get<any[]>(this.estadosCacheKey);
    if (cachedEstados) {
      return of(cachedEstados);
    }

    return this.http.get<any[]>(this.estadosUrl).pipe(
      map((estados) => estados.sort((a, b) => a.nome.localeCompare(b.nome))),
      tap((estados) => this.cacheService.set(this.estadosCacheKey, estados, 24 * 60 * 60 * 1000)), // Cache de 24h
      catchError((error) => {
        console.error('Erro ao carregar estados:', error);
        return of([]);
      })
    );
  }

  /**
   * Retorna os municípios de um estado, com base na sigla do estado (UF).
   * @param uf Sigla do estado.
   */
  getMunicipios(uf: string): Observable<any[]> {
    const cacheKey = `${this.municipiosCacheKey}:${uf}`;
    const cachedMunicipios = this.cacheService.get<any[]>(cacheKey);

    if (cachedMunicipios) {
      return of(cachedMunicipios);
    }

    const url = this.municipiosUrl.replace('{UF}', uf);
    return this.http.get<any[]>(url).pipe(
      map((municipios) => municipios.sort((a, b) => a.nome.localeCompare(b.nome))),
      tap((municipios) => this.cacheService.set(cacheKey, municipios, 24 * 60 * 60 * 1000)), // Cache de 24h
      catchError((error) => {
        console.error(`Erro ao carregar municípios para o estado ${uf}:`, error);
        return of([]);
      })
    );
  }

  /**
   * Retorna a localização do usuário (estado e município) do cache ou inicializa com valores padrão.
   */
  getUserLocation(): { uf: string; municipio: string } | null {
    const cachedLocation = this.cacheService.get<{ uf: string; municipio: string }>(this.userLocationCacheKey);

    if (cachedLocation) {
      return cachedLocation;
    }

    const user = this.authService.currentUser;
    if (user && user.estado && user.municipio) {
      const location = { uf: user.estado, municipio: user.municipio };
      this.cacheService.set(this.userLocationCacheKey, location, undefined); // Sem expiração
      return location;
    }

    return null;
  }

  /**
   * Atualiza o cache de localização do usuário, se permitido.
   * @param newLocation Nova localização (estado e município).
   */
  updateUserLocation(newLocation: { uf: string; municipio: string }): void {
    const userRole = this.authService.currentUser?.role || 'visitante';

    if (['premium', 'vip'].includes(userRole)) {
      this.cacheService.set(this.userLocationCacheKey, newLocation, undefined); // Atualiza sem expiração
      console.log('Localização do usuário atualizada no cache:', newLocation);
    } else {
      console.warn('Usuários com role baixo não podem alterar sua localização.');
    }
  }

  //Limpa o cache da localização do usuário.
  clearUserLocationCache(): void {
    this.cacheService.delete(this.userLocationCacheKey);
    console.log('Cache de localização do usuário limpo.');
  }
}
