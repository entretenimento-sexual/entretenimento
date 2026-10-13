import { Component, NgModule } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { afterEach, describe, expect, it } from 'vitest';

import { ChatDraftDirective } from './chat-draft.directive';

@Component({
  template: '<textarea [(ngModel)]="draft" [appChatDraftKey]="key"></textarea>',
  standalone: false,
})
class DraftHostComponent {
  draft = '';
  key = 'user-a:chat:chat-1';
}

@NgModule({
  declarations: [DraftHostComponent, ChatDraftDirective],
  imports: [FormsModule],
})
class DraftTestModule {}

describe('ChatDraftDirective', () => {
  let fixture: ComponentFixture<DraftHostComponent>;

  afterEach(() => {
    fixture?.destroy();
    sessionStorage.removeItem('chat-draft:user-a:chat:chat-1');
    sessionStorage.removeItem('chat-draft:user-b:chat:chat-1');
  });

  it('isola rascunhos por UID e restaura somente o texto da chave atual', async () => {
    sessionStorage.setItem('chat-draft:user-b:chat:chat-1', 'texto de B');
    await TestBed.configureTestingModule({
      imports: [DraftTestModule],
    }).compileComponents();
    fixture = TestBed.createComponent(DraftHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'texto de A';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(sessionStorage.getItem('chat-draft:user-a:chat:chat-1')).toBe('texto de A');

    fixture.componentInstance.key = 'user-b:chat:chat-1';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.value).toBe('texto de B');
    expect(fixture.componentInstance.draft).toBe('texto de B');
    expect(sessionStorage.getItem('chat-draft:user-a:chat:chat-1')).toBe('texto de A');
  });
  it('limpa rascunho enviado e não restaura texto após alternar de conta', async () => {
    await TestBed.configureTestingModule({
      imports: [DraftTestModule],
    }).compileComponents();
    fixture = TestBed.createComponent(DraftHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.componentInstance;
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'mensagem enviada';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(sessionStorage.getItem('chat-draft:user-a:chat:chat-1')).toBe('mensagem enviada');

    host.draft = '';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(sessionStorage.getItem('chat-draft:user-a:chat:chat-1')).toBeNull();

    host.key = 'user-b:chat:chat-1';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.value).toBe('');
    host.key = 'user-a:chat:chat-1';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.value).toBe('');
    expect(host.draft).toBe('');
  });

  it('não transfere texto para a próxima conta ao perder o contexto de sessão', async () => {
    await TestBed.configureTestingModule({
      imports: [DraftTestModule],
    }).compileComponents();
    fixture = TestBed.createComponent(DraftHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.componentInstance;
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'rascunho privado';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    host.key = '';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.value).toBe('');

    host.key = 'user-b:chat:chat-1';
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.value).toBe('');
    expect(sessionStorage.getItem('chat-draft:user-a:chat:chat-1')).toBe('rascunho privado');
    expect(sessionStorage.getItem('chat-draft:user-b:chat:chat-1')).toBeNull();
  });

});
