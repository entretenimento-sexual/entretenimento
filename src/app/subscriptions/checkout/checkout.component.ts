// src/app/subscriptions/checkout/checkout.component.ts
// ==============================================================
// CHECKOUT COMPONENT
//
// Responsabilidades:
// - renderizar a tela de checkout
// - consumir a CheckoutFacade
// - reagir às ações do usuário (continuar / voltar)
// - redirecionar para a URL retornada pela sessão de checkout
//
// Observação arquitetural:
// - a CheckoutFacade é provida no escopo do componente
//   para ficar alinhada à ActivatedRoute atual.
// - o aviso de perfil incompleto atua apenas na camada de UX,
//   sem interferir na lógica de checkout/billing.
// ==============================================================

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  isDevMode,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map, shareReplay, take, tap } from 'rxjs/operators';

import { CheckoutFacade } from 'src/app/payments-core/application/checkout.facade';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IncompleteProfileSubscriptionNoticeService } from '../application/incomplete-profile-subscription-notice.service';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  providers: [CheckoutFacade],
  templateUrl: './checkout.component.html',
  styleUrls: ['./checkout.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly noticeService = inject(IncompleteProfileSubscriptionNoticeService);

  checkoutAcknowledged = false;

  readonly facade = inject(CheckoutFacade);
  readonly plan$ = this.facade.plan$;

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly shouldShowCheckoutWarning$ = this.noticeService.shouldShow$(
    this.currentUser$,
    this.buildStaticContext$('checkout')
  );

  readonly checkoutWarningItems = [
    'seu perfil pode aparecer menos ou não aparecer para outras pessoas',
    'algumas funções de descoberta podem continuar limitadas',
    'algumas interações sociais podem continuar restritas',
  ];

  ngOnInit(): void {
    this.currentUser$
      .pipe(
        tap((user) => {
          this.noticeService.hydrate(user?.uid);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  continue(shouldShowCheckoutWarning: boolean): void {
    this.debug('continue() acionado');

    if (shouldShowCheckoutWarning && !this.checkoutAcknowledged) {
      this.errorNotifier.showWarning(
        'Antes de continuar, confirme que entendeu as limitações de um perfil incompleto.'
      );
      return;
    }

    this.facade
      .startCheckout$()
      .pipe(take(1))
      .subscribe((checkoutUrl) => {
        if (!checkoutUrl) {
          this.errorNotifier.showError(
            'Checkout ainda não disponível para este plano.'
          );
          return;
        }

        this.debug('redirecionando para checkout', { checkoutUrl });
        window.location.assign(checkoutUrl);
      });
  }

  back(): void {
    this.debug('back() acionado');

    this.facade.goBackToPlans().catch((error) => {
      this.debug('falha ao navegar para os planos', error);
      this.errorNotifier.showError('Falha ao voltar para os planos.');
    });
  }

  onAcknowledgementChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.checkoutAcknowledged = !!input?.checked;
  }

  private buildStaticContext$(context: 'checkout') {
    return this.currentUser$.pipe(
      map(() => context),
      distinctUntilChanged()
    );
  }

  private debug(message: string, extra?: unknown): void {
    if (!isDevMode()) return;
    console.debug('[CheckoutComponent]', message, extra ?? '');
  }
}