// src\app\core\interfaces\user.interface.ts
export interface User {
  id: string;
  name: string;
  // outros campos que você precisa...
  role: 'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase';
}
