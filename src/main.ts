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
  console.log(...args);
};

// ✅ helpers práticos
if (typeof window !== 'undefined' && !environment.production && environment.enableDebugTools) {
  (window as any).dbgOn = () => { localStorage.setItem(DBG_KEY, '1'); location.reload(); };
  (window as any).dbgOff = () => { localStorage.removeItem(DBG_KEY); location.reload(); };
  (window as any).dbgStatus = () => ({ on: (window as any).__DBG_ON__ === true, key: DBG_KEY });

  // log de boot (só aparece se dbgOn)
  (window as any).DBG?.('[DBG] enabled', {
    env: environment.env,
    useEmulators: environment.useEmulators,
    enableDebugTools: environment.enableDebugTools
  });
}

// ✅ sempre ligado: captura erros “perdidos”
window.addEventListener('error', (e) => {
  //console.error('[window.error]', (e as any).error || (e as any).message || e);
});
window.addEventListener('unhandledrejection', (e) => {
  //console.error('[unhandledrejection]', (e as any).reason || e);
});
const EMU_AUTH_PERSIST_KEY = '__EMU_AUTH_PERSIST__';

if (!environment.production && environment.env === 'dev-emu' && typeof window !== 'undefined') {
  // ✅ troca modo (memory/session) e recarrega
  (window as any).setEmuAuthPersistence = (mode: 'memory' | 'session') => {
    localStorage.setItem(EMU_AUTH_PERSIST_KEY, mode);
    location.reload();
  };

  // ✅ limpa “sessão fantasma” (IndexedDB + local/session storage) e recarrega
  (window as any).wipeFirebaseAuthPersistence = async () => {
    try {
      const apiKey = environment.firebase.apiKey;

      // localStorage keys típicas do Auth
      const prefixes = [
        `firebase:authUser:${apiKey}:`,
        `firebase:previous_websocket_failure`,
      ];

      for (const k of Object.keys(localStorage)) {
        if (prefixes.some(p => k.startsWith(p))) localStorage.removeItem(k);
      }

      for (const k of Object.keys(sessionStorage)) {
        if (prefixes.some(p => k.startsWith(p))) sessionStorage.removeItem(k);
      }

      // IndexedDB do Firebase Auth (nome padrão)
      await new Promise<void>((resolve) => {
        try {
          const req = indexedDB.deleteDatabase('firebaseLocalStorageDb');
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        } catch {
          resolve();
        }
      });
    } finally {
      location.reload();
    }
  };

  // log rápido do modo atual
  try {
    const mode = localStorage.getItem(EMU_AUTH_PERSIST_KEY) || 'memory';
    (window as any).DBG?.('[DEV-EMU] Auth persistence mode:', mode);
  } catch { }
}

platformBrowserDynamic()
  .bootstrapModule(AppModule)
 // .catch(err => console.error('[bootstrapModule] erro:', err));
