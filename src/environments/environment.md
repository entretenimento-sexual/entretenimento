//src\environments\environment..md
observações rápidas

Emuladores: somente em environment.ts. O seu firebase.factory.ts já lê environment.emulators e conecta automaticamente.

Persistência real do login: no AppModule, mantenha o APP_INITIALIZER que chama configureAuthPersistence(auth) (como te passei). Isso evita o “deslogar ao dar F5”.

Política para e-mail não verificado: seus guards e/ou o guest-banner podem ler environment.features.enforceEmailVerified e restrictedRoutesWhenUnverified para bloquear/avisar. Assim você liga/desliga por ambiente sem tocar na lógica.

Segredos: a antiga virusTotalApiKey não deve ficar no cliente. Proxie pelo seu backend.
