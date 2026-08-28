import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

import {
  IssueSuspectedViolationNoticeInput,
} from 'src/app/core/services/compliance/staff-compliance.service';

export interface ComplianceNoticeDialogData {
  targetUid: string;
  targetLabel: string;
}

interface ComplianceNoticeFormValue {
  category: string;
  summary: string;
  policySection: string;
  preventiveMeasure: string;
  responseWindowDays: number;
}

@Component({
  selector: 'app-compliance-notice-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButtonModule,
  ],
  templateUrl: './compliance-notice-dialog.component.html',
  styleUrl: './compliance-notice-dialog.component.css',
})
export class ComplianceNoticeDialogComponent {
  readonly categories = [
    { value: 'AGE_OR_IDENTITY', label: 'Idade ou identidade' },
    {
      value: 'NON_CONSENSUAL_CONTENT',
      label: 'Conteúdo possivelmente sem consentimento',
    },
    { value: 'ILLEGAL_CONTENT', label: 'Possível conteúdo ilegal' },
    { value: 'HARASSMENT_OR_THREAT', label: 'Assédio ou ameaça' },
    {
      value: 'FRAUD_OR_PAYMENT_ABUSE',
      label: 'Fraude ou abuso de pagamento',
    },
    { value: 'ACCOUNT_INTEGRITY', label: 'Integridade da conta' },
    {
      value: 'OTHER_TERMS_VIOLATION',
      label: 'Outra possível violação dos Termos',
    },
  ] as const;

  readonly form = new FormGroup({
    category: new FormControl('OTHER_TERMS_VIOLATION', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    summary: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(20),
        Validators.maxLength(1200),
      ],
    }),
    policySection: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(160),
      ],
    }),
    preventiveMeasure: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(300)],
    }),
    responseWindowDays: new FormControl(7, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(30)],
    }),
  });

  constructor(
    public readonly dialogRef: MatDialogRef<
      ComplianceNoticeDialogComponent,
      IssueSuspectedViolationNoticeInput | null
    >,
    @Inject(MAT_DIALOG_DATA)
    readonly data: ComplianceNoticeDialogData
  ) {}

  cancel(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue() as ComplianceNoticeFormValue;
    const responseDueAt = Date.now() +
      value.responseWindowDays * 24 * 60 * 60 * 1_000;

    this.dialogRef.close({
      targetUid: this.data.targetUid,
      category: value.category,
      summary: value.summary.trim(),
      policySection: value.policySection.trim(),
      preventiveMeasure: value.preventiveMeasure.trim() || null,
      responseDueAt,
    });
  }
}
