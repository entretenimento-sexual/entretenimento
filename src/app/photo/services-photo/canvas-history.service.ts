//src\app\photo\services-photo\canvas-history.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class CanvasHistoryService {
  private history: string[] = [];
  private currentIndex = -1;

  addToHistory(canvasState: string): void {
    // Se estamos no meio do histórico, remove os estados futuros
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }
    this.history.push(canvasState);
    this.currentIndex++;
  }

  undo(): string | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.history[this.currentIndex];
    }
    return null;
  }

  redo(): string | null {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    }
    return null;
  }
}
