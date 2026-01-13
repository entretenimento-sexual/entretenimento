//src\app\core\services\presence\presence-writer.service.ts
import { Injectable } from '@angular/core';
import { Firestore, doc, updateDoc, setDoc, serverTimestamp as afServerTimestamp} from '@angular/fire/firestore';
import { EMPTY, Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

/**
 * ============================================================================
 * CAMADA FIREBASE (write)
 * - NÃO conhece NgRx
 * - escreve presença com robustez (update + seed on NOT_FOUND)
 * - erros são SILENCIOSOS (observabilidade) via GlobalErrorHandlerService
 * ============================================================================
 */

type PresencePublicPatch = Partial<{
  nickname: string | null;
  municipio: string | null;
  estado: string | null;
  photoURL: string | null;
  latitude: number | null;
  longitude: number | null;
}>;

export type PresenceState = 'online' | 'away' | 'offline';

@Injectable({ providedIn: 'root' })
export class PresenceWriterService {
  /**
   * Compatibilidade:
   * enquanto a app usa where('isOnline','==',true), mantemos este campo.
   */
  private static readonly KEEP_ISONLINE_COMPAT = true;

  private readonly tabId = this.createTabId();

  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /** Batida normal (heartbeat) */
  beatOnline$(uid: string): Observable<void> {
    return this.writePresence$(uid, 'online', {}, { mode: 'heartbeat' });
  }

  /** Evento explícito de volta/online (opcionalmente marca lastOnlineAt) */
  setOnline$(uid: string): Observable<void> {
    return this.writePresence$(uid, 'online', {}, { mode: 'state' });
  }

  /** Aba oculta / inatividade visual */
  setAway$(uid: string): Observable<void> {
    return this.writePresence$(uid, 'away', {}, { mode: 'state' });
  }

  /** Encerramento best-effort */
  setOffline$(uid: string, _reason: string): Observable<void> {
    // reason: melhor NÃO persistir em /presence (coleção legível por qualquer signedIn).
    return this.writePresence$(uid, 'offline', {}, { mode: 'state' });
  }

  /** opcional: quando você souber nickname/coords/municipio, patcha presença */
  patchPublic$(uid: string, patch: PresencePublicPatch): Observable<void> {
    // ✅ não força mudança de estado; só atualiza “public fields”
    return this.writePresence$(uid, 'online', patch, { mode: 'public' });
  }

  /**
   * Core:
   * - lastSeen SEMPRE serverTimestamp() (padroniza para Timestamp no Firestore)
   * - presenceSessionId por aba (tabId)
   * - updateDoc, e se NOT_FOUND: setDoc merge como seed
   */
  private writePresence$(
    uid: string,
    state: PresenceState,
    extra: Record<string, unknown>,
    opts: { mode: 'heartbeat' | 'state' | 'public' }
  ): Observable<void> {
    const cleanUid = (uid ?? '').trim();
    if (!cleanUid) return EMPTY;

    const eventStamps =
      opts.mode === 'state'
        ? {
          lastStateChangeAt: afServerTimestamp(),
          ...(state === 'online' ? { lastOnlineAt: afServerTimestamp() } : {}),
          ...(state === 'offline' ? { lastOfflineAt: afServerTimestamp() } : {}),
        }
        : {};

    const base: Record<string, unknown> = {
      uid: cleanUid,
      presenceSessionId: this.tabId,
      lastSeen: afServerTimestamp(),
      updatedAt: afServerTimestamp(),
      ...eventStamps,
      ...extra,
    };

    // ✅ mesmo em public, NÃO precisa “mudar estado” se o doc já existir,
    // mas as rules exigem presenceState existir no doc final.
    // Para updateDoc, request.resource.data inclui o doc final (merge com o existente).
    // Para seed (NOT_FOUND), precisamos garantir os campos obrigatórios.
    const patchForUpdate =
      opts.mode === 'public'
        ? base
        : {
          ...base,
          presenceState: state,
          ...(PresenceWriterService.KEEP_ISONLINE_COMPAT ? { isOnline: state !== 'offline' } : {}),
        };

    return this.ctx
      .deferPromise$(() => {
        // ✅ doc() dentro do Injection Context
        const ref = this.ctx.run(() => doc(this.db, 'presence', cleanUid));

        return updateDoc(ref, patchForUpdate as any).catch((err: any) => {
          if (!this.isNotFound(err)) throw err;

          // ✅ seed precisa PASSAR NAS RULES (isOnline + presenceState + timestamps)
          // Aqui faz sentido assumir "online" ao criar doc, porque o patchPublic$ só roda com sessão ativa.
          const seed = {
            uid: cleanUid,
            presenceSessionId: this.tabId,
            isOnline: true,
            presenceState: 'online',
            lastSeen: afServerTimestamp(),
            updatedAt: afServerTimestamp(),
            ...extra,
          };

          return setDoc(ref, seed as any, { merge: true }); //Linha 127
        });
      })
      .pipe(
        map(() => void 0),
        catchError((err) => {
          this.reportPresenceError(err, { uid: cleanUid, state, payload: patchForUpdate });
          return EMPTY;
        })
      );
  }

  private isNotFound(err: any): boolean {
    const code = err?.code ?? err?.message ?? '';
    return String(code).includes('not-found') || String(code).includes('NOT_FOUND');
  }

  private reportPresenceError(err: any, context: any): void {
    try {
      const e = new Error('[PresenceWriterService] Firestore presence update failed');
      (e as any).silent = true;
      (e as any).feature = 'presence';
      (e as any).original = err;
      (e as any).context = context;
      (this.globalErrorHandler as any)?.handleError?.(e);
    } catch { }
  }

  private createTabId(): string {
    try {
      // @ts-ignore
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
      return id || `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    } catch {
      return `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }
  }
}//linha 149
// ***** Sempre considerar que existe no projeto o user-presence.query.service.ts *****
// ***** Sempre considerar que existe no projeto o user-discovery.query.service.ts
// ***** Sempre considerar que existe o presence\presence-dom-streams.service.ts *****
// ***** Sempre considerar que existe o data-handling/firestore-user-write.service.ts *****
// ***** Sempre considerar que existe o data-handling/firestore-user-query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-discovery.query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-presence.query.service.ts *****
// ***** Sempre considerar que existe o autentication/auth/current-user-store.service.ts *****
