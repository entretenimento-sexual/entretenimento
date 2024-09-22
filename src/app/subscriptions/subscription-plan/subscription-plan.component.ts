// src\app\subscriptions\subscription-plan\subscription-plan.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router'; // Para redirecionar após a assinatura

@Component({
  selector: 'app-subscription-plan',
  standalone: true,
  templateUrl: './subscription-plan.component.html',
  styleUrls: ['./subscription-plan.component.css']
})
export class SubscriptionPlanComponent {

  constructor(private router: Router) { }

  subscribe(plan: string) {
    // Aqui você pode implementar a lógica de redirecionamento ou ativação da assinatura
    console.log(`Usuário escolheu o plano: ${plan}`);
    this.router.navigate(['/checkout', { plan }]);
  }
}
