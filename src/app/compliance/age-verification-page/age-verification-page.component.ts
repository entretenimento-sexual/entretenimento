import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY, Observable, of } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  IUserAgeEligibility,
} from 'src/app/core/interfaces/iuser-dados';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import {
  AgeEligibilityService,
} from 'src/app/core/services/compliance/age-eligibility.service';

interface AgeVerificationPageVm {
  state: IUserAgeEligibility;
  verified: boolean;
  deniedUnderage: boolean;
  reviewRequired: boolean;
  expired: boolean;
}

type FeedbackTone = 'info' | 'success' | 'warning' | 'error';

interface AgeVerificationFeedback {
  tone: FeedbackTone;
  title: string;
  message: string;
}

type VerificationActionResult =
  | 'VERIFIED_ADULT'
  | 'DENIED_UNDERAGE'
  | 'REVIEW_REQUIRED';

@Component({
  selector: 'app-age-verification-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './age-verification-page.component.html',
  styleUrls: ['./age-verification-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgeVerificationPageComponent implements OnInit {
  private readonly ageEligibility = inject(AgeEligibilityService);
  private readonly logout = inject(LogoutService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly processing = signal(false);
  readonly feedback = signal<AgeVerificationFeedback | null>(null);

  readonly vm$: Observable<AgeVerificationPageVm> =
    this.ageEligibility.current$.pipe(
      map((state) => ({
        state,
        verified: state.status === 'VERIFIED_ADULT',
        deniedUnderage: state.status === 'DENIED_UNDERAGE',
        reviewRequired: state.status === 'REVIEW_REQUIRED',
        expired: state.status === 'EXPIRED',
      }))
    );

  ngOnInit(): void {
    this.ageEligibility.verifiedAdult$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((verified) => {
        if (verified) {
          this.continueAfterVerification();
        }
      });
  }

  /**
   * Um único CTA para o usuário:
   * 1. reaproveita silenciosamente qualquer fonte confiável já reconhecida;
   * 2. se ainda não houver prova válida, abre a revisão backend;
   * 3. nunca transforma autodeclaração em autorização.
   */
  verifyNow(): void {
    if (this.processing()) {
      return;
    }

    this.processing.set(true);
    this.feedback.set({
      tone: 'info',
      title: 'Verificando sua conta',
      message:
        'Primeiro vamos procurar uma confirmação confiável que já esteja vinculada à sua conta.',
    });

    this.ageEligibility.refreshTrustedSources$()
      .pipe(
        take(1),
        switchMap((status) => {
          if (status === 'VERIFIED_ADULT') {
            return of<VerificationActionResult>('VERIFIED_ADULT');
          }

          if (status === 'DENIED_UNDERAGE') {
            return of<VerificationActionResult>('DENIED_UNDERAGE');
          }

          if (status === 'REVIEW_REQUIRED') {
            return of<VerificationActionResult>('REVIEW_REQUIRED');
          }

          return this.ageEligibility.requestInitialReview$().pipe(
            map((result) => result.status as VerificationActionResult)
          );
        }),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível continuar',
            message:
              'A verificação não pôde ser iniciada agora. Tente novamente em alguns instantes. Nenhuma solicitação duplicada será criada.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe((result) => this.handleVerificationResult(result));
  }

  requestDecisionReview(): void {
    if (this.processing()) {
      return;
    }

    this.processing.set(true);
    this.feedback.set({
      tone: 'info',
      title: 'Registrando sua contestação',
      message:
        'Vamos reabrir a análise para que uma nova evidência confiável possa ser considerada.',
    });

    this.ageEligibility.requestInitialReview$()
      .pipe(
        take(1),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível registrar a revisão',
            message:
              'Tente novamente em alguns instantes. Se o problema continuar, consulte a área de suporte da conta.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe((result) => this.handleVerificationResult(result.status));
  }

  goToNotifications(): void {
    void this.router.navigate(['/notificacoes']);
  }

  goToAccount(): void {
    void this.router.navigate(['/conta']);
  }

  logoutCurrentSession(): void {
    if (this.processing()) {
      return;
    }

    this.processing.set(true);

    this.logout.logout$()
      .pipe(
        take(1),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível sair da conta',
            message: 'Tente novamente em alguns instantes.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe();
  }

  private handleVerificationResult(result: VerificationActionResult): void {
    if (result === 'VERIFIED_ADULT') {
      this.feedback.set({
        tone: 'success',
        title: 'Maioridade confirmada',
        message: 'Tudo certo. Estamos liberando seu acesso.',
      });
      this.continueAfterVerification();
      return;
    }

    if (result === 'DENIED_UNDERAGE') {
      this.feedback.set({
        tone: 'warning',
        title: 'Acesso adulto não liberado',
        message:
          'A verificação atual não autoriza o acesso adulto. Se a decisão estiver incorreta, você pode solicitar uma nova revisão.',
      });
      return;
    }

    this.feedback.set({
      tone: 'success',
      title: 'Solicitação recebida',
      message:
        'Você não precisa enviar outra solicitação nem ficar atualizando esta página. O status muda automaticamente quando a análise for concluída.',
    });
  }

  private continueAfterVerification(): void {
    const redirectTo =
      this.safeRedirectTo(
        this.route.snapshot.queryParamMap.get('redirectTo')
      ) ?? '/dashboard/principal';

    void this.router.navigate(['/adulto/confirmar'], {
      replaceUrl: true,
      queryParams: { redirectTo },
    });
  }

  private safeRedirectTo(value: string | null): string | null {
    const candidate = String(value ?? '').trim();

    if (
      !candidate.startsWith('/') ||
      candidate.startsWith('//') ||
      candidate.includes('://') ||
      candidate.startsWith('/login') ||
      candidate.startsWith('/register') ||
      candidate.startsWith('/adulto/')
    ) {
      return null;
    }

    return candidate;
  }
}
