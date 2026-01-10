// src/app/core/services/data-handling/queries/user-presence.query.service.ts
import { Injectable } from '@angular/core';
import { Timestamp, where } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, switchMap, take } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

/**
 * ============================================================================
 * CAMADA FIREBASE (Query)
 * - NÃO conhece NgRx
 * - NÃO “inventa” UID
 * - NÃO abre listener sem sessão (evita rules/400 em boot deslogado)
 * - Erros passam pelo handler central (FirestoreErrorHandlerService)
 * ============================================================================
 */
@Injectable({ providedIn: 'root' })
export class UserPresenceQueryService {
  // Memoização de streams por "chave" (evita múltiplos listeners idênticos)
  private onlineByRegionMemo = new Map<string, Observable<IUserDados[]>>();
  private recentlyOnlineMemo = new Map<number, Observable<IUserDados[]>>();

  /**
   * UID fonte da verdade (AuthSession)
   * - distinctUntilChanged: evita reabrir listener sem necessidade
   * - shareReplay(refCount): compartilha entre múltiplos subscribers sem duplicar onSnapshot
   */
  private readonly uid$ = this.authSession.uid$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly read: FirestoreReadService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly authSession: AuthSessionService
  ) { }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Converte lastSeen (Timestamp | number | Date | etc) para epoch(ms) */
  private toLastSeenMs(u: any): number {
    const t = u?.lastSeen;

    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (t instanceof Date) return t.getTime();

    // Firestore Timestamp
    if (t instanceof Timestamp) return t.toMillis();

    // Timestamp-like (AngularFire/Firestore)
    if (typeof t?.toMillis === 'function') return t.toMillis();
    if (typeof t?.toDate === 'function') {
      const d = t.toDate();
      if (d instanceof Date) return d.getTime();
    }

    // string fallback
    const d = new Date(t);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  /**
   * Guard reativo:
   * - se uid=null => retorna [] e NÃO cria listener
   * - se uid=string => executa a query live
   */
  private liveGuardedQuery(constraints: any[]): Observable<IUserDados[]> {
    return this.uid$.pipe(
      switchMap((uid) => {
        if (!uid) return of([]); // ✅ sem sessão: nada de onSnapshot

        return this.read.getDocumentsLive<IUserDados>(
          'users',
          constraints,
          { idField: 'uid', useCache: true, cacheTTL: 60_000 }
        ).pipe(
          catchError((err) => this.firestoreError.handleFirestoreError(err))
        );
      })
    );
  }

  /**
   * Guard “once”:
   * - se uid=null => []
   * - se uid=string => getDocumentsOnce
   */
  private onceGuardedQuery(constraints: any[]): Observable<IUserDados[]> {
    return this.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) return of([]);

        return this.read.getDocumentsOnce<IUserDados>(
          'users',
          constraints,
          { mapIdField: 'uid', useCache: true, cacheTTL: 60_000 }
        ).pipe(
          catchError((err) => this.firestoreError.handleFirestoreError(err))
        );
      })
    );
  }

  // --------------------------------------------------------------------------
  // API pública (mantém nomenclaturas originais)
  // --------------------------------------------------------------------------

  /** Realtime: usuários online (compatível com isOnline do PresenceService) */
  getOnlineUsers$(): Observable<IUserDados[]> {
    // ✅ um único stream compartilhado, sem abrir listener duplicado
    return this.liveGuardedQuery([where('isOnline', '==', true)]).pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /** One-shot: usuários online */
  getOnlineUsersOnce$(): Observable<IUserDados[]> {
    return this.onceGuardedQuery([where('isOnline', '==', true)]);
  }

  /** Realtime: online por município */
  getOnlineUsersByRegion$(municipio: string): Observable<IUserDados[]> {
    const m = (municipio ?? '').trim();
    if (!m) return of([]);

    // memo por município (evita abrir listener repetido em múltiplas telas)
    const cached = this.onlineByRegionMemo.get(m);
    if (cached) return cached;

    const stream$ = this.liveGuardedQuery([
      where('municipio', '==', m),
      where('isOnline', '==', true),
    ]).pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.onlineByRegionMemo.set(m, stream$);
    return stream$;
  }

  /**
   * Realtime: “recentemente online” baseado em lastSeen
   *
   * ⚠️ Observação importante:
   * - O where('lastSeen','>=', Timestamp) só retorna documentos cujo lastSeen é Timestamp.
   * - Se parte do seu banco estiver com lastSeen como number, esses docs não entram nessa query.
   * - Em “plataforma grande”, presença normalmente padroniza lastSeen como Timestamp (serverTimestamp).
   */
  getRecentlyOnline$(windowMs = 45_000): Observable<IUserDados[]> {
    const w = Math.max(5_000, Math.floor(windowMs)); // evita valores bizarros
    const cached = this.recentlyOnlineMemo.get(w);
    if (cached) return cached;

    // “cushion” para não perder quem atualizou por latência/clock drift
    const lookbackMs = Math.max(w, 120_000); // 2min mínimo
    const queryCutoff = Timestamp.fromMillis(Date.now() - lookbackMs);

    const stream$ = this.liveGuardedQuery([
      where('lastSeen', '>=', queryCutoff),
    ]).pipe(
      map((list) => {
        const cutoff = Date.now() - w;
        return (list ?? []).filter((u) => this.toLastSeenMs(u) >= cutoff);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.recentlyOnlineMemo.set(w, stream$);
    return stream$;
  }
}/* Linha 180 - Há métodos aqui que não seja tão específicos de presença?
 ***** Sempre considera que existe o auth/presence.service.ts *****
 AuthSession manda no UID
/*CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
Compatibilizar o estado online do usuário com o presence.service e aproximar do funcionamento ideal
deixar explícito que é Firebase/AngularFire e o que é NgRx
// privilegiar observables e evitar arquivos mistos e gigantes, bucando especialização
*/

