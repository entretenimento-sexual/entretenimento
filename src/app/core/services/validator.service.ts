// src\app\core\services\validator.service.ts
import { Injectable } from '@angular/core';
import { AbstractControl, ValidatorFn } from '@angular/forms';

@Injectable({
  providedIn: 'root'
})
export class ValidatorService {

  constructor() { }

  public static facebookValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value || /^https?:\/\/www\.facebook\.com\/.+$/.test(control.value)) {
        return null;
      }
      return { 'invalidFacebook': { value: control.value } };
    };
  }

  public static instagramValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value || /^https:\/\/www\.instagram\.com\/.+$/.test(control.value)) {
        return null;
      }
      return { 'invalidInstagram': { value: control.value } };
    };
  }

  public static buupeValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      if (!control.value || /^https:\/\/www\.buupe\.com\/.+$/.test(control.value)) {
        return null;
      }
      return { 'invalidBuupe': { value: control.value } };
    };
  }
  // Você pode adicionar mais validadores aqui conforme necessário
}
