// src/main.ts
// =============================================================================
// BOOTSTRAP PRINCIPAL DA APLICAÇÃO
//
// Responsabilidades deste arquivo:
// - carregar zone.js
// - configurar nível de log do Firestore
// - expor ferramentas globais de debug em desenvolvimento
// - expor helpers úteis para o Auth Emulator
// - capturar erros globais de boot / promises perdidas
// - inicializar o AppModule
//
// Observação importante:
// - Este arquivo NÃO contém lógica de negócio.
// - Aqui ficam apenas ferramentas de bootstrap, debug e suporte ao ambiente.
// =============================================================================

import 'zone.js';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { setLogLevel } from 'firebase/firestore';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

// =============================================================================
// Constantes globais de debug / emulator
// =============================================================================

/**
 * Liga/desliga logs manuais de debug via localStorage.
 *
 * Uso no console:
 * - dbgOn()
 * - dbgOff()
 * - dbgStatus()
 */
const DBG_KEY = '__DBG_ON__';

/**
 * Chave usada para controlar a persistência do Auth no emulator.
 *
 * Valores suportados:
 * - "memory"
 * - "session"
 *
 * Importante:
 * - Esta mesma chave é lida no AppModule.
 * - Portanto, o nome precisa permanecer sincronizado.
 */
const EMU_AUTH_PERSIST_KEY = '__EMU_AUTH_PERSIST__';

type EmuAuthPersistMode = 'memory' | 'session';

// =============================================================================
// Tipagem dos helpers globais expostos no window
// =============================================================================

declare global {
  interface Window {
    __DBG_ON__?: boolean;
    DBG?: (...args: unknown[]) => void;

    dbgOn?: () => void;
    dbgOff?: () => void;
    dbgStatus?: () => { on: boolean; key: string };

    getEmuAuthPersistMode?: () => EmuAuthPersistMode;
    setEmuAuthPersistMode?: (mode: EmuAuthPersistMode) => void;

    /**
     * Alias de compatibilidade com helper antigo.
     * Mantido para não quebrar o seu fluxo atual no console.
     */
    setEmuAuthPersistence?: (mode: EmuAuthPersistMode) => void;

    clearEmuAuthPersistMode?: () => void;
    wipeFirebaseAuthPersistence?: () => Promise<void>;
  }
}

// =============================================================================
// Helpers locais
// =============================================================================

const isBrowser = typeof window !== 'undefined';

const debugAllowedByEnv =
  !environment.production && environment.enableDebugTools === true;

/**
 * Debug fica OFF por padrão.
 * Só liga se:
 * - não for production
 * - enableDebugTools estiver true
 * - localStorage[DBG_KEY] === '1'
 */
const debugEnabled =
  isBrowser &&
  debugAllowedByEnv &&
  localStorage.getItem(DBG_KEY) === '1';

/**
 * Wrapper local para usar o DBG global sem risco de quebrar o boot.
 */
function safeDbg(message: string, extra?: unknown): void {
  try {
    if (!isBrowser) return;
    window.DBG?.(message, extra ?? '');
  } catch {
    // noop
  }
}

/**
 * Lê o modo atual de persistência do Auth Emulator.
 *
 * REGRA DO PROJETO:
 * - default = session
 *
 * Motivo:
 * - a sessão deve sobreviver ao refresh também em dev-emu
 * - "memory" fica disponível apenas como ferramenta manual de troubleshooting
 */
function readEmuAuthPersistMode(): EmuAuthPersistMode {
  if (!isBrowser) return 'session';

  const raw = (localStorage.getItem(EMU_AUTH_PERSIST_KEY) || '')
    .trim()
    .toLowerCase();

  return raw === 'memory' ? 'memory' : 'session';
}

/**
 * Remove o IndexedDB do Firebase Auth persistido localmente.
 * Isso ajuda a limpar sessões antigas/ghost quando o usuário quiser reset manual.
 */
