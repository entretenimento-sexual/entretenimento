import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const guard = read('functions/src/shared/runtime/functions-runtime.guard.ts');
const payment = read('functions/src/payments/infrastructure/providers/asaas.provider.ts');
const push = read('functions/src/notifications/sendNotification.ts');
const admin = read('functions/src/firebaseApp.ts');
const frontendConfig = read('src/app/core/firebase/firebase-environment.config.ts');
const frontendProviders = read('src/app/core/firebase/firebase.providers.ts');

for (const [ok, label] of [
  [guard.includes("process.env.FUNCTIONS_EMULATOR === 'true'"), 'runtime source'],
  [guard.includes('assertExternalPaymentEgressAllowed'), 'payment guard'],
  [payment.includes('assertExternalPaymentEgressAllowed();'), 'Asaas request boundary'],
  [push.includes('if (isFunctionsEmulatorRuntime())'), 'push guard'],
  [push.includes('getMessaging().sendEachForMulticast'), 'FCM outbound boundary'],
  [guard.includes('assertFirebaseEmulatorDependenciesConfigured'), 'required Admin SDK emulator endpoints'],
  [admin.includes('assertFirebaseEmulatorDependenciesConfigured();'), 'Admin SDK startup guard'],
  [frontendConfig.includes('requireLocalFirebaseEmulatorEndpoint'), 'frontend local endpoint requirement'],
  [frontendProviders.includes("for (const kind of ['auth', 'firestore', 'storage', 'functions'] as const)"), 'frontend bootstrap topology'],
]) {
  if (!ok) throw new Error('[external-egress] Missing guard: ' + label);
}
const firstGuard = push.indexOf('if (isFunctionsEmulatorRuntime())');
const delivery = push.indexOf('getMessaging().sendEachForMulticast');
if (firstGuard >= delivery) {
  throw new Error('[external-egress] FCM guard must precede FCM network delivery');
}
console.log('[external-egress] OK: Asaas/FCM egress guarded; Admin SDK and Angular enforce local emulator endpoints.');
