// src\app\photo\tools-edit-photo\face-blur-tool\face-blur-tool.component.ts
import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-face-blur-tool',
  template: `
    <button (click)="activateBlurBrush()">Ativar Desfoque Facial</button>
    <div>
      <label for="blurLevel">Nível de Desfoque:</label>
      <input type="range" id="blurLevel" min="1" max="10" (change)="changeBlurIntensity($event)">
    </div>
  `,
  styles: []
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
