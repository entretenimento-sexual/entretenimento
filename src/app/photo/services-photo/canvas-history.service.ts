// src\app\photo\services-photo\canvas-history.service.ts
import { Injectable } from '@angular/core';
import { PhotoErrorHandlerService } from './photo-error-handler.service';

@Injectable({
  providedIn: 'root'
})
export class CanvasHistoryService {
  private history: string[] = [];
  private currentIndex = -1;
  private readonly maxHistorySize = 5; // Define o limite de 5 desfazimentos

  constructor(private errorHandler: PhotoErrorHandlerService) { }

  addToHistory(canvasState: string): void {
    try {
      // Valida o estado do canvas
      if (typeof canvasState !== 'string' || !canvasState.startsWith('data:image/')) {
        throw new Error('Estado do canvas inválido.');
      }

      // Se estamos no meio do histórico, remove os estados futuros
      if (this.currentIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.currentIndex + 1);
      }

      // Adiciona o novo estado ao histórico
      this.history.push(canvasState);

      // Remove o estado mais antigo se excedermos o limite de histórico
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      } else {
        this.currentIndex++;
      }
    } catch (error) {
      this.errorHandler.handleError(error as Error);
    }
  }

  undo(): string | null {
    try {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        return this.history[this.currentIndex];
      }
      throw new Error('Nenhum estado anterior disponível para desfazer.');
    } catch (error) {
      this.errorHandler.handleError(error as Error);
      return null;
    }
  }

  redo(): string | null {
    try {
      if (this.currentIndex < this.history.length - 1) {
        this.currentIndex++;
        return this.history[this.currentIndex];
      }
      throw new Error('Nenhum estado futuro disponível para refazer.');
    } catch (error) {
      this.errorHandler.handleError(error as Error);
      return null;
    }
  }
}
