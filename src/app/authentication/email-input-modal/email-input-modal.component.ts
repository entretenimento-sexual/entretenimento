// src/app/authentication/email-input-modal/email-input-modal.component.ts
import { AsyncPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { distinctUntilChanged, filter, map } from 'rxjs/operators';

import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';

@Component({
  selector: 'app-email-input-modal',
  templateUrl: './email-input-modal.component.html',
  styleUrls: ['./email-input-modal.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AsyncPipe, FormsModule],
})
export class EmailInputModalComponent implements AfterViewInit {
  @ViewChild('emailInput') private readonly emailInput?: ElementRef<HTMLInputElement>;

  readonly vm$ = this.emailInputModalService.state$;

  private readonly destroyRef = inject(DestroyRef);
  private previousActiveElement: HTMLElement | null = null;

  constructor(private readonly emailInputModalService: EmailInputModalService) {}

  ngAfterViewInit(): void {
    this.vm$.pipe(
      map((vm) => vm.isOpen),
      distinctUntilChanged(),
      filter(Boolean),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.focusEmailField());
  }

  updateEmail(email: string): void {
    this.emailInputModalService.updateEmail(email);
  }

  sendEmail(email: string): void {
    this.emailInputModalService.sendPasswordRecoveryEmail(email);
  }

  closeModal(isSending = false): void {
    if (isSending) return;

    this.emailInputModalService.closeModal();
    this.restorePreviousFocus();
  }

  handleOverlayKeydown(event: KeyboardEvent, isSending: boolean): void {
    if (event.key !== 'Escape' || isSending) return;

    event.preventDefault();
    this.closeModal(false);
  }

  private focusEmailField(): void {
    if (typeof document !== 'undefined') {
      this.previousActiveElement = document.activeElement as HTMLElement | null;
    }

    setTimeout(() => {
      this.emailInput?.nativeElement?.focus();
    }, 0);
  }

  private restorePreviousFocus(): void {
    const target = this.previousActiveElement;
    this.previousActiveElement = null;

    if (!target?.isConnected) return;

    setTimeout(() => target.focus(), 0);
  }
}
