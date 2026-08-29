// src/app/community/venue-create/venue-community-create-page.component.ts
// -----------------------------------------------------------------------------
// CADASTRO DE ESPAÇO OFICIAL
// -----------------------------------------------------------------------------
// Espaço Oficial representa uma organização, estabelecimento, evento ou local
// verificado. O componente não apresenta ao usuário a infraestrutura comunitária
// interna usada para feed, permissões e moderação. A autorização de criação é
// validada exclusivamente no backend.
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
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  VenueCommunityCreateJoinPolicy,
  VenueCommunityCreateKind,
} from '../data-access/venue-community-create.model';
import { VenueCommunityRepository } from '../data-access/venue-community.repository';

type VenueCreateForm = FormGroup<{
  name: FormControl<string>;
  kind: FormControl<VenueCommunityCreateKind>;
  description: FormControl<string>;
  uf: FormControl<string>;
  city: FormControl<string>;
  district: FormControl<string>;
  addressHint: FormControl<string>;
  joinPolicy: FormControl<VenueCommunityCreateJoinPolicy>;
}>;

const OFFICIAL_SPACE_REASON_MESSAGES: Readonly<Record<string, string>> =
  Object.freeze({
    official_space_verification_required:
      'O cadastro exige uma organização e um responsável comercial verificados.',
    official_space_grant_inactive:
      'A autorização comercial está inativa. Regularize-a para criar outro Espaço Oficial.',
    official_space_creation_limit_reached:
      'A organização atingiu a quantidade de Espaços Oficiais contratada.',
    account_restricted:
      'Sua conta não pode cadastrar Espaços Oficiais neste momento.',
    adult_access_required:
      'Confirme o acesso adulto antes de cadastrar um Espaço Oficial.',
    profile_incomplete:
      'Complete seu perfil antes de cadastrar um Espaço Oficial.',
  });

@Component({
  selector: 'app-venue-community-create-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './venue-community-create-page.component.html',
  styleUrl: './venue-community-create-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VenueCommunityCreatePageComponent {
  private readonly repository = inject(VenueCommunityRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly router = inject(Router);
  private readonly requestId = this.createRequestId();

  readonly submitting = signal(false);
  readonly venueDefinition = getSocialSpaceDefinition('venue');

  readonly kindOptions: ReadonlyArray<{
    value: VenueCommunityCreateKind;
    label: string;
  }> = [
    { value: 'bar', label: 'Bar' },
    { value: 'club', label: 'Boate' },
    { value: 'restaurant', label: 'Restaurante' },
    { value: 'pub', label: 'Pub ou choperia' },
    { value: 'event_space', label: 'Espaço de eventos' },
    { value: 'hotel', label: 'Hotel' },
    { value: 'other', label: 'Outro' },
  ];

  readonly form: VenueCreateForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(80),
      ],
    }),
    kind: new FormControl<VenueCommunityCreateKind>('bar', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(240)],
    }),
    uf: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)],
    }),
    city: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(80)],
    }),
    district: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(80)],
    }),
    addressHint: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(160)],
    }),
    joinPolicy: new FormControl<VenueCommunityCreateJoinPolicy>('approval', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  submit(): void {
    if (this.submitting()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showWarning(
        'Revise os campos obrigatórios do Espaço Oficial.'
      );
      return;
    }

    const value = this.form.getRawValue();
    this.submitting.set(true);

    this.repository
      .createVenueCommunity$({
        requestId: this.requestId,
        name: value.name.trim(),
        kind: value.kind,
        description: this.optional(value.description),
        region: {
          uf: value.uf.trim().toUpperCase(),
          city: value.city.trim().toLowerCase(),
          district: this.optional(value.district),
        },
        addressHint: this.optional(value.addressHint),
        joinPolicy: value.joinPolicy,
      })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (result) => {
          this.notifications.showSuccess(
            result.created
              ? 'Espaço Oficial cadastrado.'
              : 'Cadastro do Espaço Oficial recuperado com segurança.'
          );
          void this.router.navigate([
            '/dashboard/locais',
            result.communityId,
          ]).catch((error: unknown) => this.reportNavigationError(error));
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
      // O fallback abaixo mantém a idempotência desta sessão de formulário.
    }

    return `local-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }

  private reportError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'createVenueCommunity',
      fallbackMessage: 'Não foi possível cadastrar o Espaço Oficial agora.',
      reasonMessages: OFFICIAL_SPACE_REASON_MESSAGES,
      codeMessages: {
        'permission-denied':
          'Sua conta não possui autorização para cadastrar este Espaço Oficial.',
        'resource-exhausted':
          'A organização atingiu a quantidade de Espaços Oficiais contratada.',
        'invalid-argument':
          'Revise os dados obrigatórios do Espaço Oficial.',
        'already-exists':
          'Não foi possível reservar este cadastro. Revise os dados e tente novamente.',
        'data-loss':
          'O cadastro anterior está inconsistente e precisa de revisão.',
      },
      metadata: {
        scope: 'VenueCommunityCreatePageComponent',
      },
    });
  }

  private reportNavigationError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'navigateAfterVenueCreate',
      fallbackMessage:
        'O Espaço Oficial foi cadastrado, mas não foi possível abri-lo agora.',
      metadata: {
        scope: 'VenueCommunityCreatePageComponent',
      },
    });
  }
}
