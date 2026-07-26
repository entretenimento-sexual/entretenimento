// src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  TERMS_ACCEPTANCE_VERSION,
} from '../../../core/services/compliance/terms-acceptance.service';

@Component({
  selector: 'app-termos-e-condicoes',
  imports: [],
  templateUrl: './termos-e-condicoes.component.html',
  styleUrls: ['./termos-e-condicoes.component.css'],
})
export class TermosECondicoesComponent {
  readonly termsVersion = TERMS_ACCEPTANCE_VERSION;

  private readonly router = inject(Router);

  closeDialog(): void {
    this.router.navigateByUrl('/').catch(() => undefined);
  }
}
