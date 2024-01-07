//src\app\core\services\modal.service.ts
import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ModalService {
  private modalActions = new Subject<{ action: string, modalId: string }>();

  // Observável para ouvir ações do modal
  get modalActions$(): Observable<{ action: string, modalId: string }> {
    return this.modalActions.asObservable();
  }

  // Método para abrir um modal específico
  openModal(modalId: string): void {
    this.modalActions.next({ action: 'open', modalId: modalId });
  }

  // Método para fechar um modal específico
  closeModal(modalId: string): void {
    this.modalActions.next({ action: 'close', modalId: modalId });
  }
}
