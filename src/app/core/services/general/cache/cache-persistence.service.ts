//src\app\core\services\general\cache\cache-persistence.service.ts
// Serviço para persistência de cache usando IndexedDB via idb-keyval
// - API Observable-first (sem Promises na API pública)
// - Métodos para set, get e delete
// - Não esquecer os comentários explicativos.
import { Injectable } from '@angular/core';
import { set, get, del, keys as idbKeys } from 'idb-keyval';
import { from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CachePersistenceService {

  setPersistent<T>(key: string, value: T): Observable<void> {
    return from(set(key, value)); // ✅ Retornando um Observable
  }

  getPersistent<T>(key: string): Observable<T | null> {
    return from(get<T>(key).then(result => result !== undefined ? result : null)); // ✅ Evita `undefined`
  }

  deletePersistent(key: string): Observable<void> {
    return from(del(key)); // ✅ Mantendo a padronização com `Observable`
  }

  /**
 * Remove várias chaves explícitas do IndexedDB.
 *
 * Uso:
 * - limpeza de sessão;
 * - logout;
 * - troca de conta;
 * - remoção de caches sensíveis conhecidos.
 */
deletePersistentMany(keys: string[]): Observable<number> {
  const safeKeys = Array.from(
    new Set(
      (keys ?? [])
        .map((key) => String(key ?? '').trim())
        .filter(Boolean)
    )
  );

  if (!safeKeys.length) {
    return from(Promise.resolve(0));
  }

  return from(
    Promise.all(safeKeys.map((key) => del(key))).then(() => safeKeys.length)
  );
}

/**
 * Remove do IndexedDB todas as chaves que começam com determinado prefixo.
 *
 * Importante:
 * - usado para limpar cache user-scoped;
 * - evita manter dados de perfil/chat/social links após logout;
 * - mantém API pública baseada em Observable.
 */
deletePersistentByPrefix(prefix: string): Observable<number> {
  const safePrefix = String(prefix ?? '').trim();

  if (!safePrefix) {
    return from(Promise.resolve(0));
  }

  return from(
    idbKeys().then((allKeys) => {
      const matchingKeys = allKeys.filter(
        (key): key is string =>
          typeof key === 'string' && key.startsWith(safePrefix)
      );

      return Promise.all(matchingKeys.map((key) => del(key))).then(
        () => matchingKeys.length
      );
    })
  );
}
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
// AUTH ORCHESTRATOR SERVICE (Efeitos colaterais e ciclo de vida)
//
// Objetivo principal deste service:
// - Orquestrar “o que roda quando a sessão existe” (presence, watchers, keepAlive).
// - Garantir que listeners NÃO iniciem no registro e NÃO iniciem para emailVerified=false.
// - Centralizar encerramento de sessão *quando inevitável* (auth inválido).
//
// Regra de plataforma (conforme sua decisão):
// ✅ O usuário só deve perder a sessão (signOut) por LOGOUT voluntário,
//    EXCETO quando a própria sessão do Firebase Auth for tecnicamente inválida.
// - Em problemas de Firestore (doc missing / permission-denied / status) nós NÃO deslogamos.
//   Em vez disso: "bloqueamos" a sessão do app e redirecionamos para /register/welcome.
//
// Observação de arquitetura (fonte única):
// - AuthSessionService: verdade do Firebase Auth
// - CurrentUserStoreService: verdade do usuário do app (perfil/role/etc.)
// - AuthAppBlockService: verdade do "bloqueio do app" (sem logout)
// - AuthOrchestratorService: só side-effects e coordenação (não deve virar “store”)
