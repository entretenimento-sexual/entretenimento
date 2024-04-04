// src\app\core\services\subscriptions\subscription.service.ts
import { Injectable } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from '../autentication/auth.service';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class SubscriptionService {

  constructor(
    private authService: AuthService,
    private dialog: MatDialog,
    private router: Router
  ) { }

  checkUserSubscription(roleToCheck: string): Observable<{ isSubscriber: boolean, subscriptionExpires?: Date, monthlyPayer?: boolean }> {
    return this.authService.user$.pipe(
      map(user => {
        if (!user) {
          return { isSubscriber: false, subscriptionExpires: undefined, monthlyPayer: false };
        }

        if (user.role === 'free') {
          return { isSubscriber: false, subscriptionExpires: user.subscriptionExpires, monthlyPayer: user.monthlyPayer };
        }

        // Verificar o role específico
        if (user.role === roleToCheck) {
          if (user.monthlyPayer && user.subscriptionExpires && user.subscriptionExpires >= new Date()) {
            return { isSubscriber: true, subscriptionExpires: user.subscriptionExpires, monthlyPayer: user.monthlyPayer };
          } else {
            return { isSubscriber: false, subscriptionExpires: user.subscriptionExpires, monthlyPayer: user.monthlyPayer };
          }
        }

        // Verificar se o role atual do usuário engloba o role que está sendo verificado
        const rolesHierarchy = ['vip', 'premium', 'basico', 'free'];
        const roleIndex = rolesHierarchy.indexOf(user.role);
        const roleToCheckIndex = rolesHierarchy.indexOf(roleToCheck);
        if (roleIndex >= 0 && roleToCheckIndex >= 0 && roleIndex <= roleToCheckIndex) {
          if (user.monthlyPayer && user.subscriptionExpires && user.subscriptionExpires >= new Date()) {
            return { isSubscriber: true, subscriptionExpires: user.subscriptionExpires, monthlyPayer: user.monthlyPayer };
          }
        }

        return { isSubscriber: false, subscriptionExpires: user.subscriptionExpires, monthlyPayer: user.monthlyPayer };
      })
    );
  }
  promptSubscription(data: { title: string; message: string }): void {
    const dialogRef = this.dialog.open(ConfirmacaoDialogComponent, {
      width: '20vw',
      data: data
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        // Usuário escolheu se tornar assinante, redirecionar para a página de assinatura
        this.router.navigate(['/subscription-plan']);
      }
      // Se o usuário escolher "Não", nada acontece e ele permanece na página atual
    });
  }

  redirectToSubscription(): void {
    this.router.navigate(['/subscription-plan']);
  }
  // Aqui você pode adicionar mais métodos conforme a necessidade, como:
  // subscribeUser, getSubscriptionPlans, etc.
}
