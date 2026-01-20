// src/app/core/services/presence/presence-writer.service.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import {
  Firestore, doc, updateDoc, setDoc, serverTimestamp as afServerTimestamp
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
  private static readonly KEEP_ISONLINE_COMPAT = true;
  private readonly tabId = this.createTabId();

  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly auth: Auth, // ✅ permite distinguir "erro real" vs "logout em andamento"
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
    // Mantém API (compat). Não persistimos reason no doc por privacidade/ruído.
    return this.writePresence$(uid, 'offline', {}, { mode: 'state' });
  }

  patchPublic$(uid: string, patch: PresencePublicPatch): Observable<void> {
    return this.writePresence$(uid, 'online', patch, { mode: 'public' });
  }

  /** ✅ mantém seu método, sem runInInjectionContext redundante */
  upsertOnlinePresence$(uid: string, sessionId: string): Observable<void> {
    const cleanUid = (uid ?? '').trim();
    if (!cleanUid) return EMPTY;

    return this.ctx.deferPromise$(() =>
      this.ctx.run(() => {
        const ref = doc(this.db, `presence/${cleanUid}`);

        return setDoc(ref, {
          uid: cleanUid,
          presenceSessionId: sessionId,
          presenceState: 'online',
          isOnline: true,
          lastSeen: afServerTimestamp(),
          updatedAt: afServerTimestamp(),
          lastStateChangeAt: afServerTimestamp(),
          lastOnlineAt: afServerTimestamp(),
        } as any, { merge: true });
      })
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        // aqui é registro explícito do doc, então permission-denied com auth presente é bug.
        this.reportPresenceError(err, { uid: cleanUid, state: 'online', mode: 'upsertOnlinePresence$' });
        return EMPTY;
      })
    );
  }

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

    const patchForUpdate =
      opts.mode === 'public'
        ? base
        : {
          ...base,
          presenceState: state,
          ...(PresenceWriterService.KEEP_ISONLINE_COMPAT ? { isOnline: state !== 'offline' } : {}),
        };

    return this.ctx.deferPromise$(() =>
      this.ctx.run(() => {
        const ref = doc(this.db, 'presence', cleanUid);

        return updateDoc(ref, patchForUpdate as any).catch((err: any) => {
          if (!this.isNotFound(err)) throw err;

          // seed (primeira escrita)
          const seed = {
            uid: cleanUid,
            presenceSessionId: this.tabId,
            isOnline: state !== 'offline',
            presenceState: state,
            lastSeen: afServerTimestamp(),
            updatedAt: afServerTimestamp(),
            ...eventStamps,
            ...extra,
          };

          return setDoc(ref, seed as any, { merge: true });
        });
      })
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        /**
         * ✅ Patch principal:
         * - permission-denied durante logout (ou token já inválido) é esperado e NÃO deve poluir o GlobalErrorHandler.
         * - Mas permission-denied com auth presente continua sendo sinal de bug/regra, então reportamos.
         */
        if (this.shouldSuppressPermissionDenied(err)) {
          return EMPTY;
        }

        this.reportPresenceError(err, { uid: cleanUid, state, payload: patchForUpdate, mode: opts.mode });
        return EMPTY;
      })
    );
  }

  // ---------------------------------------------------------
  // Error classification
  // ---------------------------------------------------------

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
   * - permission-denied + sem sessão atual (logout em andamento / token caiu).
   *
   * Isso resolve o ruído no console do seu log:
   * "FirebaseError: PERMISSION_DENIED: false for 'update' ..."
   */
  private shouldSuppressPermissionDenied(err: any): boolean {
    if (!this.isPermissionDenied(err)) return false;

    // se não há currentUser, o Firestore vai negar update mesmo (regras).
    // e isso acontece durante logout / troca de conta / token inválido.
    const authed = !!this.auth.currentUser;
    return authed === false;
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
} // linha 225
// 225 linhas, parece estar no limite.
// Considerar refatorar se crescer mais.
// ***** Sempre considerar que existe no projeto o presence/presence.service.ts *****
// ***** Sempre considerar que existe no projeto o presence/presence-dom-streams.service.ts *****
// ***** Sempre considerar que existe no projeto o user-presence.query.service.ts *****
// ***** Sempre considerar que existe no projeto o user-discovery.query.service.ts *****
// ***** Não tem no projeto presence/presence-reader.service.ts *****
// ***** Não tem no projeto presence/presence-orchestrator.service.ts *****
// ***** Não tem no projeto presence/presence-cleanup.service.ts *****
// ***** Não tem no projeto presence/presence-status.service.ts *****
// ***** Não tem no projeto presence/presence-initializer.service.ts *****
// ***** Não tem no projeto presence/presence-helpers.service.ts *****
