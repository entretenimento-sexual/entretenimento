//src\app\store\states\states.user\user.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export interface IUserState {
  /**
   * Entidades indexadas por UID.
   * Mantemos esse shape para compatibilidade com o restante do projeto.
   */
  users: { [uid: string]: IUserDados };

  /**
   * Espelho do current user no NgRx.
   * A fonte de verdade do runtime continua sendo o CurrentUserStoreService.
   */
  currentUser: IUserDados | null;

  /**
   * Flags explícitas do ciclo de hidratação do current user.
   *
   * currentUserHydrated:
   * - false => ainda não conseguimos afirmar que o perfil do app está resolvido
   * - true  => o store já concluiu uma decisão sobre o current user
   *
   * currentUserLoading:
   * - true  => observação/hidratação do users/{uid} em andamento
   * - false => ciclo atual parado ou concluído
   */
  currentUserHydrated: boolean;
  currentUserLoading: boolean;

  /**
   * Presença/listas derivadas.
   * Online users continuam vindo do fluxo oficial de presença/query.
   */
  onlineUsers: IUserDados[];
  filteredUsers: IUserDados[];

  /**
   * Loading da lista geral de usuários.
   * Não misturar com currentUserLoading.
   */
  loading: boolean;

  /**
   * Último erro serializado relevante ao domínio user.
   */
  error: unknown | null;
}

export const initialUserState: IUserState = {
  users: {},
  currentUser: null,

  currentUserHydrated: false,
  currentUserLoading: false,

  onlineUsers: [],
  filteredUsers: [],

  loading: false,
  error: null,
};
