// src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.ts
import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
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

  private readonly dialogRef = inject<MatDialogRef<TermosECondicoesComponent> | null>(
    MatDialogRef,
    { optional: true }
  );
  private readonly router = inject(Router, { optional: true });

  closeDialog(): void {
    if (this.dialogRef) {
      this.dialogRef.close();
      return;
    }

    this.router?.navigateByUrl('/').catch(() => undefined);
  }
}
