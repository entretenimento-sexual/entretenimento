Quem dispara o processo: AuthService.logout() → só dispara logout (para o Effect derrubar o status online) e faz signOut + navigate.

Quem limpa o estado e emite logoutSuccess: o authState listener, quando o auth vira null (ou seja, evento de fato de “saiu”).

Quem atualiza Firestore para offline: apenas o Effect (em ofType(logout)), nada no AuthService.logout() — evitando duplicata.

Quem marca “online” no login: mantenha o updateUserOnlineStatusRealtime (Realtime DB + onDisconnect) e remova o effect que fazia isso também.
