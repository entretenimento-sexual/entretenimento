// src/app/store/states/user.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
/** Interface que define a estrutura do estado relacionado aos usuários no aplicativo. */

export interface IUserState {  /**   * Lista completa de usuários armazenados no estado.   */
  users: IUserDados[];
  currentUser: IUserDados | null;
  onlineUsers: IUserDados[];  // Lista de usuários online separada
  filteredUsers: IUserDados[];  /**Indicador de carregamento.*/
  loading: boolean;
  /**
   * Armazena qualquer erro que ocorra durante a operação relacionada aos usuários.
   * Pode ser utilizado para exibir mensagens de erro na interface do usuário.
   */
  error: any;
}
/**
 * Estado inicial para o gerenciador de estado dos usuários.
 */
export const initialUserState: IUserState = {  /**Inicialmente, a lista de usuários está vazia.*/
  users: [], /**Inicialmente, a lista de usuários online também está vazia.*/
  currentUser: null,
  onlineUsers: [], /**Inicialmente, a lista de usuários filtrados também está vazia.*/
  filteredUsers: [],  /**   * O carregamento não está em progresso inicialmente.   */
  loading: false,  /**Não há erros inicialmente.*/
  error: null,
};
