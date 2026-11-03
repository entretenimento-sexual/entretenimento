# Ambientes — lembrete de pré-deploy

**Auditoria Firestore `DATA_WRITE` e certificação de nickname estão adiadas
por custo durante o desenvolvimento. Não habilitar em staging/produção
sem revisão e autorização específica.**

Checklist para o lançamento: [Memento — auditoria e cutover de nickname](../../docs/operations/production-release-deferred-audit-checklist.md).
Documento operacional detalhado: [Runbook de cutover](../../docs/operations/registration-nickname-cutover-runbook.md).

As configurações TypeScript `environment*.ts` são usadas pelo Angular e
**não** devem conter instruções de deploy, segredos ou dados de auditoria.

---

//src\environments\environment..md
observações rápidas

Emuladores: somente em environment.ts. O seu firebase.factory.ts já lê environment.emulators e conecta automaticamente.

Persistência real do login: no AppModule, mantenha o APP_INITIALIZER que chama configureAuthPersistence(auth) (como te passei). Isso evita o “deslogar ao dar F5”.

Política para e-mail não verificado: seus guards e/ou o guest-banner podem ler environment.features.enforceEmailVerified e restrictedRoutesWhenUnverified para bloquear/avisar. Assim você liga/desliga por ambiente sem tocar na lógica.

Segredos: a antiga virusTotalApiKey não deve ficar no cliente. Proxie pelo seu backend.
