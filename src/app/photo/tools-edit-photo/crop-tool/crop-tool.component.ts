// src\app\photo\tools-edit-photo\crop-tool\crop-tool.component.ts
import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-crop-tool',
  templateUrl: './crop-tool.component.html',
  styleUrls: ['./crop-tool.component.css']
})
export class CropToolComponent {
  @Output() cropStart = new EventEmitter<void>();
  @Output() cropApply = new EventEmitter<void>();
  @Output() cropCancel = new EventEmitter<void>();

  startCrop() {
    this.cropStart.emit();
  }

  applyCrop() {
    this.cropApply.emit();
  }

  cancelCrop() {
    this.cropCancel.emit();
  }
}
