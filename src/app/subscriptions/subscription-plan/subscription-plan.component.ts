// src/app/subscriptions/subscription-plan/subscription-plan.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-subscription-plan',
  standalone: true,
  templateUrl: './subscription-plan.component.html',
  styleUrls: ['./subscription-plan.component.css']
})
export class SubscriptionPlanComponent {
  constructor(private readonly router: Router) {}

  subscribe(plan: string): void {
    console.log(`Usuário escolheu o plano: ${plan}`);

    this.router.navigate(['/checkout'], {
      queryParams: { plan }
    });
  }
}