//src\app\store\store.module.ts
import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { reducers } from './reducers/combine.reducers';
import { environment } from '../../environments/environment';

// Se tiver efeitos, adicione-os aqui. Por exemplo:
// import { UserEffects } from './effects/user.effects';

@NgModule({
  imports: [
    StoreModule.forRoot(reducers),  // Passa os reducers combinados
    EffectsModule.forRoot([]),  // Adiciona os efeitos se necessário
    StoreDevtoolsModule.instrument({
      maxAge: 25, // Retém os últimos 25 estados
      logOnly: environment.production, // Habilita DevTools apenas no modo dev
    })
  ]
})
export class AppStoreModule { }
