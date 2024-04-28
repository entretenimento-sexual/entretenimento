// src/app/photo/services-photo/photo-filters.service.ts
import { Injectable } from '@angular/core';
import { fabric } from 'fabric';

@Injectable({
  providedIn: 'root'
})
export class PhotoFiltersService {

  constructor() { }

  applyBrightness(canvas: fabric.Canvas, value: number): void {
    const obj = canvas.getActiveObject();
    if (!obj || !(obj instanceof fabric.Image)) return;

    obj.filters = obj.filters || []; // Garante que obj.filters seja definido
    obj.filters.push(new fabric.Image.filters.Brightness({ brightness: value }));
    obj.applyFilters();
    canvas.renderAll();
  }

  applyContrast(canvas: fabric.Canvas, value: number): void {
    // Similar à implementação do brilho, mas utilizando o filtro de contraste
  }

  // Adicione mais métodos para outros filtros conforme necessário
}
