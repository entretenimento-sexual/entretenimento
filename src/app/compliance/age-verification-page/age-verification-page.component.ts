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
import {
  isCurrentAdultAccountAdmissionProjection,
  isCurrentTrustedAdultAgeProjection,
} from 'src/app/core/services/compliance/trusted-adult-age-assurance.policy';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';

interface AgeVerificationPageVm {
  state: IUserAgeEligibility;
  accessAllowed: boolean;
  verified: boolean;
  selfDeclared: boolean;
  expired: boolean;
  deniedUnderage: boolean;
  reviewRequired: boolean;
}

interface PageFeedback {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

@Component({
  selector: 'app-age-verification-page',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent],
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
  private continued = false;

  readonly processing = signal(false);
  readonly reconciling = signal(true);
  readonly feedback = signal<PageFeedback | null>(null);

  readonly vm$: Observable<AgeVerificationPageVm> =
    this.ageEligibility.current$.pipe(
      map((state) => ({
        state,
        accessAllowed: isCurrentAdultAccountAdmissionProjection(state),
        verified: isCurrentTrustedAdultAgeProjection(state),
        selfDeclared: state.status === 'SELF_DECLARED_ADULT',
        expired: state.status === 'EXPIRED',
        deniedUnderage: state.status === 'DENIED_UNDERAGE',
        reviewRequired: state.status === 'REVIEW_REQUIRED',
      }))
    );

  ngOnInit(): void {
    // Não navegar com projeção antiga antes da reconciliação canônica.
    this.ageEligibility.reconcileTrustedStateOncePerSession$()
      .pipe(
        take(1),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível consultar sua elegibilidade etária',
            message: 'Não conseguimos confirmar o estado registrado da sua conta. Verifique a conexão e tente novamente.',
          });
          return of(null);
        }),
        finalize(() => this.reconciling.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((state) => {
        if (state && isCurrentAdultAccountAdmissionProjection(state)) {
          this.continueAfterAgeStep();
        }
      });
  }

  confirmAdult(): void {
    if (this.processing()) return;
    this.processing.set(true);
    this.feedback.set(null);
    this.ageEligibility.acceptSelfDeclaration$().pipe(
      take(1),
      switchMap(() => this.ageEligibility.getCurrentOnce$()),
      catchError(() => {
        this.feedback.set({
          tone: 'error',
          title: 'Não foi possível registrar a confirmação 18+',
          message: 'Confira sua conexão e o estado da conta antes de tentar novamente.',
        });
        return EMPTY;
      }),
      finalize(() => this.processing.set(false))
    ).subscribe((state) => {
      if (isCurrentAdultAccountAdmissionProjection(state)) {
        this.feedback.set({
          tone: 'success',
          title: 'Maioridade registrada',
          message: 'Sua confirmação foi vinculada à conta.',
        });
        this.continueAfterAgeStep();
      } else {
        this.feedback.set({
          tone: 'warning',
          title: 'Elegibilidade ainda pendente',
          message: 'Sua conta ainda não possui uma decisão etária que permita continuar.',
        });
      }
    });
  }

  goToNotifications(): void {
    void this.router.navigate(['/notificacoes']);
  }

  goToAccount(): void {
    void this.router.navigate(['/conta']);
  }

  logoutCurrentSession(): void {
    if (this.processing()) return;

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

  private continueAfterAgeStep(): void {
    if (this.continued) return;
    this.continued = true;
    const target = this.safeRedirectTo(
      this.route.snapshot.queryParamMap.get('redirectTo')
    ) ?? '/dashboard/principal';

    // Retorna à rota protegida. O guard canônico escolhe a etapa
    // realmente pendente: termos, idade, conclusão de perfil ou acesso final.
    void this.router.navigateByUrl(target, { replaceUrl: true })
      .then((navigated) => {
        if (!navigated) this.reportNavigationFailure();
      })
      .catch(() => this.reportNavigationFailure());
  }

  private reportNavigationFailure(): void {
    this.continued = false;
    this.feedback.set({
      tone: 'error',
      title: 'Não foi possível continuar',
      message: 'Sua confirmação permanece registrada. Tente acessar a plataforma novamente.',
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
