//src\app\core\services\general\cache\cache-state.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { CacheState, SetCache } from './cache-state.service';

describe('CacheState (NGXS)', () => {
  let store: Store;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([CacheState])]
    });

    store = TestBed.inject(Store);
  });

  it('deve inicializar com estado vazio', () => {
    const state = store.selectSnapshot(CacheState.getCache);
    expect(state).toEqual({});
  });

  it('deve armazenar valores corretamente', () => {
    store.dispatch(new SetCache('chaveTeste', 'valorTeste'));
    const state = store.selectSnapshot(CacheState.getCache);
    expect(state['chaveTeste']).toBe('valorTeste');
  });
});
