// src/app/core/services/general/cache.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { setCache } from 'src/app/store/actions/cache.actions';
import { Store } from '@ngrx/store';
import { firstValueFrom, map, Observable, of, switchMap, take } from 'rxjs';
import { selectCacheItem } from 'src/app/store/selectors/cache.selectors';

interface CacheItem<T> {
  data: T;
  expiration: number | null; // Expiração em timestamp (ms) ou null para itens sem expiração
}

@Injectable({
  providedIn: 'root',
})
export class CacheService {
  private cache: Map<string, CacheItem<any>> = new Map();
  private defaultTTL = 300000; // Tempo padrão de expiração: 5 minutos

  constructor(private store: Store<AppState>) {
    console.log('[CacheService] Serviço inicializado.');
  }

  /**
   * Adiciona ou atualiza um item no cache.
   * @param key Chave única.
   * @param data Dados a serem armazenados.
   * @param ttl (Opcional) Tempo de vida do item em milissegundos.
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const normalizedKey = this.normalizeKey(key);
    const expiration = ttl ? Date.now() + ttl : null;
    console.log(`[CacheService] Adicionando/atualizando chave: "${normalizedKey}"`, { data, expiration });
    console.log(`[CacheService] Stack trace de adição/atualização: "${normalizedKey}"`);
    this.cache.set(normalizedKey, { data, expiration });
    console.log(`[CacheService] Item adicionado/atualizado: "${normalizedKey}"`, { data, expiration });
  }

  /**
 * Define ou atualiza os dados de um usuário no cache.
 * @param uid Identificador único do usuário.
 * @param user Dados do usuário.
 * @param ttl Tempo de vida do cache em milissegundos (padrão: 5 minutos).
 */
  setUser(uid: string, user: IUserDados, ttl: number = 300000): void {
    const normalizedKey = this.normalizeKey(`user:${uid}`);
    this.set(normalizedKey, user, ttl);
    this.set('currentuseruid', uid, ttl);

    // Também atualiza o `CacheState`
    this.store.dispatch(setCache({ key: `user:${uid}`, value: user }));
    this.store.dispatch(setCache({ key: 'currentuseruid', value: uid }));

    console.log(`[CacheService] currentuseruid armazenado no CacheState: "${uid}"`);
  }

  /**
   * Obtém um item do cache.
   * @param key Chave única.
   * @returns Dados armazenados ou `null` se não encontrado ou expirado.
   */
  get<T>(key: string): Observable<T | null> {
    const caller = this.identifyCaller();

    console.log(`[CacheService] (${caller}) Buscando chave: "${key}"`);
    const normalizedKey = this.normalizeKey(key);

    const cachedItem = this.cache.get(normalizedKey);
    if (cachedItem && !this.isExpired(cachedItem.expiration)) {
      console.log(`[CacheService] (${caller}) Chave encontrada no cache: "${key}"`);
      return of(cachedItem.data as T);
    }

    console.log(`[CacheService] (${caller}) Chave não encontrada no cache: "${key}"`);

    const storeItem = this.store.select(selectCacheItem(key));
    return storeItem.pipe(
      take(1),
      map((item: CacheItem<T> | null) => {
        if (item && !this.isExpired(item.expiration)) {
          console.log(`[CacheService] (${caller}) Chave encontrada no Store: "${key}"`);
          return item.data;
        } else {
          console.log(`[CacheService] (${caller}) Chave não encontrada nem no cache nem no Store: "${key}"`);
          return null;
        }
      })
    );
  }

  private isExpired(expiration: number | null): boolean {
    if (expiration === null) return false;
    return Date.now() > expiration;
  }

