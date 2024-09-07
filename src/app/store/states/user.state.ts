// src/app/store/states/user.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

/**
 * Interface que define a estrutura do estado relacionado aos usuários no aplicativo.
 */
export interface UserState {
  /**
   * Lista completa de usuários armazenados no estado.
   * Esse array pode conter todos os usuários carregados do Firestore.
   */
  users: IUserDados[];

  /**
   * Lista filtrada de usuários.
   * Pode ser usada para armazenar usuários que atendem a determinados critérios,
   * como usuários online de um município específico.
   */
  filteredUsers: IUserDados[];

  /**
   * Indicador de carregamento.
   * É `true` quando os dados de usuários estão sendo carregados e `false` caso contrário.
   */
  loading: boolean;

  /**
   * Armazena qualquer erro que ocorra durante a operação relacionada aos usuários.
   * Pode ser utilizado para exibir mensagens de erro na interface do usuário.
   */
  error: any;
}

/**
 * Estado inicial para o gerenciador de estado dos usuários.
 * Define os valores iniciais quando o aplicativo é carregado.
 */
export const initialUserState: UserState = {
  /**
   * Inicialmente, a lista de usuários está vazia.
   */
  users: [],

  /**
   * Inicialmente, a lista de usuários filtrados também está vazia.
   */
  filteredUsers: [],

  /**
   * O carregamento não está em progresso inicialmente.
   */
  loading: false,

  /**
   * Não há erros inicialmente.
   */
  error: null,
};
