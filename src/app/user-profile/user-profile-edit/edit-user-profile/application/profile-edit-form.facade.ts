import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';

import {
  SELECTABLE_PROFILE_IDENTITY_OPTIONS,
  isCoupleProfileIdentityCode,
} from 'src/app/core/domain/profile-identity/profile-identity.catalog';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  ProfileEditLocationService,
  ProfileEditMunicipio,
} from './profile-edit-location.service';

@Injectable()
export class ProfileEditFormFacade {
  private readonly formBuilder = inject(FormBuilder);
  private readonly locationService = inject(ProfileEditLocationService);
  private readonly destroyRef = inject(DestroyRef);
  private bound = false;

  readonly form: FormGroup = this.formBuilder.group({
    nickname: ['', [Validators.minLength(3)]],
    estado: [''],
    municipio: [{ value: '', disabled: true }],
    gender: [''],
    orientation: [''],
    idade: [null, [Validators.min(18), Validators.max(100)]],
    partner1Orientation: [''],
    partner2Orientation: [''],
    descricao: ['', [Validators.maxLength(2000)]],
  });

  readonly municipios = signal<ProfileEditMunicipio[]>([]);

  readonly genderOptions = SELECTABLE_PROFILE_IDENTITY_OPTIONS.map(
    (option) => ({
      value: option.code,
      label: option.label,
    })
  );

  bind(): void {
    if (this.bound) return;
    this.bound = true;

    this.form
      .get('gender')!
      .valueChanges.pipe(
        startWith(this.form.get('gender')!.value),
        map((value) => String(value ?? '')),
        distinctUntilChanged(),
        tap((gender) => this.syncOrientationControls(gender)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.form
      .get('estado')!
      .valueChanges.pipe(
        map((value) => String(value ?? '').trim()),
        distinctUntilChanged(),
        switchMap((sigla) =>
          sigla ? this.locationService.loadMunicipios$(sigla) : of([])
        ),
        tap((municipios) => {
          this.municipios.set(municipios);
          this.syncMunicipioControlState(municipios);

          const selected = String(
            this.form.get('municipio')?.value ?? ''
          );

          if (
            selected &&
            municipios.some((municipio) => municipio.nome === selected)
          ) {
            return;
          }

          this.form.patchValue(
            { municipio: municipios[0]?.nome ?? '' },
            { emitEvent: false }
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  initialize(
    user: IUserDados,
    municipios: ProfileEditMunicipio[]
  ): void {
    this.municipios.set([...(municipios ?? [])]);
    this.syncMunicipioControlState(this.municipios());

    this.form.patchValue(
      {
        nickname: user.nickname ?? '',
        estado: user.estado ?? '',
        municipio: user.municipio ?? '',
        gender: user.gender ?? '',
        orientation: user.orientation ?? '',
        idade: user.idade ?? null,
        partner1Orientation: user.partner1Orientation ?? '',
        partner2Orientation: user.partner2Orientation ?? '',
        descricao: user.descricao ?? '',
      },
      { emitEvent: true }
    );
  }

  isCouple(): boolean {
    const gender = String(
      this.form.get('gender')?.value ?? ''
    );

    return isCoupleProfileIdentityCode(gender);
  }

  private syncOrientationControls(gender: string): void {
    const isCouple = isCoupleProfileIdentityCode(gender);

    const orientation = this.form.get('orientation')!;
    const partner1 = this.form.get('partner1Orientation')!;
    const partner2 = this.form.get('partner2Orientation')!;

    if (isCouple) {
      orientation.disable({ emitEvent: false });
      orientation.setValue('', { emitEvent: false });
      partner1.enable({ emitEvent: false });
      partner2.enable({ emitEvent: false });
    } else {
      orientation.enable({ emitEvent: false });
      partner1.disable({ emitEvent: false });
      partner2.disable({ emitEvent: false });
      partner1.setValue('', { emitEvent: false });
      partner2.setValue('', { emitEvent: false });
    }

    partner1.updateValueAndValidity({ emitEvent: false });
    partner2.updateValueAndValidity({ emitEvent: false });
    orientation.updateValueAndValidity({ emitEvent: false });
  }

  private syncMunicipioControlState(
    municipios: readonly ProfileEditMunicipio[]
  ): void {
    const control = this.form.get('municipio');
    if (!control) return;

    if (municipios.length > 0) {
      control.enable({ emitEvent: false });
      return;
    }

    control.disable({ emitEvent: false });
    control.patchValue('', { emitEvent: false });
  }
}
