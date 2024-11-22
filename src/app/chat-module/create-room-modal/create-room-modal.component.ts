//src\app\chat-module\create-room-modal\create-room-modal.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { RoomService } from 'src/app/core/services/batepapo/room.service';
import { RoomCreationConfirmationModalComponent } from '../room-creation-confirmation-modal/room-creation-confirmation-modal.component';

@Component({
    selector: 'app-create-room-modal',
    templateUrl: './create-room-modal.component.html',
    styleUrls: ['./create-room-modal.component.css'],
    standalone: false
})
export class CreateRoomModalComponent implements OnInit {
  roomForm!: FormGroup;
  isEditing: boolean = false;
  roomId: string = '';

  constructor(
    private formbuilder: FormBuilder,
    private roomService: RoomService,
    public dialogRef: MatDialogRef<CreateRoomModalComponent>,
    private dialog: MatDialog,
    @Inject(MAT_DIALOG_DATA) public data: any // Dados recebidos para edição
  ) { }

  ngOnInit(): void {
    this.initializeForm();

    // Carrega os dados da sala se estiver em modo de edição
    if (this.data?.isEditing) {
      this.isEditing = true;
      this.roomId = this.data.roomId;
      this.roomForm.patchValue({
        roomName: this.data.roomData.roomName,
        description: this.data.roomData.description || '', // Preenche com string vazia se não houver descrição
      });
    }
  }

  initializeForm(): void {
    this.roomForm = this.formbuilder.group({
      roomName: ['', Validators.required],
      description: ['']
    });
  }

  onSubmit() {
    if (!this.roomForm.valid) return;

    let roomDetails = {
      ...this.roomForm.value
  };

    if (!this.isEditing) {
      roomDetails.creationTime = new Date();
    }

  if (this.isEditing) {
      this.updateRoom(roomDetails);
    } else {
      this.createRoom(roomDetails);
    }
  }

  createRoom(roomDetails: any) {
    this.roomService.createRoom(roomDetails).subscribe({
      next: (result) => {
        this.handleSuccess('Sala criada com sucesso', roomDetails);
      },
      error: (error) => {
        this.handleError(error);
      }
    });
  }

  updateRoom(roomDetails: any) {
    this.roomService.updateRoom(this.roomId, roomDetails).then(() => {
      this.handleSuccess('Sala atualizada', roomDetails);
    }).catch((error) => {
      this.handleError(error);
    });
  }

  handleSuccess(action: string, roomDetails: any) {
    console.log(`Sala ${action} com sucesso`);
    const wasCreated = action === 'Sala criada com sucesso';

    this.dialogRef.close({ success: true, action: action, roomDetails: roomDetails });

      this.dialog.open(RoomCreationConfirmationModalComponent, {
        data: {
          roomName: roomDetails.roomName,
          action: wasCreated ? 'created' : 'updated',
          exceededLimit: false,
          roomCount: 1, // Isso também pode ser ajustado conforme a lógica de contagem de salas
        }
      });
    }

  handleError(error: any) {
    console.error(`Erro ao criar/atualizar a sala: ${error}`);
    alert(`Erro: ${error.message}`);
    this.dialogRef.close({ success: false, error: error.message });
  }
}
