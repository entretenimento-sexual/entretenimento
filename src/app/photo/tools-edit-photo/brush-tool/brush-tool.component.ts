//src\app\photo\tools-edit-photo\brush-tool\brush-tool.component.ts
import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-brush-tool',
  templateUrl: './brush-tool.component.html',
  styleUrls: ['./brush-tool.component.css']
})
export class BrushToolComponent {
  @Output() brushColorChange = new EventEmitter<string>();
  defaultColor = "#ffffff";

  changeBrushColor(event: Event): void {
    const inputElement = event.target as HTMLInputElement; // Assegura que o evento vem de um input
    if (inputElement && inputElement.value) {
      this.brushColorChange.emit(inputElement.value);
    }
  }
}
