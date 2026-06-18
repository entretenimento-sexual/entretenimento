// src/app/chat-module/modals/create-room-modal/create-room-modal.component.ts
// -----------------------------------------------------------------------------
// CREATE ROOM MODAL COMPONENT
// -----------------------------------------------------------------------------
// Responsabilidade:
// - apresentar e validar o formulário;
// - devolver os dados preenchidos ao componente chamador.
//
// Não faz:
// - não acessa autenticação;
// - não grava no Firestore;
// - não abre modal de confirmação;
// - não trata erro de persistência.
//
// Motivo:
// - a mutação deve possuir um único dono;
// - o container que abriu o modal já controla permissão, uid e atualização
//   reativa da lista de salas;
// - o backend continua validando plano e autorização real para local da room.

import { Component, Inject, OnInit } from '@angular/core';
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

import {
  IRoomPlaceIntent,
  IRoomPlaceIntentInput,
  RoomPlaceIntentMode,
} from 'src/app/core/interfaces/interfaces-chat/room.interface';

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
  placeUf: FormControl<string>;
  placeCity: FormControl<string>;
  placeLabel: FormControl<string>;
  placeStartsAt: FormControl<string>;
}>;

@Component({
  selector: 'app-create-room-modal',
  templateUrl: './create-room-modal.component.html',
  styleUrls: ['./create-room-modal.component.css'],
  standalone: false,
})
export class CreateRoomModalComponent implements OnInit {
  roomForm!: CreateRoomFormGroup;
  isEditing = false;
  roomId = '';

  constructor(
    private readonly formBuilder: FormBuilder,
    public readonly dialogRef: MatDialogRef<CreateRoomModalComponent>,
    @Inject(MAT_DIALOG_DATA)
    public readonly data: CreateRoomModalData | null
  ) {}

  get canUsePlaceIntent(): boolean {
    return this.data?.canUsePlaceIntent === true;
  }

  ngOnInit(): void {
    this.initializeForm();

    if (this.data?.isEditing === true) {
      this.isEditing = true;
      this.roomId = String(this.data.roomId ?? '').trim();

      this.roomForm.patchValue({
        roomName: String(this.data.roomData?.roomName ?? ''),
        description: String(this.data.roomData?.description ?? ''),
      });
    }

    const placeIntent = this.data?.roomData?.placeIntent;

    if (this.canUsePlaceIntent && placeIntent) {
      this.roomForm.patchValue({
        placeEnabled: true,
        placeMode: placeIntent.mode === 'scheduled' ? 'scheduled' : 'now',
        placeUf: String(placeIntent.region?.uf ?? '').toUpperCase(),
        placeCity: String(placeIntent.region?.city ?? ''),
        placeLabel: String(placeIntent.label ?? ''),
        placeStartsAt: this.toDateTimeLocalValue(placeIntent.startsAt),
      });
    }
  }

  initializeForm(): void {
    const defaultUf = String(this.data?.defaultRegion?.uf ?? '').toUpperCase();
    const defaultCity = String(this.data?.defaultRegion?.city ?? '');

    this.roomForm = this.formBuilder.nonNullable.group({
      roomName: ['', [Validators.required]],
      description: [''],
      placeEnabled: [false],
      placeMode: ['now' as RoomPlaceIntentMode],
      placeUf: [defaultUf],
      placeCity: [defaultCity],
      placeLabel: [''],
      placeStartsAt: [''],
    });
  }

  onSubmit(): void {
    if (this.roomForm.invalid) {
      this.roomForm.markAllAsTouched();
      return;
    }

    const rawValue = this.roomForm.getRawValue();
    const roomName = rawValue.roomName.trim();

    if (!roomName) {
      this.roomForm.controls.roomName.setErrors({ required: true });
      this.roomForm.controls.roomName.markAsTouched();
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

  private buildPlaceIntent(
    rawValue: ReturnType<CreateRoomFormGroup['getRawValue']>
  ): IRoomPlaceIntentInput | null | undefined {
    if (!this.canUsePlaceIntent || !rawValue.placeEnabled) {
      return null;
    }

    const uf = rawValue.placeUf.trim().toUpperCase();
    const city = rawValue.placeCity.trim().toLowerCase();
    const label = rawValue.placeLabel.trim();
    const mode = rawValue.placeMode === 'scheduled' ? 'scheduled' : 'now';
    const startsAt =
      mode === 'scheduled'
        ? this.parseDateTimeLocal(rawValue.placeStartsAt)
        : Date.now();

    if (!/^[A-Z]{2}$/.test(uf)) {
      this.roomForm.controls.placeUf.setErrors({ uf: true });
      this.roomForm.controls.placeUf.markAsTouched();
      return undefined;
    }

    if (!city) {
      this.roomForm.controls.placeCity.setErrors({ required: true });
      this.roomForm.controls.placeCity.markAsTouched();
      return undefined;
    }

    if (label.length < 3 || label.length > 80) {
      this.roomForm.controls.placeLabel.setErrors({ size: true });
      this.roomForm.controls.placeLabel.markAsTouched();
      return undefined;
    }

    if (!startsAt) {
      this.roomForm.controls.placeStartsAt.setErrors({ required: true });
      this.roomForm.controls.placeStartsAt.markAsTouched();
      return undefined;
    }

    return {
      mode,
      visibility: 'room_members',
      region: { uf, city },
      label,
      startsAt,
      endsAt: null,
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
    const millis = typeof value === 'number' && Number.isFinite(value) ? value : null;

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
