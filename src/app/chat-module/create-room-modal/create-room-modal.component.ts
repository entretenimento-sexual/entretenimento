//src\app\chat-module\create-room-modal\create-room-modal.component.ts
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { RoomService } from 'src/app/core/services/batepapo/room.service';
import { GenericModalComponent } from 'src/app/shared/components-globais/generic-modal/generic-modal.component';

@Component({
  selector: 'app-create-room-modal',
  templateUrl: './create-room-modal.component.html',
  styleUrls: ['./create-room-modal.component.css']
})

export class CreateRoomModalComponent implements OnInit {
  roomForm!: FormGroup;

  constructor(
    private formbuilder: FormBuilder,
    private roomService: RoomService, // Assumindo que este serviço contém a lógica para interagir com o Firestore
    public dialogRef: MatDialogRef<CreateRoomModalComponent>,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void {
    this.roomForm = this.formbuilder.group({
      roomName: ['', Validators.required],
      description: ['']
    });
  }

  createRoom() {
    if (this.roomForm.valid) {
      const roomDetails = {
        ...this.roomForm.value,
        creationTime: new Date() // Definindo automaticamente no momento da criação
      };
      // Chamada ao serviço para criar a sala no Firestore
      this.roomService.createRoom(roomDetails).subscribe({
        next: (roomId) => {
          console.log(`Sala criada com sucesso: ${roomId}`);
          this.dialogRef.close({ success: true });

          this.dialog.open(GenericModalComponent, {
            data: { message: `A sala '${roomDetails.roomName}' foi criada com sucesso!` }
          });

        },
        error: (error) => {
          console.error(`Erro ao criar a sala: ${error}`);
          alert(error.message); // Fornece feedback ao usuário
          this.dialogRef.close({ success: false, error: error.message }); // Pode optar por não fechar o modal em caso de erro
        }
      });
    }
  }
}
