// src/app/register-module/register-ui/fields/nickname-field/nickname-field.component.ts
import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-nickname-field',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './nickname-field.component.html',
  styleUrls: ['./nickname-field.component.css']
})
export class NicknameFieldComponent {
  form = input.required<FormGroup>();

}
