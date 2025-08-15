// src/app/register-module/pipes/register-error-message.pipe.spec.ts
import { TestBed } from '@angular/core/testing';
import { RegisterErrorMessagePipe } from './register-error-message.pipe';

describe('RegisterErrorMessagePipe', () => {
  let pipe: RegisterErrorMessagePipe;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RegisterErrorMessagePipe] });
    pipe = TestBed.inject(RegisterErrorMessagePipe);
  });

  it('can load instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('returns default message for unknown error', () => {
    const err = {} as Record<string, any>; // objeto vazio simula erro desconhecido
    expect(pipe.transform(err)).toEqual('Erro de validação.');
  });

  // Se quiser testar um código específico:
  // it('maps code X to default (or specific) message', () => {
  //   const err = { code: 'X' } as any;
  //   expect(pipe.transform(err)).toEqual('Erro de validação.');
  // });
});
