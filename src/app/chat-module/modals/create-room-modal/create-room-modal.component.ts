// src/app/chat-module/modals/create-room-modal/create-room-modal.component.ts
// -----------------------------------------------------------------------------
// CREATE ROOM MODAL COMPONENT
// -----------------------------------------------------------------------------
// Formulário reativo para criação/edição de sala.
// A associação premium usa exclusivamente estabelecimentos moderados do catálogo.

import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import {
  IRoomPlaceIntent,
  IRoomPlaceIntentInput,
  RoomPlaceIntentMode,
} from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { IVenueCardVm } from 'src/app/core/interfaces/venues/venue.interface';
import { VenueService } from 'src/app/core/services/venues/venue.service';
import { FormValidationFocusDirective } from 'src/app/shared/form-validation-focus/form-validation-focus.directive';

export interface CreateRoomModalData {
  isEditing?: boolean;
  roomId?: string;
  canUsePlaceIntent?: boolean;
  defaultRegion?: {
    uf?: string | null;
    city?: string | null;
  } | null;
  roomData?: {
    roomName?: string | null;
    description?: string | null;
    placeIntent?: Partial<IRoomPlaceIntent> | null;
  } | null;
}

export interface CreateRoomModalResult {
  success: true;
  action: 'created' | 'updated';
  roomId: string | null;
  roomDetails: {
    roomName: string;
    description: string;
    placeIntent?: IRoomPlaceIntentInput | null;
  };
}

type CreateRoomFormGroup = FormGroup<{
  roomName: FormControl<string>;
  description: FormControl<string>;
  placeEnabled: FormControl<boolean>;
  placeMode: FormControl<RoomPlaceIntentMode>;
  placeVenueId: FormControl<string>;
  placeStartsAt: FormControl<string>;
}>;

@Component({
  selector: 'app-create-room-modal',
  templateUrl: './create-room-modal.component.html',
  styleUrls: ['./create-room-modal.component.css'],
  standalone: false,
})
export class CreateRoomModalComponent implements OnInit {
  @ViewChild(FormValidationFocusDirective)
  private validationFocus?: FormValidationFocusDirective;

