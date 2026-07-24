// src/app/core/services/general/cache/legacy-cache-persistence-policy.ts
// Proteção temporária para consumidores ainda ligados ao CacheService legado.
//
// A nova fachada AppCacheService não usa esta lista: nela a política é tipada e
// explícita por CacheDefinition. Este arquivo existe somente para impedir que
// chamadas antigas continuem gravando dados privados por default no IndexedDB.

export const LEGACY_MEMORY_ONLY_PREFIXES: readonly string[] = Object.freeze([
  'currentUser',
  'user:',
  'validation:',
  'search:',
  'preferences:',
  'friendSettings',
  'loadingSearch',
  'loadingSettings',
  'allUsers',
  'discovery:',
  'socialLinks:',
  'chats:',
  'chat:',
  'rooms:',
  'room:',
  'direct_',
]);

export function shouldBlockLegacyPersistence(key: string): boolean {
  const normalized = String(key ?? '').trim();

  if (!normalized) {
    return true;
  }

  return LEGACY_MEMORY_ONLY_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}
