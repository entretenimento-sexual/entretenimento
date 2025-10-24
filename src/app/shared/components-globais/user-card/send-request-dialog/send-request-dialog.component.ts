// src/app/shared/components-globais/user-card/send-request-dialog/send-request-dialog.component.ts
import { Component, Inject, computed, signal, OnInit } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field'; // autosize
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { environment } from 'src/environments/environment';

export interface SendRequestDialogData {
  requesterUid: string;
  targetUid: string;
  nickname?: string;
  avatarUrl?: string | null;
  uid?: string;
  maxLength?: number;   // default: 200
  canAddNote?: boolean; // default: true
}

export interface SendRequestDialogResult {
  ok: boolean;
  error?: string;
}

@Component({
  selector: 'app-send-request-dialog',
  standalone: true,
  imports: [
    CommonModule,
    // Material (via shared) + tokens de dialog + forms + autosize
    SharedMaterialModule,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    ReactiveFormsModule,
    TextFieldModule,
  ],
  templateUrl: './send-request-dialog.component.html',
  styleUrls: ['./send-request-dialog.component.css'],
})
export class SendRequestDialogComponent implements OnInit {
  readonly maxLen = this.data?.maxLength ?? 200;
  readonly canAddNote = this.data?.canAddNote ?? true;

  submitting = signal(false);
  lastError = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    message: ['', [Validators.maxLength(this.maxLen)]],
  });

  charsUsed = computed(() => this.form.controls.message.value?.length || 0);
  charsLeft = computed(() => Math.max(0, this.maxLen - this.charsUsed()));

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: SendRequestDialogData,
    private ref: MatDialogRef<SendRequestDialogComponent, SendRequestDialogResult>,
    private fb: FormBuilder,
    private friendship: FriendshipService,
  ) {
    if (!data?.requesterUid || !data?.targetUid) {
      this.dbg('Init: dados insuficientes', data);
      queueMicrotask(() => this.ref.close({ ok: false, error: 'Dados insuficientes para enviar a solicitação.' }));
    }
  }

  ngOnInit(): void {
    this.dbg('Dialog aberto', {
      targetUid: this.data?.targetUid,
      nickname: this.data?.nickname,
      avatarUrl: this.data?.avatarUrl,
      canAddNote: this.canAddNote,
      maxLen: this.maxLen,
    });
  }

  private dbg(msg: string, extra?: unknown) {
    if (!environment.production) {
      console.groupCollapsed('[SendRequestDialog] ' + msg);
      if (extra !== undefined) console.log(extra);
      console.groupEnd();
    }
  }

  cancel(): void {
    this.dbg('Cancelado pelo usuário');
    if (!this.submitting()) this.ref.close({ ok: false });
  }

  onEnter(e: KeyboardEvent | Event): void {
    const ke = e as KeyboardEvent;
    if (ke?.ctrlKey || ke?.metaKey) {
      ke.preventDefault();
      this.confirm();
    }
  }

  private sanitizeMessage(raw: string): string {
    return (raw ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, this.maxLen);
  }

  confirm(): void {
    if (this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.lastError.set(null);

    const message = this.sanitizeMessage(this.form.controls.message.value);
    this.dbg('Enviando request…', {
      requesterUid: this.data.requesterUid,
      targetUid: this.data.targetUid,
      message,
    });

    this.friendship.sendRequest(this.data.requesterUid, this.data.targetUid, message || undefined)
      .subscribe({
        next: () => {
          this.dbg('Sucesso ao enviar');
          this.ref.close({ ok: true });
        },
        error: (err) => {
          const msg = (err?.message as string) || (typeof err === 'string' ? err : 'Falha ao enviar a solicitação.');
          this.dbg('Erro ao enviar', err);
          this.lastError.set(msg);
          this.ref.close({ ok: false, error: msg });
        },
      });
  }
}
