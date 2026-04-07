//src\test\jest-stubs\angular-pintura.stub.ts
import { Component, Input, NgModule } from '@angular/core';

@Component({
  selector: 'pintura-editor',
  template: '',
  standalone: true,
})
export class PinturaEditorComponent {
  @Input() src: unknown;
  @Input() options: unknown;
}

@NgModule({
  imports: [PinturaEditorComponent],
  exports: [PinturaEditorComponent],
})
export class AngularPinturaModule {}

export default AngularPinturaModule;