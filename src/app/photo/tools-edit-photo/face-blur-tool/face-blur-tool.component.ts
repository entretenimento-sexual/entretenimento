// src\app\photo\tools-edit-photo\face-blur-tool\face-blur-tool.component.ts
import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-face-blur-tool',
  template: `
    <button mat-stroked-button color="primary" (click)="activateBlurBrush()" class="editor-btn">
      <mat-icon>blur_on</mat-icon><span>Desfoque</span>
    </button>
    <div>
      <label for="blurLevel">Nível de Desfoque:</label>
      <input type="range" id="blurLevel" min="1" max="10" (change)="changeBlurIntensity($event)">
    </div>
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
    input[type="range"] {
      margin: 5px 0;
    }
    label {
      color: #007bff;
    }
  `]
})
export class FaceBlurToolComponent {
  @Output() blurSettings = new EventEmitter<{ active: boolean, intensity: number }>();

  private intensity: number = 5;

  activateBlurBrush() {
    this.blurSettings.emit({ active: true, intensity: this.intensity });
  }

  changeBlurIntensity(event: any) {
    this.intensity = parseInt(event.target.value, 10);
    this.blurSettings.emit({ active: true, intensity: this.intensity });
  }
}
