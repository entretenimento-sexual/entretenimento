// src\main.ts
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
// Iniciando o Angular App
platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.log(err));
