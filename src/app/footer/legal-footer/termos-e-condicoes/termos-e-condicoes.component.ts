// src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  PLATFORM_LEGAL_MANIFEST,
} from '../../../core/services/compliance/platform-legal.constants';

@Component({
  selector: 'app-termos-e-condicoes',
  imports: [],
  templateUrl: './termos-e-condicoes.component.html',
  styleUrls: ['./termos-e-condicoes.component.css'],
})
export class TermosECondicoesComponent {
  readonly legalManifest = PLATFORM_LEGAL_MANIFEST;

  private readonly router = inject(Router);

  closeDialog(): void {
    this.router.navigateByUrl('/').catch(() => undefined);
  }
}
