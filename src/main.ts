// src/main.ts
import 'zone.js';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { setLogLevel } from 'firebase/firestore';

setLogLevel(environment.production ? 'error' : 'silent');

const DBG_KEY = '__DBG_ON__';

// ✅ Debug OFF por padrão. Liga manualmente via localStorage.
const dbgOn =
  !environment.production &&
  environment.enableDebugTools === true &&
  typeof window !== 'undefined' &&
  localStorage.getItem(DBG_KEY) === '1';

(window as any).__DBG_ON__ = dbgOn;

// ✅ helper opcional: não loga nada se dbgOff
(window as any).DBG = (...args: any[]) => {
  if (!(window as any).__DBG_ON__) return;
  //console.log(...args);
};

// ✅ sempre ligado: captura erros “perdidos”
window.addEventListener('error', (e) => {
  //console.error('[window.error]', (e as any).error || (e as any).message || e);
});
window.addEventListener('unhandledrejection', (e) => {
  //console.error('[unhandledrejection]', (e as any).reason || e);
});


platformBrowserDynamic()
  .bootstrapModule(AppModule)
 // .catch(err => console.error('[bootstrapModule] erro:', err));
