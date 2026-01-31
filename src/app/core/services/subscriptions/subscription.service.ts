// src/app/core/services/subscriptions/subscription.service.ts
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';

// 🔁 Novo: usamos a store de usuário atual (no lugar do service anterior)
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
// 🔁 Novo: normaliza datas para Date (evita TS2322)
import { DateTimeService } from 'src/app/core/services/general/date-time.service';

// Tipos auxiliares
type UserRole = import('src/app/core/interfaces/iuser-dados').IUserDados['role'];

@Injectable({ providedIn: 'root' })
export class SubscriptionService {

  constructor(
    private currentUserStore: CurrentUserStoreService,
    private dateTime: DateTimeService,
    private dialog: MatDialog,
    private router: Router
  ) { }

  /**
   * Verifica se o usuário tem assinatura ativa suficiente para um `roleToCheck`.
   * - Converte `subscriptionExpires` para `Date`.
   * - Considera a hierarquia de roles: visitante < free < basic < premium < vip
   * - Se `roleToCheck === 'free'`, sempre retorna `isSubscriber: false`.
   */
  checkUserSubscription(
    roleToCheck: UserRole
  ): Observable<{ isSubscriber: boolean; subscriptionExpires?: Date; monthlyPayer?: boolean }> {

    // Hierarquia consistente com o restante do app
    const hierarchy: UserRole[] = ['visitante', 'free', 'basic', 'premium', 'vip'];

    // Normaliza rótulos antigos
    const normalizeRole = (r?: string): UserRole => {
      if (!r) return 'visitante';
      const low = r.toLowerCase();
      if (low === 'basic' as any) return 'basic';
      // se vier algo fora do previsto, caímos para 'visitante'
      return (hierarchy.includes(low as UserRole) ? (low as UserRole) : 'visitante');
    };

    const targetRole = normalizeRole(roleToCheck);

    return this.currentUserStore.user$.pipe(
      map(user => {
        // estado indefinido/visitante
        if (!user) {
          return { isSubscriber: false, subscriptionExpires: undefined, monthlyPayer: false };
        }

        const userRole = normalizeRole(user.role as string);

        // Plano grátis nunca é tratado como assinatura
        if (targetRole === 'free') {
          const expires = user.subscriptionExpires
            ? this.dateTime.convertToDate(user.subscriptionExpires)
            : undefined;
          return {
            isSubscriber: false,
            subscriptionExpires: expires,
            monthlyPayer: !!user.monthlyPayer,
          };
        }

        // Normaliza data para Date (elimina number | null | undefined → TS2322)
        const subscriptionExpiresDate = user.subscriptionExpires
          ? this.dateTime.convertToDate(user.subscriptionExpires)
          : undefined;

        const isActive =
          !!user.monthlyPayer &&
          !!subscriptionExpiresDate &&
          subscriptionExpiresDate.getTime() >= Date.now();

        // user cobre roleToCheck? (ex.: vip cobre premium/basic)
        const roleCovers =
          hierarchy.indexOf(userRole) >= 0 &&
          hierarchy.indexOf(targetRole) >= 0 &&
          hierarchy.indexOf(userRole) >= hierarchy.indexOf(targetRole);

        const ok = isActive && roleCovers;

        return {
          isSubscriber: ok,
          subscriptionExpires: subscriptionExpiresDate,
          monthlyPayer: !!user.monthlyPayer,
        };
      })
    );
  }

  promptSubscription(data: { title: string; message: string }): void {
    const dialogRef = this.dialog.open(ConfirmacaoDialogComponent, {
      width: '20vw',
      data
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.router.navigate(['/subscription-plan']);
      }
    });
  }

  redirectToSubscription(): void {
    this.router.navigate(['/subscription-plan']);
  }
}
