// src/app/core/services/data-handling/firestore/core/firestore-context.service.ts
// =============================================================================
// FIRESTORE CONTEXT SERVICE
//
// Objetivo:
// - Garantir que QUALQUER uso das APIs "function-based" do AngularFire
//   (doc(), collection(), query(), setDoc(), updateDoc(), docSnapshots(), etc.)
//   rode dentro de um Injection Context do Angular.
//
// Por que isso importa (AngularFire warning):
// - Em dev-mode, o AngularFire alerta quando essas APIs são chamadas fora do
//   Injection Context, porque isso pode causar bugs sutis com Zone/ChangeDetection
//   e (especialmente) hydration/SSR.
//
// Padrão “grandes plataformas”:
// - Um único ponto de entrada para executar operações Firebase/AngularFire
//   com contexto garantido.
// - Helpers reativos (defer$ / deferPromise$ / deferObservable$) para que o
//   Observable só seja criado na hora do subscribe, evitando side-effects no import.
// - Sem state, sem acoplamento com Router/Toasts/ErrorHandler (isso fica nos services
//   de domínio: PresenceWriterService, UserWriteService, etc.).
//
// Regras:
// - Este service NÃO faz tratamento de erro. Ele só fornece o “ambiente seguro”.
//   Tratamento fica nos services consumidores via catchError + GlobalErrorHandlerService.
// =============================================================================

import { Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { defer, from, Observable, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FirestoreContextService {
  constructor(private readonly envInjector: EnvironmentInjector) { }

  // =========================================================
  // Core
  // =========================================================

  /**
   * Executa a função dentro de Injection Context.
   *
   * Use para qualquer criação/uso de refs do AngularFire:
   * - doc(this.db, 'users', uid)
   * - collection(this.db, 'presence')
   * - query(...)
   * - docSnapshots(ref)
   * - etc.
   *
   * Observação:
   * - Não “envolvemos” com try/catch aqui para não mascarar erros.
   *   Quem chama decide como tratar e para onde reportar.
   */
  run<T>(fn: () => T): T {
    return runInInjectionContext(this.envInjector, fn);
  }

  // =========================================================
  // Reactive helpers
  // =========================================================

  /**
   * defer$()
   * Cria um Observable LAZY que executa fn() apenas no subscribe,
   * garantindo que a execução aconteça dentro do Injection Context.
   *
   * Ideal para:
   * - leituras síncronas (raras)
   * - montar objetos / calcular valores dentro do contexto
   *
   * Nota:
   * - Mantém "of(fn())" para garantir emissão síncrona e compatibilidade.
   */
  defer$<T>(fn: () => T): Observable<T> {
    return defer(() => of(this.run(fn)));
  }

  /**
   * deferPromise$()
   * Cria um Observable LAZY a partir de uma Promise.
   *
   * Ponto importante:
   * - O "from(fn())" precisa nascer dentro do Injection Context.
   * - E a Promise também deve ser criada dentro do contexto (fn() roda lá).
   *
   * Ideal para:
   * - setDoc/updateDoc/getDoc/getDocs
   * - operações do Auth/Storage quando você estiver usando wrappers do AngularFire
   */
  deferPromise$<T>(fn: () => Promise<T>): Observable<T> {
    return defer(() => this.run(() => from(fn())));
  }

  /**
   * deferObservable$()
   * Garante que um Observable retornado por fn() seja criado dentro
   * do Injection Context.
   *
   * Ideal para:
   * - docSnapshots(ref)
   * - collectionData(...)
   * - streams do AngularFire que dependem de injeção/zone scheduling
   */
  deferObservable$<T>(fn: () => Observable<T>): Observable<T> {
    return defer(() => this.run(fn));
  }
} // Linha 106
