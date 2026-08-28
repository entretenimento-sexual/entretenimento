//src\app\core\services\data-handling\queries\query-uid.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class QueryUidService {

  constructor() { }
}
/* UID “fonte da verdade”: vem do Auth(ex.: authSession.authUser$).
IUserDados “fonte da verdade”: vem do Firestore(doc users / { uid }).
Cache / localStorage só ajuda “boot mais rápido”, mas nunca decide rota sozinho.

1-AuthSessionService
authUser$ : Observable<User | null> (stream contínua, não completa)
uid$ : Observable<string | null> derivado de authUser$
(opcional) idToken$ : Observable<string | null> derivado de authUser$
A partir daqui, ninguém mais “inventa UID”.

2) CurrentUserStoreService
user$ : Observable<IUserDados | null> (perfil do Firestore/cache)
uid$ : Observable<string | null> apontando pro authSession.uid$ (não um UID “paralelo”)
manter seu método getLoggedUserUID$() como alias (pra não quebrar chamadas existentes)
 */
