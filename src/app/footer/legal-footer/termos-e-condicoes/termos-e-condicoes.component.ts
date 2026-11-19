// src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.ts
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

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
  readonly fromRegistration = toSignal(inject(ActivatedRoute).queryParamMap.pipe(
    map(params => params.get('origem') === 'cadastro')
  ), { initialValue: false });

  closeDialog(): void {
    this.router.navigateByUrl(this.fromRegistration() ? '/register/welcome' : '/').catch(() => undefined);
  }
}
