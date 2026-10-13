import { Component } from '@angular/core';
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
      imports: [FormsModule],
      declarations: [DraftHostComponent, ChatDraftDirective],
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
});
