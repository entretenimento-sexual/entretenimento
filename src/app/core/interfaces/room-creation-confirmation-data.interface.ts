//src\app\core\interfaces\room-creation-confirmation-data.interface.ts
export interface RoomCreationConfirmationData {
  roomName: string;
  exceededLimit: boolean;
  roomCount: number;
  action: 'created' | 'updated';
}
