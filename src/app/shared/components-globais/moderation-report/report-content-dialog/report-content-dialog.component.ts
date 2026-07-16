// src/app/shared/components-globais/moderation-report/report-content-dialog/report-content-dialog.component.ts
// -----------------------------------------------------------------------------
// REPORT CONTENT DIALOG
// -----------------------------------------------------------------------------
// Dialog reutilizável para coletar motivo e detalhes opcionais de denúncia.
//
// Decisões:
// - não grava Firestore diretamente;
// - retorna somente dados já normalizados para o botão/orquestrador;
// - usa formulário reativo para validação simples e acessível;
// - possível menoridade aparece somente em denúncia de perfil;
// - mantém textos claros e sem expor termos técnicos ao usuário.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  computed,
  signal,
} from '@angular/core';
import {
  NonNullableFormBuilder,
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

import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import {
  ModerationReportReason,
  ModerationReportTargetType,
} from 'src/app/core/interfaces/moderation/moderation-report.interface';

export interface ReportContentDialogData {
  targetType: ModerationReportTargetType;
  title?: string | null;
  subtitle?: string | null;
}

export interface ReportContentDialogResult {
  reason: ModerationReportReason;
  details: string | null;
}

interface ReportReasonOption {
  value: ModerationReportReason;
  label: string;
  helper: string;
}

const GENERAL_REPORT_REASONS: readonly ReportReasonOption[] = [
  {
    value: 'spam',
    label: 'Spam ou golpe',
    helper: 'Divulgação repetitiva, link suspeito ou tentativa de golpe.',
  },
  {
    value: 'fake_profile',
    label: 'Perfil falso',
    helper: 'Identidade enganosa, foto falsa ou tentativa de se passar por outra pessoa.',
  },
  {
    value: 'harassment',
    label: 'Assédio ou ameaça',
    helper: 'Insistência, intimidação, ameaça ou contato abusivo.',
  },
  {
    value: 'hate_or_abuse',
    label: 'Ódio ou abuso',
    helper: 'Ataques contra pessoa ou grupo protegido.',
  },
  {
    value: 'sexual_boundary',
    label: 'Limite sexual violado',
    helper: 'Conteúdo ou abordagem sexual fora do consentimento ou das regras.',
  },
  {
    value: 'illegal_content',
    label: 'Conteúdo ilegal',
    helper: 'Material proibido, exploração, coerção ou conduta criminosa.',
  },
  {
    value: 'privacy',
    label: 'Privacidade',
    helper: 'Exposição de dados, imagem ou informação pessoal sem autorização.',
  },
  {
    value: 'other',
    label: 'Outro motivo',
    helper: 'Use os detalhes para explicar o problema.',
  },
];

const MINOR_PROFILE_REASON: ReportReasonOption = {
  value: 'minor_safety',
  label: 'Possível pessoa menor de 18 anos',
  helper:
    'Use esta opção apenas quando acreditar que a pessoa responsável pelo perfil é menor de idade.',
};

@Component({
  selector: 'app-report-content-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SharedMaterialModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
  ],
  templateUrl: './report-content-dialog.component.html',
  styleUrls: ['./report-content-dialog.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportContentDialogComponent {
  readonly submitting = signal(false);

  readonly targetLabel = computed(() =>
    this.resolveTargetLabel(this.data.targetType)
  );

  readonly reasons = computed<readonly ReportReasonOption[]>(() => {
    if (this.data.targetType !== 'profile') {
      return GENERAL_REPORT_REASONS;
    }

    return [
      ...GENERAL_REPORT_REASONS.slice(0, -1),
      MINOR_PROFILE_REASON,
      GENERAL_REPORT_REASONS[GENERAL_REPORT_REASONS.length - 1],
    ];
  });

  readonly form = this.fb.group({
    reason: this.fb.control<ModerationReportReason | ''>('', {
      validators: [Validators.required],
    }),
    details: this.fb.control('', {
      validators: [Validators.maxLength(1200)],
    }),
  });

  constructor(
    private readonly fb: NonNullableFormBuilder,
    private readonly dialogRef: MatDialogRef<
      ReportContentDialogComponent,
      ReportContentDialogResult | null
    >,
    @Inject(MAT_DIALOG_DATA) public readonly data: ReportContentDialogData
  ) {}

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const reason = this.form.controls.reason.value;

    if (!reason || !this.isReasonAllowedForTarget(reason)) {
      this.form.controls.reason.setErrors({ targetMismatch: true });
      return;
    }

    this.submitting.set(true);

    this.dialogRef.close({
      reason,
      details: this.normalizeOptionalText(this.form.controls.details.value),
    });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  get selectedReasonHelper(): string | null {
    const selected = this.form.controls.reason.value;
    return this.reasons().find((reason) => reason.value === selected)?.helper ?? null;
  }

  private isReasonAllowedForTarget(reason: ModerationReportReason): boolean {
    return this.reasons().some((option) => option.value === reason);
  }

  private normalizeOptionalText(
    value: string | null | undefined
  ): string | null {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized.slice(0, 1200) : null;
  }

  private resolveTargetLabel(type: ModerationReportTargetType): string {
    switch (type) {
      case 'profile':
        return 'perfil';
      case 'photo':
        return 'foto';
      case 'video':
        return 'vídeo';
      case 'video_comment':
        return 'comentário do vídeo';
      case 'video_rating':
        return 'avaliação do vídeo';
      case 'message':
        return 'mensagem';
      case 'room':
        return 'sala';
      case 'status':
        return 'Status de Hoje';
      case 'venue':
        return 'local';
      case 'other':
      default:
        return 'conteúdo';
    }
  }
}
