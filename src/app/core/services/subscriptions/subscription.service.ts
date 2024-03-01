// src\app\core\services\subscriptions\subscription.service.ts
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
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

  checkUserSubscription(): Observable<boolean> {
    // Aqui você implementaria a lógica para verificar se o usuário é um assinante
    // Por simplicidade, vamos retornar um Observable de um valor falso
    return of(false);
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
