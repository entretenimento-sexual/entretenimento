// src/app/core/services/data-handling/queries/user-presence.query.service.ts
// Não esqueça dos comentários
import { Injectable, DestroyRef, inject } from '@angular/core';
import { QueryConstraint, Timestamp, where } from 'firebase/firestore';
import { Observable, of, combineLatest, interval } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { UserPublic } from 'src/app/core/interfaces/user-public.interface';
import { FirestoreReadService } from '../firestore/core/firestore-read.service';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

/**
 * ============================================================================
 * CAMADA FIREBASE (Query)
 * - NÃO conhece NgRx (não lê Store, não dispara Actions)
 * - UID vem do AuthSession (fonte da verdade)
 * - NÃO abre listener sem sessão (evita rules/400 em boot deslogado)
 * - Erros passam pelo handler central (FirestoreErrorHandlerService)
 *
 * Filosofia:
 * - "isOnline" é compatibilidade (pode ficar stale quando a aba fecha)
 * - "lastSeen" + janela de tempo é o critério mais confiável para "online efetivo"
 * - Como Firestore não “remove sozinho” docs por tempo, aplicamos recálculo local (tick)
 * ============================================================================
 */
@Injectable({ providedIn: 'root' })
export class UserPresenceQueryService {
  private readonly destroyRef = inject(DestroyRef);

  private readonly COL = 'presence';

  /**
   * Online efetivo (cliente):
   * - HEARTBEAT do PresenceService é 30s
   * - window ~ 75s dá folga pra jitter/rede/GC
   * Ajuste conforme telemetria do seu app.
   */
  private static readonly ONLINE_WINDOW_MS = 75_000;

