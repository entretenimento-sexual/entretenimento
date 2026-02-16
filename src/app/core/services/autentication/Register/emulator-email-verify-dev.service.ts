//src\app\core\services\autentication\register\emulator-email-verify-dev.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Auth } from '@angular/fire/auth';

import { Observable, from, map, switchMap, catchError, throwError } from 'rxjs';

import { environment } from 'src/environments/environment';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class EmulatorEmailVerifyDevService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: Auth,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) { }

  /**
   * DEV-ONLY: marca emailVerified=true diretamente no Auth Emulator.
   * Isso altera o estado do usuário no emulator e aparece no Emulator UI.
   */
  markVerifiedInEmulator$(): Observable<void> {
    // hard-gate: nunca deixa rodar fora do emulador
       if(environment.useEmulators !== true || environment.env !== 'dev-emu') {
      return throwError(() => new Error('DEV_ONLY: EmulatorEmailVerifyDevService'));
    }

    const authEmu = environment.emulators?.auth;
    if (!authEmu) {
      return throwError(() => new Error('DEV_ONLY: Missing auth emulator config'));
    }

    const user = this.auth.currentUser;
    if (!user) return throwError(() => new Error('NO_AUTH_SESSION'));

    const { host, port } = authEmu;

    const url =
      `http://${host}:${port}/identitytoolkit.googleapis.com/v1/accounts:update?key=${environment.firebase.apiKey}`;

    return from(user.getIdToken(true)).pipe(
      switchMap((idToken) =>
        this.http.post<any>(url, { idToken, emailVerified: true, returnSecureToken: true })
      ),
      switchMap(() => from(user.reload())),
      switchMap(() => from(user.getIdToken(true))),
      map(() => void 0),
      catchError((err) => {
        try {
          this.globalErrorHandler.handleError(
            new Error(`[EmulatorEmailVerifyDevService.markVerifiedInEmulator$] ${String(err?.message ?? err)}`)
          );
        } catch { }
        this.errorNotifier.showError('Falha ao marcar e-mail como verificado no emulador.');
        return throwError(() => err);
      })
    );
  }
}
