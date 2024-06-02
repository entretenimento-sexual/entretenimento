// src\app\photo\tools-edit-photo\face-blur-tool\face-blur-tool.component.ts
import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-face-blur-tool',
  template: `
    <button mat-stroked-button color="primary" (click)="activateBlurBrush()" class="editor-btn">
      <mat-icon>blur_on</mat-icon><span>Desfoque</span>
    </button>
  `,
  styles: [`
    button {
      margin: 5px;
      padding: 8px 16px;
      border: none;
      background-color: #007bff;
      color: white;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button:hover {
      background-color: #0056b3;
    }
    button.active {
      background-color: #0056b3;
    }
    button span {
      color: white;
    }
    mat-icon {
      color: white; /* Define a cor do ícone */
    }
  `]
})
export class FaceBlurToolComponent {
  @Output() blurSettings = new EventEmitter<{ active: boolean, intensity: number }>();

  activateBlurBrush() {
    this.blurSettings.emit({ active: true, intensity: 1500 }); // Define o desfoque para o valor máximo
  }
}
