// src/app/core/services/subscriptions/subscription.service.ts
// API legada preservada, sem manter uma segunda regra de assinatura.
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  PlatformSubscriptionAccessService,
} from './platform-subscription-access.service';
import {
  PlatformSubscriptionRole,
  hasMinimumPlatformSubscriptionRole,
  isPlatformSubscriptionRole,
} from './platform-subscription-access.model';

type UserRole = IUserDados['role'];

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  constructor(
    private readonly subscriptionAccess: PlatformSubscriptionAccessService,
    private readonly dialog: MatDialog,
    private readonly router: Router
  ) {}

  /**
   * Mantém a nomenclatura pública existente.
   * A decisão vem exclusivamente de PlatformSubscriptionAccessService.
   */
  checkUserSubscription(
    roleToCheck: UserRole
  ): Observable<{
    isSubscriber: boolean;
    subscriptionExpires?: Date;
    monthlyPayer?: boolean;
  }> {
    const minimumRole = this.normalizePaidRole(roleToCheck);

    return this.subscriptionAccess.state$.pipe(
      map((state) => {
        const coversRole =
          minimumRole !== null &&
          state.active &&
          hasMinimumPlatformSubscriptionRole(state.role, minimumRole);

        return {
          isSubscriber: coversRole,
          subscriptionExpires:
            coversRole && state.endsAt !== null
              ? new Date(state.endsAt)
              : undefined,
          // Alias de compatibilidade; não é mais fonte de verdade.
          monthlyPayer: coversRole,
        };
      })
    );
  }

  promptSubscription(data: { title: string; message: string }): void {
    const dialogRef = this.dialog.open(ConfirmacaoDialogComponent, {
      width: '20vw',
      data,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result === true) {
        this.router.navigate(['/subscription-plan']);
      }
    });
  }

  redirectToSubscription(): void {
    this.router.navigate(['/subscription-plan']);
  }

  private normalizePaidRole(
    role: UserRole
  ): PlatformSubscriptionRole | null {
    const normalized = String(role ?? '').trim().toLowerCase();
    return isPlatformSubscriptionRole(normalized) ? normalized : null;
  }
}
