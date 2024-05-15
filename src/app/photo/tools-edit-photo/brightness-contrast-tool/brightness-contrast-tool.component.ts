//src\app\photo\tools-edit-photo\brightness-contrast-tool\brightness-contrast-tool.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-brightness-contrast-tool',
  templateUrl: './brightness-contrast-tool.component.html',
  styleUrls: ['./brightness-contrast-tool.component.css']
})
export class BrightnessContrastToolComponent {
  brightness: number = 0;
  contrast: number = 0;

  constructor() { }

  applyChanges() {
    console.log(`Brilho: ${this.brightness}, Contraste: ${this.contrast}`);
    // Aqui você chamará a função do serviço que aplica os filtros na imagem
  }
}