async function deleteFirebaseAuthIndexedDb(): Promise<void> {
  if (!isBrowser || typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase('firebaseLocalStorageDb');

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// =============================================================================
// Firestore log level
// =============================================================================

/**
 * Firestore log:
 * - production: error
 * - desenvolvimento: silent
 *
 * Observação:
 * - "silent" reduz ruído no console
 * - o debug manual continua disponível via window.DBG
 */
setLogLevel(environment.production ? 'error' : 'silent');

// =============================================================================
// Configuração do DBG global
// =============================================================================

if (isBrowser) {
  window.__DBG_ON__ = debugEnabled;

  /**
   * Helper global de debug.
   *
   * Exemplo:
   * window.DBG?.('[AUTH]', { uid: '123' });
   */
  window.DBG = (...args: unknown[]) => {
    if (window.__DBG_ON__ !== true) return;
    // eslint-disable-next-line no-console
    console.log(...args);
  };
}

// =============================================================================
// Helpers globais de debug (dev only)
// =============================================================================

if (isBrowser && debugAllowedByEnv) {
  /**
   * Liga o debug e recarrega a aplicação.
   */
  window.dbgOn = () => {
    localStorage.setItem(DBG_KEY, '1');
    location.reload();
  };

  /**
   * Desliga o debug e recarrega a aplicação.
   */
  window.dbgOff = () => {
    localStorage.removeItem(DBG_KEY);
    location.reload();
  };

  /**
   * Consulta rápida do estado atual do debug.
   */
  window.dbgStatus = () => ({
    on: window.__DBG_ON__ === true,
    key: DBG_KEY,
  });

  safeDbg('[DBG] enabled', {
    env: environment.env,
    useEmulators: environment.useEmulators,
    enableDebugTools: environment.enableDebugTools,
    debugEnabled,
  });
}

// =============================================================================
// Helpers do Auth Emulator (somente dev-emu)
// =============================================================================

if (isBrowser && !environment.production && environment.env === 'dev-emu') {
  /**
   * Retorna o modo atual de persistência do Auth no emulator.
   */
  window.getEmuAuthPersistMode = () => readEmuAuthPersistMode();

  /**
   * Define o modo de persistência do Auth Emulator e recarrega a aplicação.
   *
   * Modos:
   * - session -> padrão do projeto, mantém sessão no refresh
   * - memory  -> ferramenta manual de troubleshooting
   */
  window.setEmuAuthPersistMode = (mode: EmuAuthPersistMode) => {
    const nextMode: EmuAuthPersistMode =
      mode === 'memory' ? 'memory' : 'session';

    localStorage.setItem(EMU_AUTH_PERSIST_KEY, nextMode);

    safeDbg('[DEV-EMU] Auth persistence mode updated', {
      mode: nextMode,
      key: EMU_AUTH_PERSIST_KEY,
    });

    location.reload();
  };

  /**
   * Alias de compatibilidade com o helper antigo.
   */
  window.setEmuAuthPersistence = (mode: EmuAuthPersistMode) => {
    window.setEmuAuthPersistMode?.(mode);
  };

  /**
   * Limpa a chave explícita do modo do emulator.
   * Após isso, o fallback volta para "session".
   */
  window.clearEmuAuthPersistMode = () => {
    localStorage.removeItem(EMU_AUTH_PERSIST_KEY);

    safeDbg('[DEV-EMU] Auth persistence mode cleared', {
      fallbackMode: 'session',
      key: EMU_AUTH_PERSIST_KEY,
    });

    location.reload();
  };

  /**
   * Limpa persistências locais relacionadas ao Firebase Auth.
   *
   * Objetivo:
   * - remover sessão antiga persistida no browser
   * - reduzir cenários de "sessão fantasma"
   * - útil após reset/limpeza do Auth Emulator
   *
   * Importante:
   * - esta ação é manual
   * - não deve rodar automaticamente no boot
   */
  window.wipeFirebaseAuthPersistence = async () => {
    try {
      const apiKey = environment.firebase.apiKey;

      /**
       * Prefixos típicos usados pelo Firebase Auth no browser.
       * Limpamos apenas o que é relevante, sem apagar storage inteiro.
       */
      const removablePrefixes = [
        `firebase:authUser:${apiKey}:`,
        'firebase:authEvent:',
        'firebase:previous_websocket_failure',
      ];

      for (const key of Object.keys(localStorage)) {
        if (removablePrefixes.some((prefix) => key.startsWith(prefix))) {
          localStorage.removeItem(key);
        }
      }

      for (const key of Object.keys(sessionStorage)) {
        if (removablePrefixes.some((prefix) => key.startsWith(prefix))) {
          sessionStorage.removeItem(key);
        }
      }

      await deleteFirebaseAuthIndexedDb();

      safeDbg('[DEV-EMU] Firebase Auth persistence wiped', {
        apiKeyMasked: `${environment.firebase.apiKey.slice(0, 4)}***`,
      });
    } finally {
      location.reload();
    }
  };

  safeDbg('[DEV-EMU] Auth persistence mode', {
    mode: readEmuAuthPersistMode(),
    key: EMU_AUTH_PERSIST_KEY,
  });
}

// =============================================================================
// Captura global de erros “perdidos”
// =============================================================================

/**
 * Mantemos esses listeners sempre registrados no browser.
 *
 * Motivo:
 * - ajudam a capturar erros fora do fluxo Angular
 * - não poluem o console quando o debug está desligado
 * - quando o debug está ligado, deixam rastros úteis no boot
 */
if (isBrowser) {
  window.addEventListener('error', (event) => {
    safeDbg('[window.error]', (event as any)?.error || (event as any)?.message || event);
  });

  window.addEventListener('unhandledrejection', (event) => {
    safeDbg('[unhandledrejection]', (event as any)?.reason || event);
  });
}

// =============================================================================
// Bootstrap Angular
// =============================================================================

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .then(() => {
    safeDbg('[BOOTSTRAP] AppModule ok', {
      env: environment.env,
      production: environment.production,
    });
  })
  .catch((err) => {
    /**
     * Erro de bootstrap é crítico.
     * Aqui usamos console.error de propósito.
     */
    // eslint-disable-next-line no-console
    console.error('[bootstrapModule] erro crítico:', err);

    safeDbg('[BOOTSTRAP] AppModule failed', err);
  });
