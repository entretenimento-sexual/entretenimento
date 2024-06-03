//src\app\photo\image-editor\image-editor.component.ts
import { Component, OnInit, AfterViewInit, Inject } from '@angular/core';
import ImageEditor from 'tui-image-editor';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { fabric } from 'fabric';

@Component({
  selector: 'app-image-editor',
  templateUrl: './image-editor.component.html',
  styleUrls: ['./image-editor.component.css']
})
export class ImageEditorComponent implements OnInit, AfterViewInit {

  private imageEditor: ImageEditor | undefined;

  constructor(@Inject(MAT_DIALOG_DATA) public data: { file: string }) { }

  ngOnInit(): void { }

  ngAfterViewInit(): void {
    this.initializeImageEditor();
  }

  private initializeImageEditor(): void {
    const container = document.querySelector('#tui-image-editor-container');
    this.imageEditor = new ImageEditor(container!, {
      includeUI: {
        loadImage: {
          path: this.data.file,
          name: 'SampleImage'
        },
        theme: {},
        menu: ['filter'],
        initMenu: 'filter',
        uiSize: {
          width: '100%',
          height: '100%'
        },
        menuBarPosition: 'bottom'
      },
      cssMaxWidth: 700,
      cssMaxHeight: 500
    });
  }

  applyFilter(filterType: string): void {
    if (this.imageEditor) {
      this.imageEditor.applyFilter(filterType);
    }
  }
}
