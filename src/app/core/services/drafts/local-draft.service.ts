// src/app/core/services/drafts/local-draft.service.ts
// -----------------------------------------------------------------------------
// LOCAL DRAFT SERVICE
// -----------------------------------------------------------------------------
// Armazena apenas rascunhos temporários e não sensíveis no navegador.
// - expiração obrigatória;
// - limite de tamanho;
// - serialização restrita a valores JSON simples;
// - nenhuma dependência de Firebase ou rede.
// -----------------------------------------------------------------------------
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface LocalDraftEnvelope<T> {
  version: 1;
  savedAt: number;
  expiresAt: number;
  value: T;
}

export interface LocalDraftChange {
  key: string;
  action: 'saved' | 'removed' | 'expired' | 'rejected';
  at: number;
}

const STORAGE_PREFIX = 'entretenimento:draft:v1:';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SERIALIZED_BYTES = 32 * 1024;

@Injectable({ providedIn: 'root' })
export class LocalDraftService {
  private readonly changesSubject = new BehaviorSubject<LocalDraftChange | null>(null);
  private readonly memoryFallback = new Map<string, string>();

  readonly changes$: Observable<LocalDraftChange | null> =
    this.changesSubject.asObservable();

  save<T extends Record<string, unknown>>(
    key: string,
    value: T,
    ttlMs = DEFAULT_TTL_MS
  ): boolean {
    const normalizedKey = this.normalizeKey(key);
    const safeValue = this.toSafeJsonValue(value);

    if (!normalizedKey || !safeValue || Array.isArray(safeValue)) {
      this.emit(normalizedKey || 'invalid', 'rejected');
      return false;
    }

    const now = Date.now();
    const envelope: LocalDraftEnvelope<Record<string, unknown>> = {
      version: 1,
      savedAt: now,
      expiresAt: now + this.normalizeTtl(ttlMs),
      value: safeValue,
    };
    const serialized = JSON.stringify(envelope);

    if (this.measureBytes(serialized) > MAX_SERIALIZED_BYTES) {
      this.emit(normalizedKey, 'rejected');
      return false;
    }

    try {
      this.write(this.storageKey(normalizedKey), serialized);
      this.emit(normalizedKey, 'saved');
      return true;
    } catch {
      this.emit(normalizedKey, 'rejected');
      return false;
    }
  }

  load<T extends Record<string, unknown>>(key: string): T | null {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return null;

    const storageKey = this.storageKey(normalizedKey);
    const serialized = this.read(storageKey);
    if (!serialized) return null;

    try {
      const parsed = JSON.parse(serialized) as Partial<LocalDraftEnvelope<T>>;
      const expiresAt = Number(parsed.expiresAt);

      if (
        parsed.version !== 1 ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() ||
        !parsed.value ||
        typeof parsed.value !== 'object' ||
        Array.isArray(parsed.value)
      ) {
        this.remove(normalizedKey, expiresAt <= Date.now() ? 'expired' : 'removed');
        return null;
      }

      const safeValue = this.toSafeJsonValue(parsed.value);
      return safeValue && !Array.isArray(safeValue)
        ? safeValue as T
        : null;
    } catch {
      this.remove(normalizedKey);
      return null;
    }
  }

  remove(
    key: string,
    action: LocalDraftChange['action'] = 'removed'
  ): void {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return;

    try {
      this.delete(this.storageKey(normalizedKey));
    } finally {
      this.emit(normalizedKey, action);
    }
  }

  private normalizeKey(value: unknown): string {
    return String(value ?? '')
      .trim()
      .replace(/[^A-Za-z0-9:_-]/g, '-')
      .slice(0, 180);
  }

  private normalizeTtl(value: unknown): number {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 60_000), MAX_TTL_MS)
      : DEFAULT_TTL_MS;
  }

  private storageKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
  }

  private toSafeJsonValue(
    value: unknown,
    depth = 0
  ): Record<string, unknown> | unknown[] | string | number | boolean | null {
    if (depth > 6) return null;
    if (value === null) return null;

    if (typeof value === 'string') return value.slice(0, 4000);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    if (Array.isArray(value)) {
      return value
        .slice(0, 100)
        .map((item) => this.toSafeJsonValue(item, depth + 1));
    }

    if (typeof value !== 'object') return null;

    if (
      (typeof File !== 'undefined' && value instanceof File) ||
      (typeof Blob !== 'undefined' && value instanceof Blob) ||
      value instanceof Date
    ) {
      return null;
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    Object.keys(source).slice(0, 100).forEach((key) => {
      const normalizedKey = String(key).trim().slice(0, 100);
      if (!normalizedKey) return;
      result[normalizedKey] = this.toSafeJsonValue(source[key], depth + 1);
    });

    return result;
  }

  private measureBytes(value: string): number {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(value).length;
    }
    return value.length * 2;
  }

  private read(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch {
      // Usa fallback em memória quando o storage está bloqueado.
    }
    return this.memoryFallback.get(key) ?? null;
  }

  private write(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        return;
      }
    } catch {
      // Usa fallback em memória quando o storage está bloqueado.
    }
    this.memoryFallback.set(key, value);
  }

  private delete(key: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {
      // Limpeza do fallback ainda é executada.
    }
    this.memoryFallback.delete(key);
  }

  private emit(key: string, action: LocalDraftChange['action']): void {
    this.changesSubject.next({ key, action, at: Date.now() });
  }
}
