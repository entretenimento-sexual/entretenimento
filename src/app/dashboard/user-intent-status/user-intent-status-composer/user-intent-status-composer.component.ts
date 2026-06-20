// src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS COMPOSER
// -----------------------------------------------------------------------------
// Card de publicação do "Status de Hoje".
//
// Objetivo:
// - permitir que o usuário publique disponibilidade/intenção por até 12h;
// - mostrar o status ativo atual e permitir encerramento manual;
// - permitir seleção de estabelecimento gerenciado quando existir;
// - reagir à região digitada no próprio formulário;
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
import { Observable, combineLatest, of } from 'rxjs';
import {
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  IUserIntentStatusCardVm,
  IUserIntentStatusRegion,
  UserIntentAvailability,
  UserIntentDestinationKind,
  UserIntentVisibility,
} from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import { IVenueCardVm } from 'src/app/core/interfaces/venues/venue.interface';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { VenueService } from 'src/app/core/services/venues/venue.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

type IntentStatusForm = FormGroup<{
  availability: FormControl<UserIntentAvailability>;
  destinationKind: FormControl<UserIntentDestinationKind>;
  venueId: FormControl<string>;
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
  venues$: Observable<IVenueCardVm[]> = of([]);
  selectedVenue$: Observable<IVenueCardVm | null> = of(null);

  readonly form: IntentStatusForm = new FormGroup({
    availability: new FormControl<UserIntentAvailability>('available_today', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    destinationKind: new FormControl<UserIntentDestinationKind>('region', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    venueId: new FormControl<string>('', {
      nonNullable: true,
    }),
    destinationLabel: new FormControl<string>('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(80),
      ],
    }),
    uf: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)],
    }),
    city: new FormControl<string>('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(1),
        Validators.maxLength(80),
      ],
    }),
    visibility: new FormControl<UserIntentVisibility>('public_discovery', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  readonly destinationKind$ = this.form.controls.destinationKind.valueChanges.pipe(
    startWith(this.form.controls.destinationKind.value),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly statusService = inject(UserIntentStatusService);
  private readonly venueService = inject(VenueService);
  private readonly notifications = inject(ErrorNotificationService);

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['user']) {
      return;
    }

    const user = changes['user'].currentValue as IUserDados | null;

    if (!user?.uid) {
      this.activeStatus$ = of(null);
      this.venues$ = of([]);
      this.selectedVenue$ = of(null);
      return;
    }

    const uf = String(user.estado ?? '').trim().toUpperCase();
    const city = String(user.municipio ?? '').trim().toLowerCase();

    this.form.patchValue({
      uf,
      city,
      destinationLabel: city || uf || '',
      venueId: '',
    }, { emitEvent: false });

    this.activeStatus$ = this.statusService.watchCurrentStatus$(user.uid);
    this.venues$ = this.watchVenuesForFormRegion$();
    this.selectedVenue$ = combineLatest([
      this.venues$,
      this.form.controls.venueId.valueChanges.pipe(
        startWith(this.form.controls.venueId.value)
      ),
    ]).pipe(
      map(([venues, venueId]) =>
        venues.find((venue) => venue.id === venueId) ?? null
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
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
    const selectedVenueId =
      value.destinationKind === 'venue'
        ? String(value.venueId ?? '').trim()
        : '';

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
        venueId: selectedVenueId || null,
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

  applyVenue(venue: IVenueCardVm): void {
    this.form.patchValue({
      destinationKind: 'venue',
      venueId: venue.id,
      destinationLabel: venue.name,
      uf: venue.region.uf,
      city: venue.region.city,
    });
  }

  clearVenueSelection(): void {
    this.form.patchValue({ venueId: '' });
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

  private watchVenuesForFormRegion$(): Observable<IVenueCardVm[]> {
    return combineLatest([
      this.form.controls.uf.valueChanges.pipe(startWith(this.form.controls.uf.value)),
      this.form.controls.city.valueChanges.pipe(startWith(this.form.controls.city.value)),
    ]).pipe(
      map(([uf, city]) => this.normalizeFormRegion(uf, city)),
      distinctUntilChanged((previous, current) =>
        previous?.uf === current?.uf && previous?.city === current?.city
      ),
      switchMap((region) => region
        ? this.venueService.watchVenuesForRegion$(region, { limit: 20 })
        : of([])
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private normalizeFormRegion(
    uf: string,
    city: string
  ): IUserIntentStatusRegion | null {
    const normalizedUf = String(uf ?? '').trim().toUpperCase();
    const normalizedCity = String(city ?? '').trim().toLowerCase();

    if (!/^[A-Z]{2}$/.test(normalizedUf) || !normalizedCity) {
      return null;
    }

    return {
      uf: normalizedUf,
      city: normalizedCity,
    };
  }
}
