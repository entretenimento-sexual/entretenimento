// src/app/chat-module/modals/room-create-confirm-modal/room-creation-confirmation-modal.component.ts
// -----------------------------------------------------------------------------
// ROOM CREATION CONFIRMATION MODAL COMPONENT
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - apresentar confirmação visual após criação/atualização de sala;
// - tolerar payload incompleto sem derrubar a aplicação.
//
// Segurança e UX:
// - não orienta envio de convites enquanto o fluxo de participação ainda não
//   estiver protegido por Functions e Rules definitivas;
// - não acessa propriedades aninhadas sem validação prévia.
//
// Compatibilidade:
// - preserva o contrato RoomCreationConfirmation;
// - mantém close() e a nomenclatura pública já utilizada pelo template.

import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { RoomCreationConfirmation } from 'src/app/core/interfaces/interfaces-chat/room.interface';

interface RoomCreationConfirmationViewModel {
  action: 'created' | 'updated';
  exceededLimit: boolean;
  roomCount: number | null;
  roomName: string | null;
}

@Component({
  selector: 'app-room-creation-confirmation-modal',
  templateUrl: './room-creation-confirmation-modal.component.html',
  styleUrls: ['./room-creation-confirmation-modal.component.css'],
  standalone: false,
})
export class RoomCreationConfirmationModalComponent {
  readonly vm: RoomCreationConfirmationViewModel;

  constructor(
    @Inject(MAT_DIALOG_DATA)
    public readonly data: Partial<RoomCreationConfirmation> | null | undefined,
    private readonly dialogRef: MatDialogRef<RoomCreationConfirmationModalComponent>
  ) {
    this.vm = this.buildViewModel(data);
  }

  close(): void {
    this.dialogRef.close();
  }

  /**
   * Normaliza o payload recebido pelo modal.
   *
   * Mesmo que algum chamador legado envie dados incompletos, o template não
   * deve lançar erro em ciclo de detecção e comprometer toda a tela.
   */
  private buildViewModel(
    data: Partial<RoomCreationConfirmation> | null | undefined
  ): RoomCreationConfirmationViewModel {
    const roomName = String(data?.room?.roomName ?? '').trim();

    const roomCount =
      typeof data?.roomCount === 'number' &&
      Number.isFinite(data.roomCount) &&
      data.roomCount >= 0
        ? Math.trunc(data.roomCount)
        : null;

    return {
      action: data?.action === 'updated' ? 'updated' : 'created',
      exceededLimit: data?.exceededLimit === true,
      roomCount,
      roomName: roomName || null,
    };
  }
}