  /**
   * Tick local para reavaliar "lastSeen":
   * - essencial para a UI atualizar mesmo quando ninguém escreve mais no Firestore
   * - sem isso, o usuário pode ficar “online” na tela indefinidamente
   */
  private static readonly RECALC_TICK_MS = 5_000;

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
  ) {
    /**
     * Higiene:
     * - ao deslogar (uid=null), limpamos memos
     * - evita guardar streams “velhos” de um usuário em singleton root
     */
    this.uid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        if (!uid) {
          this.onlineByRegionMemo.clear();
          this.recentlyOnlineMemo.clear();
        }
      });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Converte lastSeen (Timestamp | number | Date | etc) para epoch(ms) */
  private toLastSeenMs(u: any): number {
    const t = u?.lastSeen;
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (t instanceof Date) return t.getTime();
    if (t instanceof Timestamp) return t.toMillis();
    if (typeof t?.toMillis === 'function') return t.toMillis();
    if (typeof t?.toDate === 'function') {
      const d = t.toDate();
      if (d instanceof Date) return d.getTime();
    }
    const d = new Date(t);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  /**
   * Adapter LEGACY (não é 100% “presença”):
   * - Isso é mais “mapeamento de modelo” (UserPublic -> IUserDados)
   * - Se você quiser, dá pra extrair pra um "UserModelAdapterService" / utils,
   *   e reutilizar também no user-discovery.query.service.ts
   */
  private toUserDadosPublic(u: UserPublic): IUserDados {
    return {
      uid: u.uid,
      nickname: u.nickname ?? null,
      photoURL: (u.avatarUrl ?? (u as any).photoURL) ?? null,

      role: u.role ?? 'basic',
      gender: (u as any).gender ?? null,
      age: (u as any).age ?? null,
      orientation: (u as any).orientation ?? null,
      municipio: u.municipio ?? null,
      estado: u.estado ?? null,

      isOnline: !!u.isOnline,
      lastSeen: (u as any).lastSeen ?? null,
      lastOnlineAt: (u as any).lastOnlineAt ?? null,
      lastOfflineAt: (u as any).lastOfflineAt ?? null,

      latitude: (u as any).latitude ?? null,
      longitude: (u as any).longitude ?? null,
      geohash: (u as any).geohash ?? null,
    } as unknown as IUserDados;
  }

  /**
   * Filtro de "online efetivo":
   * - remove stale online (isOnline pode ficar true quando tab fecha)
   * - mantém "away" como online (compat) porque no writer isOnline=true quando away
   */
  private filterEffectiveOnline(list: IUserDados[], windowMs: number): IUserDados[] {
    const cutoff = Date.now() - windowMs;
    return (list ?? []).filter((u: any) => this.toLastSeenMs(u) >= cutoff);
  }//150linhas

  /**
   * Guard reativo:
   * - se uid=null => retorna [] e NÃO cria listener
   * - se uid=string => executa query live
   *
   * Opcional:
   * - recalcEveryMs: força re-emissão periódica (UI atualiza por tempo)
   */
  private liveGuardedQuery(
    constraints: QueryConstraint[],
    opts?: { recalcEveryMs?: number }
  ): Observable<IUserDados[]> {
    return this.uid$.pipe(
      switchMap((uid) => {
        if (!uid) return of([]);

        const live$ = this.read.getDocumentsLive<IUserDados>(
          this.COL,
          constraints,
          { idField: 'uid', useCache: true, cacheTTL: 60_000 }
        ).pipe(
          catchError((err) => this.firestoreError.handleFirestoreError(err))
        );

        const tickMs = opts?.recalcEveryMs ?? 0;
        if (!tickMs) return live$;

        // ✅ reemite a "lista atual" periodicamente, mesmo sem mudança no snapshot
        return combineLatest([
          live$,
          interval(tickMs).pipe(startWith(0)),
        ]).pipe(map(([list]) => list ?? []));
      })
    );
  }

  /**
   * Guard “once”:
   * - se uid=null => []
   * - se uid=string => getDocumentsOnce
   */
  private onceGuardedQuery(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.uid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) return of([]);

        return this.read.getDocumentsOnce<IUserDados>(
          this.COL,
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

  /**
   * Realtime: usuários “online” (compatível com isOnline, mas corrigido por lastSeen)
   *
   * Por quê isso existe?
   * - Seu PresenceWriter mantém isOnline por compatibilidade, mas ele pode ficar stale
   * - lastSeen é o que realmente expira “online” quando não há mais heartbeats
   */
  getOnlineUsers$(): Observable<IUserDados[]> {
    return this.liveGuardedQuery(
      [where('isOnline', '==', true)],
      { recalcEveryMs: UserPresenceQueryService.RECALC_TICK_MS }
    ).pipe(
      map((list) => this.filterEffectiveOnline(list, UserPresenceQueryService.ONLINE_WINDOW_MS)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /** One-shot: usuários online (mesma regra do realtime, mas sem recálculo periódico) */
  getOnlineUsersOnce$(): Observable<IUserDados[]> {
    return this.onceGuardedQuery([where('isOnline', '==', true)]).pipe(
      map((list) => this.filterEffectiveOnline(list, UserPresenceQueryService.ONLINE_WINDOW_MS))
    );
  }

  /**
   * Realtime: online por município
   *
   * Observação:
   * - Firestore vai exigir índice composto (municipio + isOnline) se crescer.
   * - E ainda assim filtramos por lastSeen no cliente para evitar “stale online”.
   */
  getOnlineUsersByRegion$(municipio: string): Observable<IUserDados[]> {
    const m = (municipio ?? '').trim();
    if (!m) return of([]);

    const cached = this.onlineByRegionMemo.get(m);
    if (cached) return cached;

    const stream$ = this.liveGuardedQuery(
      [where('municipio', '==', m), where('isOnline', '==', true)],
      { recalcEveryMs: UserPresenceQueryService.RECALC_TICK_MS }
    ).pipe(
      map((list) => this.filterEffectiveOnline(list, UserPresenceQueryService.ONLINE_WINDOW_MS)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.onlineByRegionMemo.set(m, stream$);
    return stream$;
  }

  /**
   * Realtime: “recentemente online” baseado em lastSeen
   *
   * ⚠️ Importante:
   * - O where('lastSeen','>=', Timestamp) só retorna docs cujo lastSeen é Timestamp.
   * - Seu PresenceWriter padroniza lastSeen com serverTimestamp(), então o ideal é:
   *   presença sempre como Timestamp no Firestore.
   *
   * Por que existe lookbackMs maior que windowMs?
   * - Firestore query usa um cutoff fixo no momento da inscrição do listener.
   * - Para permitir “tempo correr” sem reabrir listener, usamos lookback maior
   *   e filtramos localmente por window (com tick).
   */
  getRecentlyOnline$(windowMs = 45_000): Observable<IUserDados[]> {
    const w = Math.max(5_000, Math.floor(windowMs));

    const cached = this.recentlyOnlineMemo.get(w);
    if (cached) return cached;

    const lookbackMs = Math.max(w, 120_000);
    const queryCutoff = Timestamp.fromMillis(Date.now() - lookbackMs);

    const stream$ = this.liveGuardedQuery(
      [where('lastSeen', '>=', queryCutoff)],
      { recalcEveryMs: UserPresenceQueryService.RECALC_TICK_MS }
    ).pipe(
      map((list) => {
        const cutoff = Date.now() - w;
        return (list ?? []).filter((u) => this.toLastSeenMs(u) >= cutoff);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.recentlyOnlineMemo.set(w, stream$);
    return stream$;
  }
}

/*
Linha ~180 - Perguntas/Notas (respondendo diretamente):

1) "Há métodos aqui que não seja tão específicos de presença?"
   - Sim:
     - toUserDadosPublic() é mais “adapter/mapeamento de modelo” do que presença.
       Ideal extrair para um serviço/utility de mapeamento de usuário e reutilizar
       no user-discovery.query.service.ts.
     - toLastSeenMs() também é utilitário genérico (pode ir para utils/time-utils).

2) "É assim que funcionam as grandes plataformas?"
   - O desenho (writer/orquestrador + query + multi-aba leader) é bem alinhado.
   - O que plataformas “grandes” fazem diferente:
     - presença costuma ser RTDB/WebSocket (latência menor e TTL natural),
       e Firestore fica mais para dados de perfil/descoberta.
     - Quando usam Firestore, lastSeen + janela + recálculo local é obrigatório
       para não “congelar online” na UI.

3) "Compatibilizar o estado online com o presence.service e aproximar do ideal"
   - Feito:
     - getOnlineUsers$ mantém isOnline como filtro “compat”, mas valida lastSeen
       (porque isOnline pode ficar stale quando o tab fecha).
     - Tick local garante que a UI reflita expiração por tempo.

4) "deixar explícito Firebase/AngularFire vs NgRx"
   - Este serviço é Query Firebase (FirestoreReadService por baixo).
   - Não lê Store, não depende de CurrentUserStore. UID é AuthSession.

5) "privilegiar observables e evitar arquivos gigantes"
   - Mantive API pública pequena.
   - Se quiser especializar mais: extrair adapters (toLastSeenMs/toUserDadosPublic)
     para utils/services dedicados, e manter aqui só política de presença (queries).
*/