  private identifyCaller(): string {
    const error = new Error();
    const stackLines = (error.stack || '').split('\n');

    // A terceira linha geralmente é o chamador direto, mas pode variar conforme o ambiente.
    const callerLine = stackLines[3] || 'Unknown Method';

    // Extrair apenas o nome da função (removendo caminhos e formatação desnecessária)
    const match = callerLine.match(/at\s+(.*)\s+\(/);
    return match ? match[1] : 'Unknown Method';
  }


  /**
   * Verifica se uma chave existe e não está expirada.
   * @param key Chave única.
   * @returns `true` se o item existir e não estiver expirado.
   */
  has(key: string): boolean {
    const normalizedKey = this.normalizeKey(key);
    const cachedItem = this.cache.get(normalizedKey);

    if (!cachedItem) return false;

    if (cachedItem.expiration && cachedItem.expiration < Date.now()) {
      this.cache.delete(normalizedKey);
      return false;
    }

    return true;
  }

  /**
   * Remove um item do cache.
   * @param key Chave única.
   */
  delete(key: string): void {
    const normalizedKey = this.normalizeKey(key);
    const cachedItem = this.cache.get(normalizedKey);
    if (this.cache.delete(normalizedKey)) {
      console.log(`[CacheService] Item removido: "${normalizedKey}"`);
    } else {
      console.log(`[CacheService] Tentativa de remover chave inexistente: "${normalizedKey}"`);
    }
  }

  /**
   * Limpa todos os itens do cache.
   */
  clear(): void {
    this.cache.clear();
    console.log('[CacheService] Todos os itens foram removidos do cache.');
  }

  /**
   * Retorna todas as chaves atualmente no cache.
   * @returns Lista de chaves armazenadas.
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Retorna a contagem total de itens no cache.
   * @returns Número de itens armazenados.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Remove itens expirados do cache.
   */
  removeExpired(): void {
    const now = Date.now();
    const expiredKeys = Array.from(this.cache.entries())
      .filter(([_, item]) => item.expiration && item.expiration < now)
      .map(([key]) => key);

    expiredKeys.forEach((key) => this.cache.delete(key));
    console.log(`[CacheService] Itens expirados removidos. Total: ${expiredKeys.length}`);
  }

  /**
   * Habilita uma limpeza automática de itens expirados.
   * @param interval Tempo entre as limpezas em milissegundos (padrão: 1 minuto).
   * @returns Uma função para desabilitar a limpeza automática.
   */
  enableAutoCleanup(interval: number = 60000): () => void {
    console.log(`[CacheService] Limpeza automática ativada. Intervalo: ${interval}ms.`);
    const cleanupInterval = setInterval(() => this.removeExpired(), interval);

    return () => {
      clearInterval(cleanupInterval);
      console.log('[CacheService] Limpeza automática desativada.');
    };
  }

  /**
   * Atualiza um item existente no cache.
   * @param key Chave única.
   * @param data Dados atualizados.
   * @param ttl (Opcional) Novo tempo de vida.
   */
  update<T>(key: string, data: T, ttl?: number): void {
    const normalizedKey = this.normalizeKey(key);

    if (!this.cache.has(normalizedKey)) {
      console.log(`[CacheService] Tentativa de atualizar chave inexistente: "${normalizedKey}"`);
      return;
    }

    const expiration = ttl ? Date.now() + ttl : this.cache.get(normalizedKey)!.expiration;
    this.cache.set(normalizedKey, { data, expiration });
    console.log(`[CacheService] Item atualizado: "${normalizedKey}"`, { data, expiration });
  }

  /**
   * Marca um item como não encontrado por um tempo definido.
   * @param key Chave única.
   * @param ttl Tempo de vida em milissegundos (padrão: 30 segundos).
   */
  markAsNotFound(key: string, ttl: number = 30000): void {
    this.set(`notFound:${key}`, true, ttl);
    console.log(`[CacheService] Item marcado como não encontrado: "${key}"`);
  }

  /**
   * Verifica se um item foi marcado como não encontrado.
   * @param key Chave única.
   * @returns `true` se o item foi marcado como não encontrado e ainda não expirou.
   */
  isNotFound(key: string): boolean {
    return this.has(`notFound:${key}`);
  }

  /**
   * Normaliza uma chave para evitar inconsistências.
   * @param key Chave a ser normalizada.
   * @returns Chave normalizada.
   */
  private normalizeKey(key: string): string {
    return key.trim();
  }

  /**
   * Sincroniza dados do usuário com base no UID.
   * @param userData Dados do usuário.
   */
  syncCurrentUserWithUid(userData: IUserDados): void {
    const uid = userData.uid.trim().toLowerCase();
    this.set(`user:${uid}`, userData, this.defaultTTL);
    this.set('currentUser', userData, this.defaultTTL);
    console.log(`[CacheService] currentUser sincronizado com UID: "${uid}"`);
  }

  /**
   * Habilita o modo de depuração para exibir informações detalhadas do cache.
   */
  debug(): void {
    console.log('[CacheService] Estado atual do cache:', {
      size: this.size(),
      keys: this.keys(),
    });
  }
}
