//src\app\chat-module\room-creation-confirmation\room-creation-confirmation-modal.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { IRoom, RoomCreationConfirmation } from 'src/app/core/interfaces/interfaces-chat/room.interface';

@Component({
  selector: 'app-room-creation-confirmation-modal',
  templateUrl: './room-creation-confirmation-modal.component.html',
  styleUrls: ['./room-creation-confirmation-modal.component.css'],
  standalone: false
})
export class RoomCreationConfirmationModalComponent {
  // data agora é RoomCreationConfirmation (tem action, exceededLimit, roomCount e room: IRoom)
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: RoomCreationConfirmation,
    private dialogRef: MatDialogRef<RoomCreationConfirmationModalComponent>
  ) { }

  close() {
    this.dialogRef.close();
  }
}
