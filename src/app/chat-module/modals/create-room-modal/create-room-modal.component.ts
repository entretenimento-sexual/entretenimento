// src/app/chat-module/modals/create-room-modal/create-room-modal.component.ts
// -----------------------------------------------------------------------------
// CREATE ROOM MODAL COMPONENT
// -----------------------------------------------------------------------------
//
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
//   reativa da lista de salas.

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

export interface CreateRoomModalData {
  isEditing?: boolean;
  roomId?: string;
  roomData?: {
    roomName?: string | null;
    description?: string | null;
  } | null;
}

export interface CreateRoomModalResult {
  success: true;
  action: 'created' | 'updated';
  roomId: string | null;
  roomDetails: {
    roomName: string;
    description: string;
  };
}

type CreateRoomFormGroup = FormGroup<{
  roomName: FormControl<string>;
  description: FormControl<string>;
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
  }

  initializeForm(): void {
    this.roomForm = this.formBuilder.nonNullable.group({
      roomName: ['', [Validators.required]],
      description: [''],
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

    this.dialogRef.close({
      success: true,
      action: this.isEditing ? 'updated' : 'created',
      roomId: this.roomId || null,
      roomDetails: {
        roomName,
        description: rawValue.description.trim(),
      },
    } satisfies CreateRoomModalResult);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}