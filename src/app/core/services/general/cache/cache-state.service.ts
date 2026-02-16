//src\app\core\services\general\cache\cache-state.service.ts
// Este serviço é um exemplo simples de como implementar um estado de cache usando NGXS.
// Ele define uma ação para atualizar o cache e um estado que armazena os dados em um objeto chave-valor.
// O CacheState pode ser expandido para incluir métodos adicionais, como remoção de cache ou limpeza total, conforme necessário.
// Importações necessárias do NGXS  e Angular
// Não esqueça de adicionar comentários explicativos sobre a função de cada parte do código para facilitar a manutenção futura e a compreensão por outros desenvolvedores.
import { State, Action, StateContext, Selector } from '@ngxs/store';

// Definição da ação
export class SetCache {
  static readonly type = '[Cache] Set';
  constructor(public key: string, public value: any) { }
}

// Estado do cache
@State<{ [key: string]: any }>({
  name: 'cache',
  defaults: {}
})
export class CacheState {

  @Selector()
  static getCache(state: { [key: string]: any }) {
    return state;
  }

  @Action(SetCache)
  setCache(ctx: StateContext<{ [key: string]: any }>, action: SetCache) {
    const state = ctx.getState();
    ctx.setState({
      ...state,
      [action.key]: action.value
    });
  }
}
