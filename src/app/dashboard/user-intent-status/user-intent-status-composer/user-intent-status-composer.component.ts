// src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS COMPOSER
// -----------------------------------------------------------------------------
// Card de publicação do "Status de Hoje".
//
// Objetivo:
// - permitir que o usuário publique disponibilidade/intenção por até 12h;
// - mostrar o status ativo atual e permitir encerramento manual;
// - usar região/destino sem coordenada precisa;
// - preservar UX mobile-first e feedback direto;
// - manter escrita centralizada no UserIntentStatusService.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Observable, of } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  IUserIntentStatusCardVm,
  UserIntentAvailability,
  UserIntentDestinationKind,
  UserIntentVisibility,
} from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

type IntentStatusForm = FormGroup<{
  availability: FormControl<UserIntentAvailability>;
  destinationKind: FormControl<UserIntentDestinationKind>;
  destinationLabel: FormControl<string>;
  uf: FormControl<string>;
  city: FormControl<string>;
  visibility: FormControl<UserIntentVisibility>;
}>;

@Component({
  selector: 'app-user-intent-status-composer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-intent-status-composer.component.html',
  styleUrls: ['./user-intent-status-composer.component.css'],
})
export class UserIntentStatusComposerComponent implements OnChanges {
  @Input() user: IUserDados | null = null;

  publishing = false;
  hiding = false;

  activeStatus$: Observable<IUserIntentStatusCardVm | null> = of(null);

  readonly form: IntentStatusForm = new FormGroup({
    availability: new FormControl<UserIntentAvailability>('available_today', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    destinationKind: new FormControl<UserIntentDestinationKind>('region', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    destinationLabel: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    }),
    uf: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)],
    }),
    city: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1), Validators.maxLength(80)],
    }),
    visibility: new FormControl<UserIntentVisibility>('public_discovery', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  private readonly statusService = inject(UserIntentStatusService);
  private readonly notifications = inject(ErrorNotificationService);

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['user']) {
      return;
    }

    const user = changes['user'].currentValue as IUserDados | null;

    if (!user?.uid) {
      this.activeStatus$ = of(null);
      return;
    }

    const uf = String(user.estado ?? '').trim().toUpperCase();
    const city = String(user.municipio ?? '').trim().toLowerCase();

    this.form.patchValue({
      uf,
      city,
      destinationLabel: city || uf || '',
    }, { emitEvent: false });

    this.activeStatus$ = this.statusService.watchCurrentStatus$(user.uid);
  }

  publish(): void {
    if (this.publishing) {
      return;
    }

    const user = this.user;

    if (!user?.uid) {
      this.notifications.showWarning('Entre novamente para publicar seu status.');
      return;
    }

    const nickname = String(user.nickname ?? '').trim();

    if (nickname.length < 2) {
      this.notifications.showWarning('Defina um nickname antes de publicar seu status.');
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showWarning('Preencha destino e região para publicar seu status.');
      return;
    }

    const value = this.form.getRawValue();
    this.publishing = true;

    this.statusService.publishStatus$({
      uid: user.uid,
      profile: {
        uid: user.uid,
        nickname,
        photoURL: user.photoURL ?? null,
        age: typeof user.idade === 'number' ? user.idade : null,
      },
      availability: value.availability,
      visibility: value.visibility,
      destination: {
        kind: value.destinationKind,
        label: value.destinationLabel.trim(),
        venueId: null,
        region: {
          uf: value.uf.trim().toUpperCase(),
          city: value.city.trim().toLowerCase(),
        },
      },
      durationHours: 12,
    }).pipe(
      finalize(() => {
        this.publishing = false;
      })
    ).subscribe({
      next: () => {
        this.notifications.showSuccess('Status publicado por até 12 horas.');
      },
      error: () => {
        this.notifications.showError('Não foi possível publicar seu status agora.');
      },
    });
  }

  hideCurrentStatus(): void {
    if (this.hiding) {
      return;
    }

    const uid = String(this.user?.uid ?? '').trim();

    if (!uid) {
      this.notifications.showWarning('Entre novamente para encerrar seu status.');
      return;
    }

    this.hiding = true;

    this.statusService.hideCurrentStatus$(uid).pipe(
      finalize(() => {
        this.hiding = false;
      })
    ).subscribe({
      next: () => {
        this.notifications.showSuccess('Status encerrado.');
      },
      error: () => {
        this.notifications.showError('Não foi possível encerrar seu status agora.');
      },
    });
  }
}
