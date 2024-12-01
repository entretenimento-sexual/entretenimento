// src/app/core/services/general/cache.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';

interface CacheItem<T> {
  data: T;
  expiration: number | null; // Tempo de expiração em milissegundos
}

@Injectable({
  providedIn: 'root',
})
export class CacheService {
  private cache: Map<string, CacheItem<any>> = new Map();

  constructor() { }

  setUser(uid: string, userData: IUserDados, ttl: number): void {
    this.set(`user:${uid}`, userData, ttl);
  }

  getUser(uid: string): IUserDados | null {
    return this.get<IUserDados>(`user:${uid}`);
  }

  markAsNotFound(uid: string, ttl: number = 30000): void {
    this.set(`notFound:${uid}`, true, ttl);
  }

  isNotFound(uid: string): boolean {
    return this.has(`notFound:${uid}`);
  }
  
  /**
   * Adiciona um item ao cache.
   * @param key Chave única para o item no cache.
   * @param data Dados a serem armazenados.
   * @param ttl Tempo de vida do item em milissegundos (opcional).
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const expiration = ttl ? Date.now() + ttl : null;
    this.cache.set(key, { data, expiration });
    console.log(`[CacheService] Item adicionado ao cache: ${key}`, { data, expiration });
  }

  /**
   * Obtém um item do cache.
   * @param key Chave única do item no cache.
   * @returns O dado armazenado ou `null` se expirado/não encontrado.
   */
  get<T>(key: string): T | null {
    const cachedItem = this.cache.get(key);

    if (!cachedItem) {
      console.log(`[CacheService] Item não encontrado no cache: ${key}`);
      return null;
    }

    if (cachedItem.expiration && cachedItem.expiration < Date.now()) {
      console.log(`[CacheService] Item expirado no cache: ${key}`);
      this.delete(key); // Remove o item expirado
      return null;
    }

    console.log(`[CacheService] Item obtido do cache: ${key}`, cachedItem.data);
    return cachedItem.data;
  }

  /**
   * Verifica se uma chave existe no cache.
   * @param key Chave a ser verificada.
   * @returns `true` se a chave existir e não estiver expirada; caso contrário, `false`.
   */
  has(key: string): boolean {
    const cachedItem = this.cache.get(key);
    if (!cachedItem) return false;

    if (cachedItem.expiration && cachedItem.expiration < Date.now()) {
      this.delete(key); // Remove o item expirado
      return false;
    }

    return true;
  }

  /**
   * Atualiza um item no cache.
   * @param key Chave única do item no cache.
   * @param data Novos dados a serem armazenados.
   * @param ttl (Opcional) Atualiza o tempo de vida do item.
   */
  update<T>(key: string, data: T, ttl?: number): void {
    if (!this.cache.has(key)) {
      console.warn(`[CacheService] Tentativa de atualizar um item inexistente no cache: ${key}`);
      return;
    }

    const expiration = ttl ? Date.now() + ttl : this.cache.get(key)!.expiration;
    this.cache.set(key, { data, expiration });
    console.log(`[CacheService] Item atualizado no cache: ${key}`, { data, expiration });
  }

  /**
   * Remove um item do cache.
   * @param key Chave única do item a ser removido.
   */
  delete(key: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
      console.log(`[CacheService] Item removido do cache: ${key}`);
    } else {
      console.warn(`[CacheService] Tentativa de remover um item inexistente no cache: ${key}`);
    }
  }

  /**
   * Limpa todos os itens do cache.
   */
  clear(): void {
    this.cache.clear();
    console.log(`[CacheService] Todos os itens foram removidos do cache.`);
  }

  /**
   * Obtém todas as chaves atualmente armazenadas no cache.
   * @returns Uma lista de chaves no cache.
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Obtém o número de itens atualmente armazenados no cache.
   * @returns A contagem de itens no cache.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Remove todos os itens expirados do cache.
   */
  removeExpired(): void {
    const now = Date.now();
    this.cache.forEach((item, key) => {
      if (item.expiration && item.expiration < now) {
        this.cache.delete(key);
        console.log(`[CacheService] Item expirado removido do cache: ${key}`);
      }
    });
  }

  /**
   * Habilita um mecanismo automático para limpar itens expirados periodicamente.
   * @param interval Tempo em milissegundos entre as limpezas automáticas.
   * @returns Uma função para cancelar a limpeza automática.
   */
  enableAutoCleanup(interval: number = 60000): () => void {
    console.log(`[CacheService] Limpeza automática habilitada com intervalo de ${interval}ms.`);
    const cleanupInterval = setInterval(() => this.removeExpired(), interval);

    // Retorna uma função para cancelar o intervalo
    return () => {
      clearInterval(cleanupInterval);
      console.log(`[CacheService] Limpeza automática desabilitada.`);
    };
  }
}
