//src\app\chat-module\room-creation-confirmation\room-creation-confirmation-modal.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-room-creation-confirmation-modal',
  templateUrl: './room-creation-confirmation-modal.component.html',
  styleUrls: ['./room-creation-confirmation-modal.component.css']
})
export class RoomCreationConfirmationModalComponent {
  constructor(@Inject(MAT_DIALOG_DATA)
  public data: {
    roomId: string;
    roomName: string;
    exceededLimit: boolean;
    roomCount: number,
  },
  private dialogRef: MatDialogRef<RoomCreationConfirmationModalComponent>
  )
  { }

  close() {
    this.dialogRef.close();
  }
}
