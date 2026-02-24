// src/app/core/services/autentication/register/emulator-email-verify-dev.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Auth } from '@angular/fire/auth';

import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, take, tap, timeout } from 'rxjs/operators';

import { environment } from 'src/environments/environment';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

type OobCodeItem = {
  email?: string;
  oobCode?: string;
  oobLink?: string;
  requestType?: string; // "VERIFY_EMAIL"
};

type OobCodesResponse = {
  oobCodes?: OobCodeItem[];
};

export type EmuVerifyDebugResult = {
  ok: boolean;
  traceId: string;

  uid: string;
  email: string;

  listOob: {
    url: string;
    httpStatus?: number;
    total?: number;
    filteredVerifyEmail?: number;
    filteredByEmail?: number;
    picked?: { requestType?: string; email?: string; oobCodeMasked?: string; hasLink?: boolean };
  };

  apply: {
    url: string;
    httpStatus?: number;
    // apenas flags úteis (sem vazar tokens)
    applied?: boolean;
  };

  after: {
    emailVerified: boolean;
  };

  note?: string;
};

@Injectable({ providedIn: 'root' })
export class EmulatorEmailVerifyDevService {
  private readonly NET_TIMEOUT_MS = 12_000;
  private readonly debug = !environment.production && environment.enableDebugTools === true;
  private lastNotifyAt = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly auth: Auth,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) { }

  /**
   * ✅ Compat: mantém assinatura antiga.
   * Internamente executa o fluxo “debug” e descarta o payload.
   */
  markVerifiedInEmulator$(): Observable<void> {
    return this.markVerifiedInEmulatorDebug$().pipe(map(() => void 0));
  }

  /**
   * DEV-ONLY (Auth Emulator) — DEBUG:
   * - Lista oobCodes do emulator
   * - Pega o VERIFY_EMAIL mais recente do e-mail atual
   * - Aplica o oobCode via accounts:update
   * - reload() e valida emailVerified=true
   */
  markVerifiedInEmulatorDebug$(): Observable<EmuVerifyDebugResult> {
    return defer(() => {
      if (environment.useEmulators !== true || environment.env !== 'dev-emu') {
        return throwError(() => this.mkErr('DEV_ONLY: EmulatorEmailVerifyDevService', 'dev-only'));
      }

      const authEmu = environment.emulators?.auth;
      if (!authEmu?.host || !authEmu?.port) {
        return throwError(() => this.mkErr('DEV_ONLY: Missing auth emulator config', 'missing-auth-emu'));
      }

      const projectId = environment.firebase?.projectId;
      if (!projectId) {
        return throwError(() => this.mkErr('DEV_ONLY: Missing firebase.projectId', 'missing-projectId'));
      }

      const user = this.auth.currentUser;
      if (!user?.uid) {
        return throwError(() => this.mkErr('NO_AUTH_SESSION', 'no-auth-session'));
      }

      const email = (user.email ?? '').trim();
      if (!email) {
        return throwError(() => this.mkErr('NO_EMAIL_ON_SESSION', 'no-email'));
      }

      const traceId = this.makeTraceId();
      const { host, port } = authEmu;

      const listOobUrl = `http://${host}:${port}/emulator/v1/projects/${encodeURIComponent(projectId)}/oobCodes`;
      const applyUrl =
        `http://${host}:${port}/identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(environment.firebase.apiKey)}`;

      const baseResult: EmuVerifyDebugResult = {
        ok: false,
        traceId,
        uid: user.uid,
        email,
        listOob: { url: listOobUrl },
        apply: { url: applyUrl },
        after: { emailVerified: false },
      };

      this.dbg(traceId, 'start', { uid: user.uid, email, listOobUrl, applyUrl });

      // 1) lista oobCodes
      return this.http.get<OobCodesResponse>(listOobUrl, { observe: 'response' }).pipe(
        timeout({ each: this.NET_TIMEOUT_MS }),
        tap((res: HttpResponse<OobCodesResponse>) => {
          this.dbg(traceId, 'oobCodes:list:http', { status: res.status });
        }),
        map((res: HttpResponse<OobCodesResponse>) => {
          const items = (res.body?.oobCodes ?? []) as OobCodeItem[];
          const verifyOnly = items.filter(x => (x?.requestType ?? '').toUpperCase() === 'VERIFY_EMAIL');
          const byEmail = verifyOnly.filter(x => (x?.email ?? '').trim().toLowerCase() === email.toLowerCase());

          const picked = byEmail.length ? byEmail[byEmail.length - 1] : null;

          const out: EmuVerifyDebugResult = {
            ...baseResult,
            listOob: {
              ...baseResult.listOob,
              httpStatus: res.status,
              total: items.length,
              filteredVerifyEmail: verifyOnly.length,
              filteredByEmail: byEmail.length,
              picked: picked ? {
                requestType: picked.requestType,
                email: picked.email,
                oobCodeMasked: picked.oobCode ? this.mask(picked.oobCode) : undefined,
                hasLink: !!picked.oobLink,
              } : undefined,
            }
          };

          return { out, picked };
        }),

        // 2) aplica oobCode
        switchMap(({ out, picked }) => {
          if (!picked?.oobCode) {
            const note =
              'Nenhum oobCode VERIFY_EMAIL pendente para este e-mail. ' +
              'Clique em “Reenviar e-mail” e tente novamente.';
            this.dbg(traceId, 'oobCodes:none', { note, list: out.listOob });
            return of({ out: { ...out, note }, applied: false });
          }

          this.dbg(traceId, 'accounts:update(oobCode):request', {
            url: applyUrl,
            oobCode: this.mask(picked.oobCode),
          });

          return this.http.post<any>(applyUrl, { oobCode: picked.oobCode }, { observe: 'response' }).pipe(
            timeout({ each: this.NET_TIMEOUT_MS }),
            tap((res: HttpResponse<any>) => {
              this.dbg(traceId, 'accounts:update(oobCode):http', { status: res.status });
            }),
            map((res: HttpResponse<any>) => {
              const out2: EmuVerifyDebugResult = {
                ...out,
                apply: { ...out.apply, httpStatus: res.status, applied: true },
              };
              return { out: out2, applied: true };
            }),
            catchError((err) => {
              const out2: EmuVerifyDebugResult = {
                ...out,
                apply: { ...out.apply, applied: false },
                note: 'Falha no accounts:update(oobCode). Veja Network.',
              };
              return throwError(() => this.attachTrace(err, traceId, out2));
            })
          );
        }),

        // 3) reload + valida
        switchMap(({ out }) =>
          from(user.reload()).pipe(
            timeout({ each: this.NET_TIMEOUT_MS }),
            map(() => {
              const cu = this.auth.currentUser;
              const verified = !!cu?.emailVerified;

              const out2: EmuVerifyDebugResult = {
                ...out,
                after: { emailVerified: verified },
                ok: verified === true,
                note: verified ? out.note : (out.note ?? 'Aplicou oobCode, mas emailVerified ainda não refletiu após reload.'),
              };

              this.dbg(traceId, 'user.reload():ok', { emailVerified: verified });
              this.dbg(traceId, 'done', { ok: out2.ok, note: out2.note });

              return out2;
            })
          )
        ),

        catchError((err) => {
          this.routeError(err, 'EmulatorEmailVerifyDevService.markVerifiedInEmulatorDebug$');
          this.notifyOnce('Falha ao marcar e-mail como verificado no emulador.');
          return throwError(() => err);
        }),

        take(1)
      );
    });
  }

  // -------------------------------------------------------
  // Erro central + debug
  // -------------------------------------------------------
  private dbg(traceId: string, msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[EmulatorEmailVerifyDevService][${traceId}] ${msg}`, extra ?? '');
  }

  private routeError(err: unknown, context: string): void {
    try {
      const e = err instanceof Error ? err : new Error(String(err));
      (e as any).silent = true;
      (e as any).context = context;
      (e as any).original = err;
      this.globalErrorHandler.handleError(e);
    } catch { /* noop */ }
  }

  private notifyOnce(msg: string): void {
    const now = Date.now();
    if (now - this.lastNotifyAt < 15_000) return;
    this.lastNotifyAt = now;
    this.errorNotifier.showError(msg);
  }

  private makeTraceId(): string {
    const r = Math.random().toString(16).slice(2, 8);
    return `emu_verify_${Date.now().toString(16)}_${r}`;
  }

  private mkErr(message: string, code: string): Error {
    const e: any = new Error(message);
    e.code = code;
    return e as Error;
  }

  private mask(v: string): string {
    const s = String(v ?? '');
    if (s.length <= 8) return '****';
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  private attachTrace(err: any, traceId: string, payload?: any): any {
    try {
      (err as any).traceId = traceId;
      if (payload) (err as any).emuPayload = payload;
    } catch { /* noop */ }
    return err;
  }
}// linha 282
