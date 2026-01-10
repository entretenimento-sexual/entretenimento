// src/main.ts
import 'zone.js';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { setLogLevel } from 'firebase/firestore';

// ✅ Switch global de debug (ligado só em dev)
(window as any).__DBG_ON__ = !environment.production;

// ✅ Helper de log colorido e com timestamp (use window.DBG(...) no console)
function DBG(tag: string, ...args: any[]) {
  if (!(window as any).__DBG_ON__) return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`%c[${ts}] ${tag}`, 'color:#0bf;font-weight:600', ...args);
}
(window as any).DBG = DBG;

// Logs iniciais
console.log('[BOOT] main.ts começou', { ua: navigator.userAgent, base: document.baseURI });
console.info('[BOOT] start');

// Captura erros “perdidos” no bootstrap
window.addEventListener('error', (e) => {
  console.error('[window.error]', (e as any).error || (e as any).message || e);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', (e as any).reason || e);
});

if (!environment.enableDebugTools) {
  setLogLevel('error'); // ou 'silent'
}

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .then(() => {
    console.log('[Angular] bootstrap ok');
    DBG('[BOOTSTRAP]', { mode: environment.production ? 'prod' : 'dev' });
  })
  .catch(err => console.error('[bootstrapModule] erro:', err));
