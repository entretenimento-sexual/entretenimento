// src/app/mocks/auth.service.mock.ts

import { of } from 'rxjs';

export class MockAuthService {
  // Este é um exemplo, ajuste de acordo com os métodos que seu serviço real possui

  login(email: string, password: string) {
    // Aqui nós estamos apenas retornando um Observable de um objeto vazio.
    // Em um caso real, você provavelmente retornaria algo que se parece com a resposta da API.
    return of({});
  }

  getToken() {
    // Mesma coisa aqui - você retornaria algo que parece com um token real.
    return of('mock-token');
  }
}
