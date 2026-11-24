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
    }
    return { directive, textarea, switchTo, type, model, get modelValue() { return modelValue; } };
  }

  it('purga rascunhos legados sem restaurar conteúdo ou afetar chaves alheias', () => {
    sessionStorage.setItem(storageKeys[0], 'texto de A');
    sessionStorage.setItem(storageKeys[1], 'texto de B');
    sessionStorage.setItem('unrelated-test-key', 'preserved');
    try {
      const state = setup();
      state.switchTo('user-a:chat:chat-1');
      expect(state.textarea.value).toBe('');
      expect(state.modelValue).toBe('');
      expect(sessionStorage.getItem(storageKeys[0])).toBeNull();
      expect(sessionStorage.getItem(storageKeys[1])).toBeNull();
      expect(sessionStorage.getItem('unrelated-test-key')).toBe('preserved');
    } finally {
      sessionStorage.removeItem('unrelated-test-key');
    }
  });

  it('mantém texto apenas no contexto ativo e descarta na troca de conversa ou conta', () => {
    const state = setup();
    state.switchTo('user-a:chat:chat-1');
    state.type('privado');
    state.switchTo('user-a:chat:chat-1');
    expect(state.textarea.value).toBe('privado');
    expect(sessionStorage.getItem(storageKeys[0])).toBeNull();
    state.switchTo('user-a:chat:chat-2');
    expect(state.modelValue).toBe('');
    state.switchTo('user-b:chat:chat-1');
    expect(state.textarea.value).toBe('');
    state.switchTo('user-a:chat:chat-1');
    expect(state.textarea.value).toBe('');
  });

  it('descarta texto na revogação de acesso e na destruição', () => {
    const state = setup();
    state.switchTo('user-a:chat:chat-1');
    state.type('rascunho privado');
    state.switchTo(null);
    expect(state.modelValue).toBe('');
    state.switchTo('user-a:chat:chat-1');
    expect(state.textarea.value).toBe('');
    state.type('novo');
    state.directive.ngOnDestroy();
    expect(state.modelValue).toBe('');
    expect(sessionStorage.getItem(storageKeys[0])).toBeNull();
  });
});
