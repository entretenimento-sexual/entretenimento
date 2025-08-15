//src\test\jest-stubs\angular-pintura.stub.ts
import { Component, Input, NgModule } from '@angular/core';

@Component({
  selector: 'pintura-editor',
  template: ''
})
export class PinturaEditorComponent {
  @Input() src: any;
  @Input() options: any;
  standalone: true
}

@NgModule({
  imports: [PinturaEditorComponent],
  exports: [PinturaEditorComponent],
})
export class AngularPinturaModule { }

export default AngularPinturaModule;
