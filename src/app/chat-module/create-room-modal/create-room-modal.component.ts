//src\app\chat-module\create-room-modal\create-room-modal.component.ts
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RoomService } from 'src/app/core/services/batepapo/room.service';

@Component({
  selector: 'app-create-room-modal',
  templateUrl: './create-room-modal.component.html',
  styleUrls: ['./create-room-modal.component.css']
})

export class CreateRoomModalComponent implements OnInit {
  roomForm!: FormGroup;

  constructor(
    private formbuilder: FormBuilder,
    private roomService: RoomService // Assumindo que este serviço contém a lógica para interagir com o Firestore
  ) { }

  ngOnInit(): void {
    this.roomForm = this.formbuilder.group({
      roomName: ['', Validators.required],
      description: [''],
      creationTime: [new Date(), Validators.required] // Pode ser definido automaticamente ou pelo usuário
    });
  }

  createRoom() {
    if (this.roomForm.valid) {
      const roomDetails = this.roomForm.value;
      // Substitua com a lógica para chamar o serviço e criar a sala no Firestore
      this.roomService.createRoom(roomDetails).subscribe({
        next: (roomId) => console.log(`Sala criada com sucesso: ${roomId}`),
        error: (error) => console.error(`Erro ao criar a sala: ${error}`)
      });
    }
  }
}
