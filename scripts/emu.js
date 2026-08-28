// scripts/emu.js
const tcp = require('tcp-port-used');
const { spawn } = require('child_process');
const open = require('open');

const HOST = '127.0.0.1';
// portas padrão do suite
const PORTS = {
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  functions: 5001,
  ui: 4000,   // se não tiver, seguimos mesmo assim
};

async function isListening(port) {
  try {
    return await tcp.check(port, HOST);
  } catch {
    return false;
  }
}

(async () => {
  // critério mínimo: Auth e Firestore já ligados
  const [authUp, fsUp, stUp, fnUp, uiUp] = await Promise.all([
    isListening(PORTS.auth),
    isListening(PORTS.firestore),
    isListening(PORTS.storage),
    isListening(PORTS.functions),
    isListening(PORTS.ui),
  ]);

  const coreRunning = authUp && fsUp; // o essencial
  if (coreRunning) {
    console.log('✅ Emuladores já estão rodando — reaproveitando a conexão.');
    console.log(`   Auth     : http://${HOST}:${PORTS.auth}`);
    console.log(`   Firestore: http://${HOST}:${PORTS.firestore}`);
    if (stUp) console.log(`   Storage  : http://${HOST}:${PORTS.storage}`);
    if (fnUp) console.log(`   Functions: http://${HOST}:${PORTS.functions}`);
    if (uiUp) {
      console.log(`   UI       : http://${HOST}:${PORTS.ui}`);
      try { await open(`http://${HOST}:${PORTS.ui}`); } catch {}
    } else {
      console.log('   UI não detectada nesta porta (4000).');
    }
    // Mantemos o processo vivo? Não precisa — seu Angular conecta por host:porta.
    process.exit(0);
  }

  console.log('ℹ️  Emuladores não detectados — iniciando suite padrão...');
  const args = ['emulators:start', '--only', 'auth,firestore,storage,functions,ui'];
  const child = spawn('firebase', args, { stdio: 'inherit', shell: true });

  child.on('close', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill('SIGINT'));
})();
