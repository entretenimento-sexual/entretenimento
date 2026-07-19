// src/app/community/community-create/community-create-page.component.ts
// -----------------------------------------------------------------------------
// CRIAÇÃO DE COMUNIDADE
// -----------------------------------------------------------------------------
// Comunidade é um grupo permanente de pessoas unidas por interesse, identidade,
// região ou objetivo. O formulário é mobile-first, tipado e reativo; propriedade,
// moderação, entitlement e identificadores permanecem sob autoridade da Function.
// -----------------------------------------------------------------------------

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { getSocialSpaceDefinition } from 'src/app/core/domain/social-space.definition';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  CommunityCreateAccessTier,
  CommunityCreateJoinPolicy,
  CommunityCreateTheme,
} from '../data-access/community-create.model';
import { CommunityCreateRepository } from '../data-access/community-create.repository';

type CommunityCreateForm = FormGroup<{
  name: FormControl<string>;
  theme: FormControl<CommunityCreateTheme>;
  description: FormControl<string>;
  rules: FormControl<string>;
  joinPolicy: FormControl<CommunityCreateJoinPolicy>;
  accessTier: FormControl<CommunityCreateAccessTier>;
}>;

@Component({
  selector: 'app-community-create-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './community-create-page.component.html',
  styleUrl: './community-create-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityCreatePageComponent {
  private readonly repository = inject(CommunityCreateRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly router = inject(Router);
  private readonly requestId = this.createRequestId();

  readonly submitting = signal(false);
  readonly communityDefinition = getSocialSpaceDefinition('community');

  readonly themeOptions: ReadonlyArray<{
    value: CommunityCreateTheme;
    label: string;
  }> = [
    { value: 'regional', label: 'Região ou cidade' },
    { value: 'interests', label: 'Interesses' },
    { value: 'identity', label: 'Identidade e afinidades' },
    { value: 'events', label: 'Eventos e encontros' },
    { value: 'lifestyle', label: 'Estilo de vida' },
    { value: 'other', label: 'Outro tema' },
  ];

  readonly form: CommunityCreateForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(80),
      ],
    }),
    theme: new FormControl<CommunityCreateTheme>('interests', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(240)],
    }),
    rules: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(1_200),
      ],
    }),
    joinPolicy: new FormControl<CommunityCreateJoinPolicy>('approval', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    accessTier: new FormControl<CommunityCreateAccessTier>('all', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  submit(): void {
    if (this.submitting()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showWarning(
        'Revise os campos obrigatórios da Comunidade.'
      );
      return;
    }

    const value = this.form.getRawValue();
    this.submitting.set(true);

    this.repository
      .createCommunity$({
        requestId: this.requestId,
        name: value.name.trim(),
        theme: value.theme,
        description: this.optional(value.description),
        rules: value.rules.trim(),
        joinPolicy: value.joinPolicy,
        accessTier: value.accessTier,
      })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (result) => {
          this.notifications.showSuccess(
            result.created
              ? 'Comunidade criada.'
              : 'Comunidade recuperada com segurança.'
          );
          void this.router.navigate([
            '/dashboard/comunidades',
            result.communityId,
          ]);
        },
        error: (error: unknown) => this.reportError(error),
      });
  }

  private optional(value: string): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private createRequestId(): string {
    try {
      const randomUuid = globalThis.crypto?.randomUUID?.();
      if (randomUuid) return randomUuid;
    } catch {
      // O fallback mantém a idempotência desta sessão de formulário.
    }

    return `grupo-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }

  private reportError(error: unknown): void {
    try {
      this.notifications.showError(
        'Não foi possível criar a Comunidade agora.'
      );
    } catch {
      // A observabilidade abaixo permanece ativa.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityCreatePageComponent',
        op: 'createCommunity',
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
