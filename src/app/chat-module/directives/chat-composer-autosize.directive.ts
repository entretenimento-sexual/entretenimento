// src/app/chat-module/directives/chat-composer-autosize.directive.ts
import {
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { NgModel } from '@angular/forms';
import { Subscription } from 'rxjs';

@Directive({
  selector: 'textarea[appChatComposerAutosize]',
  standalone: false,
})
export class ChatComposerAutosizeDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);
  private readonly ngModel = inject(NgModel, { optional: true });

  private modelSub?: Subscription;

  ngOnInit(): void {
    this.modelSub = this.ngModel?.valueChanges?.subscribe(() => {
      this.resize();
    });

    setTimeout(() => this.resize(), 0);
  }

  ngOnDestroy(): void {
    this.modelSub?.unsubscribe();
    this.modelSub = undefined;
  }

  @HostListener('input')
  onInput(): void {
    this.resize();
  }

  private resize(): void {
    const textarea = this.elementRef.nativeElement;
    const maxHeight = 144;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }
}
