// src/environments/environment.ts
// -----------------------------------------------------------------------------
// PADRÃO SEGURO DE DESENVOLVIMENTO LOCAL
// -----------------------------------------------------------------------------
// `ng serve`, `npm start` e a configuração `development` não podem apontar
// silenciosamente para Auth, Firestore, Storage ou Functions do projeto cloud.
//
// O ambiente local usa a suíte Firebase Emulator. Para uma sessão completa no
// Windows, execute `npm run dev:auth:win`, que inicia os emuladores e o Angular
// na configuração `dev-emu`, preservando os dados locais exportados.
//
// Uma futura execução conectada a cloud deve usar um environment e um comando
// explicitamente nomeados, com autorização consciente. Não reutilize este
// arquivo para contornar Functions ainda não implantadas.
// -----------------------------------------------------------------------------

export { environment } from './environment.dev-emu';
