// src/app/community/venue-create/venue-community-create-page.component.ts
// -----------------------------------------------------------------------------
// CRIAÇÃO DE LOCAL
// -----------------------------------------------------------------------------
// Local é um lugar físico ou estabelecimento real. O componente não apresenta
// ao usuário a infraestrutura comunitária interna usada para feed, permissões e
// moderação. O criador torna-se Proprietário do Local.
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
  private readonly globalError = inject(GlobalErrorHandlerService);
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
      this.notifications.showWarning('Revise os campos obrigatórios do Local.');
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
            result.created ? 'Local criado.' : 'Local recuperado com segurança.'
          );
          void this.router.navigate([
            '/dashboard/locais',
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
      // O fallback abaixo mantém a idempotência desta sessão de formulário.
    }

    return `local-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }

  private reportError(error: unknown): void {
    try {
      this.notifications.showError('Não foi possível criar o Local agora.');
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
        scope: 'VenueCommunityCreatePageComponent',
        op: 'createVenueCommunity',
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
