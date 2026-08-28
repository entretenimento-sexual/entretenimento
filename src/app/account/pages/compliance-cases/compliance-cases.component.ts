import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { EMPTY } from 'rxjs';
import { catchError, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ComplianceCaseItem,
} from 'src/app/core/interfaces/compliance-case.interface';
import { ComplianceCaseService } from 'src/app/core/services/compliance/compliance-case.service';

@Component({
  selector: 'app-compliance-cases',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './compliance-cases.component.html',
  styleUrl: './compliance-cases.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComplianceCasesComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly complianceCases = inject(ComplianceCaseService);

  readonly vm$ = this.complianceCases.vm$;
  readonly selectedCase = signal<ComplianceCaseItem | null>(null);
  readonly requestedCaseId = signal(
    String(this.route.snapshot.queryParamMap.get('caseId') ?? '').trim()
  );

  readonly responseControl = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(20),
      Validators.maxLength(4000),
    ],
  });

  ngOnInit(): void {
    this.load();

    this.vm$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((vm) => {
        const selected = this.selectedCase();
        const selectedId = selected?.caseId || this.requestedCaseId();
        const next = selectedId
          ? vm.items.find((item) => item.caseId === selectedId) ?? null
          : vm.items[0] ?? null;

        if (
          next?.caseId !== selected?.caseId ||
          next?.status !== selected?.status
        ) {
          this.selectCase(next);
        }
      });
  }

  load(): void {
    this.complianceCases.load$()
      .pipe(
        take(1),
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  selectCase(item: ComplianceCaseItem | null): void {
    this.selectedCase.set(item);
    this.responseControl.setValue(item?.userResponse ?? '', { emitEvent: false });
    this.responseControl.markAsPristine();
    this.responseControl.markAsUntouched();
  }

  submitResponse(item: ComplianceCaseItem): void {
    if (!this.canRespond(item)) return;

    if (this.responseControl.invalid) {
      this.responseControl.markAsTouched();
      return;
    }

    this.complianceCases
      .submitResponse$(item.caseId, this.responseControl.value)
      .pipe(
        take(1),
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  canRespond(item: ComplianceCaseItem): boolean {
    if (item.status !== 'AWAITING_USER_RESPONSE') return false;
    if (!item.responseDueAt) return true;
    return item.responseDueAt >= Date.now();
  }

  statusLabel(status: ComplianceCaseItem['status']): string {
    switch (status) {
      case 'AWAITING_USER_RESPONSE':
        return 'Aguardando sua manifestação';
      case 'USER_RESPONDED':
        return 'Manifestação enviada';
      case 'UNDER_REVIEW':
        return 'Em análise';
      case 'RESOLVED_NO_VIOLATION':
        return 'Encerrado sem violação';
      case 'RESOLVED_ACTION_TAKEN':
        return 'Encerrado com medida aplicada';
      case 'CLOSED':
      default:
        return 'Encerrado';
    }
  }

  categoryLabel(category: ComplianceCaseItem['category']): string {
    switch (category) {
      case 'AGE_OR_IDENTITY':
        return 'Idade ou identidade';
      case 'NON_CONSENSUAL_CONTENT':
        return 'Conteúdo sem consentimento';
      case 'ILLEGAL_CONTENT':
        return 'Possível conteúdo ilegal';
      case 'HARASSMENT_OR_THREAT':
        return 'Assédio ou ameaça';
      case 'FRAUD_OR_PAYMENT_ABUSE':
        return 'Fraude ou abuso de pagamento';
      case 'ACCOUNT_INTEGRITY':
        return 'Integridade da conta';
      case 'OTHER_TERMS_VIOLATION':
      default:
        return 'Outra possível violação dos Termos';
    }
  }

  trackCase(_index: number, item: ComplianceCaseItem): string {
    return item.caseId;
  }
}
