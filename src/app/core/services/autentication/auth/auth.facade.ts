//src\app\core\services\autentication\auth\auth.facade.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';
import type { UserCredential } from 'firebase/auth';

import { RegisterService } from '../register/register.service';
import { EmailVerificationService, VerifyEmailResult } from '../register/email-verification.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

export interface RegisterFacadeResult {
  success: boolean;
  credential?: UserCredential;
  needsEmailVerification: boolean;
  message?: string;
  code?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthFacade {
  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  constructor(
    private readonly registerService: RegisterService,
    private readonly emailVerification: EmailVerificationService,
  ) { }

  register$(user: IUserRegistrationData, password: string): Observable<RegisterFacadeResult> {
    this.loadingSubject.next(true);
    return this.registerService.registerUser(user, password).pipe(
      map((credential) => ({
        success: true,
        credential,
        needsEmailVerification: true,
      })),
      catchError((err: any) =>
        of({
          success: false,
          needsEmailVerification: false,
          code: err?.code,
          message: err?.message || 'Não foi possível concluir o registro.',
        })
      ),
      finalize(() => this.loadingSubject.next(false))
    );
  }

  resendVerificationEmail$(): Observable<string> {
    this.loadingSubject.next(true);
    return this.emailVerification.resendVerificationEmail().pipe(
      finalize(() => this.loadingSubject.next(false))
    );
  }

  handleEmailVerification$(): Observable<VerifyEmailResult> {
    this.loadingSubject.next(true);
    return this.emailVerification.handleEmailVerification().pipe(
      finalize(() => this.loadingSubject.next(false))
    );
  }
}
/*
(1) fonte única,
(2) hidratação / limpeza automática,
(3) gating de listeners realtime,
(4) observabilidade + erro centralizado.

AuthSessionService como dono do UID
authState(this.auth).pipe(shareReplay…) + uid$ com distinctUntilChanged()
é o padrão certo: um stream, replayado, barato, e “sempre igual”.

CurrentUserStoreService como dono do IUserDados
Ter BehaviorSubject<IUserDados | null | undefined> é ótimo porque:

undefined = “ainda não hidratei”
null = “não logado”
objeto = “logado e com perfil carregado”

Restore seguro
restoreFromCache() comparando UID do auth.currentUser?.uid com o UID persistido
é exatamente o tipo de “não confie no storage” que se vê em produção.
Gating na header (LinksInteraction)
O canListen$ com emailVerified === true + fora do fluxo de registro evita exatamente
os 400 (Bad Request) / listeners indevidos antes do usuário estar pronto.
 */
