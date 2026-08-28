//src\app\core\interfaces\interfaces-chat\community.interface.ts
export interface Community {
  id?: string;
  name: string;
  description?: string;
  createdBy: string; // ID do criador
  createdAt?: any;
  privacy?: 'public' | 'private'; // Controle de entrada
  members?: string[]; // IDs dos membros
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
