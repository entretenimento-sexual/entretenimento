// src/app/store/states/user.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export interface IUserState {  /**   * Lista completa de usuários armazenados no estado.   */
  users: { [uid: string]: IUserDados }; // Transformado para objeto indexado por UID
  currentUser: IUserDados | null;
  onlineUsers: IUserDados[];  // Lista de usuários online separada
  filteredUsers: IUserDados[];  /**Indicador de carregamento.*/
  loading: boolean;
   //Armazena qualquer erro que ocorra durante a operação relacionada aos usuários.
   //Pode ser utilizado para exibir mensagens de erro na interface do usuário.
  error: any;
}

export const initialUserState: IUserState = {  /**Inicialmente, a lista de usuários está vazia.*/
  users: {}, // Inicialmente, objeto vazio
  currentUser: null,
  onlineUsers: [], /**Inicialmente, a lista de usuários filtrados também está vazia.*/
  filteredUsers: [],  /**   * O carregamento não está em progresso inicialmente.   */
  loading: false,  /**Não há erros inicialmente.*/
  error: null,
};
/*CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
//logout() do auth.service.ts que está sendo descontinuado
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
Compatibilizar o estado online do usuário com o presence.service e aproximar do funcionamento ideal
*/
