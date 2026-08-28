import { Injectable, InjectionToken, inject } from '@angular/core';

export interface CachePolicyDefinition {
  readonly match: 'exact' | 'prefix';
  readonly value: string;
  readonly ttlMs: number | null;
  readonly persist: boolean;
}

export interface ResolvedCachePolicy {
  readonly ttlMs: number | null;
  readonly persist: boolean;
  readonly matchedBy: string;
}

const MINUTE = 60_000;

/**
 * Políticas padrão conservadoras.
 *
 * Somente caches efêmeros recebem TTL automático. Payloads de domínio que usam
 * SWR próprio permanecem não expirantes no envelope; o estado fresh/stale é
 * decidido pelo metadado mantido pelo serviço de domínio.
 */
export const DEFAULT_CACHE_POLICIES: ReadonlyArray<CachePolicyDefinition> = [
  { match: 'exact', value: 'currentUser', ttlMs: null, persist: false },
  { match: 'exact', value: 'currentUserUid', ttlMs: null, persist: false },
  { match: 'prefix', value: 'notFound:', ttlMs: 30_000, persist: false },
  { match: 'prefix', value: 'validation:', ttlMs: 2 * MINUTE, persist: false },
  { match: 'prefix', value: 'search:', ttlMs: 5 * MINUTE, persist: false },
  { match: 'prefix', value: 'preferences:', ttlMs: null, persist: true },
  { match: 'prefix', value: 'friendSettings:', ttlMs: null, persist: true },
  { match: 'prefix', value: 'socialLinks:', ttlMs: null, persist: true },
  { match: 'prefix', value: 'discovery:', ttlMs: null, persist: true },
  { match: 'prefix', value: 'user:', ttlMs: null, persist: true },
];

export const CACHE_POLICIES = new InjectionToken<ReadonlyArray<CachePolicyDefinition>>(
  'CACHE_POLICIES',
  {
    providedIn: 'root',
    factory: () => DEFAULT_CACHE_POLICIES,
  }
);

/**
 * Resolve padrões por chave sem retirar o controle do consumidor.
 * TTL e persistência informados na chamada sempre têm precedência.
 */
@Injectable({ providedIn: 'root' })
export class CachePolicyService {
  private readonly policies = this.normalizePolicies(inject(CACHE_POLICIES));

  resolve(
    key: string,
    explicitTtl?: number,
    explicitPersist?: boolean
  ): ResolvedCachePolicy {
    const normalizedKey = String(key ?? '').trim();
    const matched = this.policies.find((policy) =>
      policy.match === 'exact'
        ? normalizedKey === policy.value
        : normalizedKey.startsWith(policy.value)
    );

    const ttlMs = this.resolveTtl(explicitTtl, matched?.ttlMs ?? null);
    const persist = explicitPersist ?? matched?.persist ?? true;

    return {
      ttlMs,
      persist,
      matchedBy: matched ? `${matched.match}:${matched.value}` : 'default',
    };
  }

  private resolveTtl(explicitTtl: number | undefined, fallback: number | null): number | null {
    if (typeof explicitTtl !== 'number' || !Number.isFinite(explicitTtl)) {
      return fallback;
    }

    return explicitTtl > 0 ? explicitTtl : null;
  }

  private normalizePolicies(
    policies: ReadonlyArray<CachePolicyDefinition>
  ): ReadonlyArray<CachePolicyDefinition> {
    return [...(policies ?? [])]
      .filter((policy) => Boolean(String(policy?.value ?? '').trim()))
      .map((policy) => ({
        ...policy,
        value: String(policy.value).trim(),
        ttlMs:
          typeof policy.ttlMs === 'number' && Number.isFinite(policy.ttlMs) && policy.ttlMs > 0
            ? policy.ttlMs
            : null,
        persist: policy.persist === true,
      }))
      .sort((a, b) => {
        if (a.match !== b.match) return a.match === 'exact' ? -1 : 1;
        return b.value.length - a.value.length;
      });
  }
}
