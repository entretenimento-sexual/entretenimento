// src/app/core/services/presence/presence-writer.service.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp as afServerTimestamp
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { EMPTY, Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

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
   * Compatibilidade com codebase antigo (ex.: filtros, queries ou UI que ainda lê isOnline).
   * Em plataformas grandes é comum manter campos “legados” por um tempo e remover depois.
   */
  private static readonly KEEP_ISONLINE_COMPAT = true;

  /**
   * Identificador por aba/sessão para distinguir batimentos simultâneos do mesmo uid.
   * (Útil para diagnósticos e prevenção de sobrescrita indevida.)
   */
  private readonly tabId = this.createTabId();

  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly auth: Auth
  ) { }

  beatOnline$(uid: string): Observable<void> {
    return this.writePresence$(uid, 'online', {}, { mode: 'heartbeat' });
  }

  setOnline$(uid: string): Observable<void> {
    return this.writePresence$(uid, 'online', {}, { mode: 'state' });
  }

  setAway$(uid: string): Observable<void> {
    return this.writePresence$(uid, 'away', {}, { mode: 'state' });
  }

  setOffline$(uid: string, _reason: string): Observable<void> {
    // Mantém assinatura (compat). Não persistimos reason por privacidade/ruído.
    return this.writePresence$(uid, 'offline', {}, { mode: 'state' });
  }

  patchPublic$(uid: string, patch: PresencePublicPatch): Observable<void> {
    return this.writePresence$(uid, 'online', patch, { mode: 'public' });
  }

  /**
   * Upsert explícito (uso pontual).
   * ✅ Corrigido: todas as factories do AngularFire (doc/serverTimestamp/setDoc)
   * nascem dentro do Injection Context (ctx.deferPromise$).
   */
  upsertOnlinePresence$(uid: string, sessionId: string): Observable<void> {
    const cleanUid = (uid ?? '').trim();
    if (!cleanUid) return EMPTY;

    return this.ctx.deferPromise$(() => {
      // IMPORTANTE:
      // Tudo aqui dentro roda dentro do Injection Context por causa do deferPromise$.
      const ref = doc(this.db, `presence/${cleanUid}`);

      return setDoc(
        ref,
        {
          uid: cleanUid,
          presenceSessionId: sessionId,
          presenceState: 'online',
          isOnline: true,
          lastSeen: afServerTimestamp(),
          updatedAt: afServerTimestamp(),
          lastStateChangeAt: afServerTimestamp(),
          lastOnlineAt: afServerTimestamp(),
        } as any,
        { merge: true }
      );
    }).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportPresenceError(err, {
          uid: cleanUid,
          state: 'online',
          mode: 'upsertOnlinePresence$',
        });
        return EMPTY;
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Core writer
  // ---------------------------------------------------------------------------

  private writePresence$(
    uid: string,
    state: PresenceState,
    extra: Record<string, unknown>,
    opts: { mode: 'heartbeat' | 'state' | 'public' }
  ): Observable<void> {
    const cleanUid = (uid ?? '').trim();
    if (!cleanUid) return EMPTY;

    return this.ctx.deferPromise$(() => {
      const ref = doc(this.db, 'presence', cleanUid);

      /**
       * Stamps de evento só fazem sentido quando estamos mudando "state".
       * - Em 'public', não deve alterar lastSeen/presenceState/isOnline.
       */
      const eventStamps =
        opts.mode === 'state'
          ? {
            lastStateChangeAt: afServerTimestamp(),
            ...(state === 'online' ? { lastOnlineAt: afServerTimestamp() } : {}),
            ...(state === 'offline' ? { lastOfflineAt: afServerTimestamp() } : {}),
          }
          : {};

      /**
       * Base comum:
       * - 'public': apenas metadados + campos públicos
       * - 'heartbeat/state': inclui telemetria da sessão (lastSeen/sessionId)
       */
      const baseCommon: Record<string, unknown> = {
        uid: cleanUid,
        updatedAt: afServerTimestamp(),
        ...extra,
      };

      const basePresence: Record<string, unknown> = {
        ...baseCommon,
        presenceSessionId: this.tabId,
        lastSeen: afServerTimestamp(),
        ...eventStamps,
      };

      const patchForUpdate =
        opts.mode === 'public'
          ? baseCommon
          : {
            ...basePresence,
            presenceState: state,
            ...(PresenceWriterService.KEEP_ISONLINE_COMPAT
              ? { isOnline: state !== 'offline' }
              : {}),
          };

      return updateDoc(ref, patchForUpdate as any).catch((err: any) => {
        if (!this.isNotFound(err)) throw err;

        /**
         * Se o doc não existe:
         * - 'public': cria doc mínimo SEM declarar online/offline
         * - 'heartbeat/state': cria doc completo com estado e telemetria
         */
        return this.ctx.run(() => {
          const seed =
            opts.mode === 'public'
              ? {
                uid: cleanUid,
                presenceSessionId: this.tabId,

                // cria como OFFLINE (não “declara” online)
                presenceState: 'offline',
                ...(PresenceWriterService.KEEP_ISONLINE_COMPAT ? { isOnline: false } : {}),

                // telemetria mínima para satisfazer schema
                lastSeen: afServerTimestamp(),
                updatedAt: afServerTimestamp(),

                // opcional: carimba primeiro estado como offline
                lastStateChangeAt: afServerTimestamp(),
                lastOfflineAt: afServerTimestamp(),

                // campos públicos do patch
                ...extra,
              }
              : {
                uid: cleanUid,
                presenceSessionId: this.tabId,
                presenceState: state,
                ...(PresenceWriterService.KEEP_ISONLINE_COMPAT
                  ? { isOnline: state !== 'offline' }
                  : {}),
                lastSeen: afServerTimestamp(),
                updatedAt: afServerTimestamp(),
                ...eventStamps,
                ...extra,
              };

          return setDoc(ref, seed as any, { merge: true });
        });
      });
    }).pipe(
      map(() => void 0),
      catchError((err) => {
        if (this.shouldSuppressPermissionDenied(err, cleanUid)) return EMPTY;

        this.reportPresenceError(err, { uid: cleanUid, state, mode: opts.mode });
        return EMPTY;
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Error classification
  // ---------------------------------------------------------------------------

  private isNotFound(err: any): boolean {
    const code = err?.code ?? err?.message ?? '';
    return String(code).includes('not-found') || String(code).includes('NOT_FOUND');
  }

  private isPermissionDenied(err: any): boolean {
    const code = err?.code ?? '';
    const msg = err?.message ?? '';
    const s = `${code} ${msg}`.toLowerCase();
    return s.includes('permission-denied') || s.includes('permission_denied');
  }

  /**
   * Suprime somente o caso “esperado”:
   * - permission-denied + sem sessão atual (logout/troca de conta/token caiu).
   */
  private shouldSuppressPermissionDenied(err: any, uid: string): boolean {
    if (!this.isPermissionDenied(err)) return false;

    /**
     * Caso “esperado”:
     * - token expirou / logout em andamento / troca de conta
     * - currentUser ausente ou não bate com o uid que estamos escrevendo
     */
    const cu = this.auth.currentUser;
    return !cu || cu.uid !== uid;
  }

  private toError(err: unknown, msg: string): Error {
    if (err instanceof Error) return err;
    const anyErr = err as any;
    const detail = typeof anyErr?.message === 'string' ? anyErr.message : String(err);
    const e = new Error(`${msg}${detail ? `: ${detail}` : ''}`);
    (e as any).original = err;
    return e;
  }

  private reportPresenceError(err: unknown, context: any): void {
    try {
      const e = this.toError(err, '[PresenceWriterService] Firestore presence write failed');
      (e as any).silent = true;
      (e as any).feature = 'presence';
      (e as any).context = context;

      // Tratamento centralizado (padrão do seu projeto)
      this.globalErrorHandler.handleError(e);
    } catch { }
  }

  private createTabId(): string {
    try {
      // @ts-ignore
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
      return id || `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    } catch {
      return `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }
  }
} // Linha 276