  roomForm!: CreateRoomFormGroup;
  isEditing = false;
  roomId = '';
  venues$: Observable<readonly IVenueCardVm[]> = of([]);

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly venueService: VenueService,
    public readonly dialogRef: MatDialogRef<CreateRoomModalComponent>,
    @Inject(MAT_DIALOG_DATA)
    public readonly data: CreateRoomModalData | null
  ) {}

  get canUsePlaceIntent(): boolean {
    return this.data?.canUsePlaceIntent === true;
  }

  get minimumScheduledDateTime(): string {
    return this.toDateTimeLocalValue(Date.now());
  }

  ngOnInit(): void {
    this.initializeForm();
    this.initializeVenues();

    if (this.data?.isEditing === true) {
      this.isEditing = true;
      this.roomId = String(this.data.roomId ?? '').trim();

      this.roomForm.patchValue({
        roomName: String(this.data.roomData?.roomName ?? ''),
        description: String(this.data.roomData?.description ?? ''),
      });
    }

    const placeIntent = this.data?.roomData?.placeIntent;

    if (this.canUsePlaceIntent && placeIntent?.venueId) {
      this.roomForm.patchValue({
        placeEnabled: true,
        placeMode: placeIntent.mode === 'scheduled' ? 'scheduled' : 'now',
        placeVenueId: String(placeIntent.venueId),
        placeStartsAt: this.toDateTimeLocalValue(placeIntent.startsAt),
      });
    }
  }

  initializeForm(): void {
    this.roomForm = this.formBuilder.nonNullable.group({
      roomName: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.maxLength(60),
        ],
      ],
      description: ['', [Validators.maxLength(280)]],
      placeEnabled: [false],
      placeMode: ['now' as RoomPlaceIntentMode],
      placeVenueId: [''],
      placeStartsAt: [''],
    });
  }

  onSubmit(): void {
    if (this.roomForm.invalid) {
      this.roomForm.markAllAsTouched();
      this.validationFocus?.focusFirstInvalid(
        'Revise os dados da Sala antes de continuar.'
      );
      return;
    }

    const rawValue = this.roomForm.getRawValue();
    const roomName = rawValue.roomName.trim();

    if (roomName.length < 3 || roomName.length > 60) {
      this.roomForm.controls.roomName.setErrors({ size: true });
      this.roomForm.controls.roomName.markAsTouched();
      this.validationFocus?.focusControl(
        'roomName',
        'Informe um nome de Sala entre 3 e 60 caracteres.'
      );
      return;
    }

    const placeIntent = this.buildPlaceIntent(rawValue);

    if (placeIntent === undefined) {
      return;
    }

    this.dialogRef.close({
      success: true,
      action: this.isEditing ? 'updated' : 'created',
      roomId: this.roomId || null,
      roomDetails: {
        roomName,
        description: rawValue.description.trim(),
        placeIntent,
      },
    } satisfies CreateRoomModalResult);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private initializeVenues(): void {
    if (!this.canUsePlaceIntent) {
      this.venues$ = of([]);
      return;
    }

    const uf = String(this.data?.defaultRegion?.uf ?? '').trim().toUpperCase();
    const city = String(this.data?.defaultRegion?.city ?? '').trim();

    if (!uf || !city) {
      this.venues$ = of([]);
      return;
    }

    this.venues$ = this.venueService
      .watchVenuesForRegion$(
        { uf, city },
        { limit: 60, includeSponsoredFirst: true }
      )
      .pipe(
        map((venues) => venues.filter((venue) => venue.chat.enabled)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
  }

  private buildPlaceIntent(
    rawValue: ReturnType<CreateRoomFormGroup['getRawValue']>
  ): IRoomPlaceIntentInput | null | undefined {
    if (!this.canUsePlaceIntent || !rawValue.placeEnabled) {
      return null;
    }

    const venueId = rawValue.placeVenueId.trim();
    const mode = rawValue.placeMode === 'scheduled' ? 'scheduled' : 'now';
    const startsAt =
      mode === 'scheduled'
        ? this.parseDateTimeLocal(rawValue.placeStartsAt)
        : Date.now();

    if (!venueId) {
      this.roomForm.controls.placeVenueId.setErrors({ required: true });
      this.roomForm.controls.placeVenueId.markAsTouched();
      this.validationFocus?.focusControl(
        'placeVenueId',
        'Selecione o local moderado vinculado à Sala.'
      );
      return undefined;
    }

    if (!startsAt || startsAt < Date.now() - 1000 * 60 * 5) {
      this.roomForm.controls.placeStartsAt.setErrors({ future: true });
      this.roomForm.controls.placeStartsAt.markAsTouched();
      this.validationFocus?.focusControl(
        'placeStartsAt',
        'Informe uma data e um horário futuros para a Sala.'
      );
      return undefined;
    }

    return {
      venueId,
      mode,
      startsAt,
    };
  }

  private parseDateTimeLocal(value: string): number | null {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      return null;
    }

    const millis = Date.parse(normalized);
    return Number.isFinite(millis) ? millis : null;
  }

  private toDateTimeLocalValue(value: unknown): string {
    const millis =
      typeof value === 'number' && Number.isFinite(value) ? value : null;

    if (!millis) {
      return '';
    }

    const date = new Date(millis);
    const pad = (unit: number) => String(unit).padStart(2, '0');

    return [
      date.getFullYear(),
      '-',
      pad(date.getMonth() + 1),
      '-',
      pad(date.getDate()),
      'T',
      pad(date.getHours()),
      ':',
      pad(date.getMinutes()),
    ].join('');
  }
}
