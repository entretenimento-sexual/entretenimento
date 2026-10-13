import { ElementRef, SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgModel } from '@angular/forms';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatDraftDirective } from './chat-draft.directive';

describe('ChatDraftDirective', () => {
  const storageKeys = [
    'chat-draft:user-a:chat:chat-1',
    'chat-draft:user-b:chat:chat-1',
  ];

  afterEach(() => {
    storageKeys.forEach(key => sessionStorage.removeItem(key));
    TestBed.resetTestingModule();
  });

  function setup() {
    const textarea = document.createElement('textarea');
    const changes$ = new Subject<string>();
    let modelValue = '';
    const model = {
      valueChanges: changes$.asObservable(),
      control: {
        setValue: vi.fn((value: string, options?: { emitEvent?: boolean }) => {
          modelValue = value;
          textarea.value = value;
          if (options?.emitEvent !== false) changes$.next(value);
        }),
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ElementRef, useValue: new ElementRef(textarea) },
        { provide: NgModel, useValue: model },
      ],
    });
    const directive = TestBed.runInInjectionContext(() => new ChatDraftDirective());
    directive.ngOnInit();
    function switchTo(key: string | null) {
      const previous = directive.appChatDraftKey;
      directive.appChatDraftKey = key;
      directive.ngOnChanges({
        appChatDraftKey: new SimpleChange(previous, key, previous === undefined),
      });
    }
    function type(value: string) {
      textarea.value = value;
      modelValue = value;
      directive.onInput();
    }
    return { directive, textarea, switchTo, type, model, get modelValue() { return modelValue; } };
  }

  it('isola rascunhos por UID e restaura o texto da chave atual', () => {
    sessionStorage.setItem(storageKeys[1], 'texto de B');
    const state = setup();
    state.switchTo('user-a:chat:chat-1');
    state.type('texto de A');
    expect(sessionStorage.getItem(storageKeys[0])).toBe('texto de A');

    state.switchTo('user-b:chat:chat-1');
    expect(state.textarea.value).toBe('texto de B');
    expect(state.modelValue).toBe('texto de B');
    expect(sessionStorage.getItem(storageKeys[0])).toBe('texto de A');
    state.directive.ngOnDestroy();
  });

  it('remove rascunho após envio e não restaura ao alternar de conta', () => {
    const state = setup();
    state.switchTo('user-a:chat:chat-1');
    state.type('mensagem enviada');
    expect(sessionStorage.getItem(storageKeys[0])).toBe('mensagem enviada');

    state.model.control.setValue('', { emitEvent: true });
    expect(sessionStorage.getItem(storageKeys[0])).toBeNull();
    state.switchTo('user-b:chat:chat-1');
    expect(state.textarea.value).toBe('');
    state.switchTo('user-a:chat:chat-1');
    expect(state.textarea.value).toBe('');
    state.directive.ngOnDestroy();
  });

  it('não transfere texto após perda do contexto autenticado', () => {
    const state = setup();
    state.switchTo('user-a:chat:chat-1');
    state.type('rascunho privado');
    state.switchTo(null);
    expect(state.textarea.value).toBe('');

    state.switchTo('user-b:chat:chat-1');
    expect(state.textarea.value).toBe('');
    expect(sessionStorage.getItem(storageKeys[0])).toBe('rascunho privado');
    expect(sessionStorage.getItem(storageKeys[1])).toBeNull();
    state.directive.ngOnDestroy();
  });
});
