import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FormValidationFocusDirective } from '../../../shared/form-validation-focus/form-validation-focus.directive';
import type { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';
import { createEmptyPreferenceProfile } from '../../utils/preference-normalizers';
import { PreferenceProfileFormComponent } from './preference-profile-form.component';

const capabilities: PreferencesCapabilitySnapshot = {
  currentPlan: 'vip',
  currentPlanLabel: 'VIP',
  hasActiveSubscription: true,
  canEditCorePreferences: true,
  canEditIntentState: true,
  canEditAdvancedPreferences: true,
  canRequireAdvancedPreferences: true,
  canUseContextualIntent: true,
  canUseAdvancedDiscovery: true,
  canUseDiscreetMode: true,
  canUsePriorityVisibility: true,
  canUseIntentBoost: true,
  canSeeCompatibilityInsights: true,
};

describe('PreferenceProfileFormComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [PreferenceProfileFormComponent],
      providers: [provideRouter([])],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('integra o contrato compartilhado de foco de validação', () => {
    const fixture = TestBed.createComponent(PreferenceProfileFormComponent);
    fixture.componentRef.setInput('profile', createEmptyPreferenceProfile('u1'));
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();

    const formDebug = fixture.debugElement.query(
      By.directive(FormValidationFocusDirective)
    );

    expect(formDebug).toBeTruthy();
    expect(
      formDebug.injector.get(FormValidationFocusDirective)
    ).toBeInstanceOf(FormValidationFocusDirective);

    fixture.destroy();
  });

  it('explica filtro numérico inválido e foca o primeiro campo ao submeter', () => {
    const fixture = TestBed.createComponent(PreferenceProfileFormComponent);
    fixture.componentRef.setInput('profile', createEmptyPreferenceProfile('u1'));
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const minAge = fixture.nativeElement.querySelector('#minAge') as HTMLInputElement;
    const focusSpy = vi.spyOn(minAge, 'focus');
    const scrollSpy = vi.fn();
    Object.defineProperty(minAge, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });

    component.form.controls.minAge.setValue(17);
    component.form.controls.minAge.markAsDirty();
    fixture.detectChanges();

    const submit = fixture.nativeElement.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    vi.runAllTimers();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector(
      '#minAgeError'
    ) as HTMLElement;

    expect(error.textContent).toContain('18 e 100 anos');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.getAttribute('aria-live')).toBe('polite');
    expect(error.getAttribute('aria-atomic')).toBe('true');
    expect(minAge.getAttribute('aria-invalid')).toBe('true');
    expect(minAge.getAttribute('aria-describedby')).toBe('minAgeError');
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    fixture.destroy();
  });

  it('explica intervalo invertido sem esconder a ação de correção', () => {
    const fixture = TestBed.createComponent(PreferenceProfileFormComponent);
    fixture.componentRef.setInput('profile', createEmptyPreferenceProfile('u1'));
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.form.controls.minAge.setValue(50);
    component.form.controls.maxAge.setValue(30);
    component.form.controls.minAge.markAsTouched();
    component.form.controls.maxAge.markAsTouched();
    component.form.controls.minAge.markAsDirty();
    component.form.controls.maxAge.markAsDirty();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector(
      '#ageRangeError'
    ) as HTMLElement;
    const submit = fixture.nativeElement.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;

    expect(error.textContent).toContain('idade mínima não pode ser maior');
    expect(error.getAttribute('role')).toBe('alert');
    expect(submit.disabled).toBe(false);

    fixture.destroy();
  });
});
