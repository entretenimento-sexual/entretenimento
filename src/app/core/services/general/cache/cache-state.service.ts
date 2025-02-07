//src\app\core\services\general\cache\cache-state.service.ts
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
