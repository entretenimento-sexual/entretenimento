// src/app/dashboard/user-intent-status/user-intent-status-composer.component.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS COMPOSER
// -----------------------------------------------------------------------------
// Card de publicação do "Status de Hoje".
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
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import {
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
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
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
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
  isComposerExpanded = false;

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

  private readonly authSession = inject(AuthSessionService);
  private readonly statusService = inject(UserIntentStatusService);
  private readonly venueService = inject(VenueService);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly activeStatusRefreshSubject = new BehaviorSubject<void>(undefined);

  private readonly authUid$ = this.authSession.readyUid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['user']) {
      return;
    }

    const user = changes['user'].currentValue as IUserDados | null;

    if (!user) {
      this.activeStatus$ = of(null);
      this.venues$ = of([]);
      this.selectedVenue$ = of(null);
      this.isComposerExpanded = false;
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

    this.activeStatus$ = combineLatest([
      this.authUid$,
      this.activeStatusRefreshSubject,
    ]).pipe(
      switchMap(([uid]) => uid ? this.statusService.watchCurrentStatus$(uid) : of(null)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
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

  toggleComposer(): void {
    this.isComposerExpanded = !this.isComposerExpanded;
  }

  openComposer(): void {
    this.isComposerExpanded = true;
  }

  closeComposer(): void {
    if (this.publishing) {
      return;
    }

    this.isComposerExpanded = false;
  }

  publish(): void {
    if (this.publishing) {
      return;
    }

    const user = this.user;

    if (!user) {
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
      this.openComposer();
      return;
    }

    this.authUid$.pipe(take(1)).subscribe((authUid) => {
      if (!authUid) {
        this.notifications.showWarning('Entre novamente para publicar seu status.');
        return;
      }

      this.publishForAuthenticatedUid(authUid, user, nickname);
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

    this.authUid$.pipe(take(1)).subscribe((authUid) => {
      if (!authUid) {
        this.notifications.showWarning('Entre novamente para encerrar seu status.');
        return;
      }

      this.hiding = true;

      this.statusService.hideCurrentStatus$(authUid).pipe(
        finalize(() => {
          this.hiding = false;
        })
      ).subscribe({
        next: () => {
          this.notifications.showSuccess('Status encerrado.');
          this.activeStatusRefreshSubject.next();
        },
        error: () => {
          this.notifications.showError('Não foi possível encerrar seu status agora.');
        },
      });
    });
  }

  private publishForAuthenticatedUid(
    authUid: string,
    user: IUserDados,
    nickname: string
  ): void {
    const value = this.form.getRawValue();
    const selectedVenueId =
      value.destinationKind === 'venue'
        ? String(value.venueId ?? '').trim()
        : '';

    this.publishing = true;

    this.statusService.publishStatus$({
      uid: authUid,
      profile: {
        uid: authUid,
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
        this.activeStatusRefreshSubject.next();
        this.isComposerExpanded = false;
      },
      error: () => {
        this.notifications.showError('Não foi possível publicar seu status agora.');
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
