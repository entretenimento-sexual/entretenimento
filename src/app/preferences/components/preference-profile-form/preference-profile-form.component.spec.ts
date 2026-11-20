import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FormValidationFocusDirective } from '../../../shared/form-validation-focus/form-validation-focus.directive';
import type { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';
import { createEmptyPreferenceProfile } from '../../utils/preference-normalizers';
import { mapFormValueToPreferenceProfile } from '../../utils/preference-profile-form.factory';
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

  it('abre as escolhas principais e explica o filtro após selecionar uma intenção', () => {
    const fixture = TestBed.createComponent(PreferenceProfileFormComponent);
    fixture.componentRef.setInput('profile', createEmptyPreferenceProfile('u1'));
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();

    const view = fixture.nativeElement as HTMLElement;
    const openTitles = Array.from(view.querySelectorAll('details[open] .preference-group__title'))
      .map(title => title.textContent?.trim());
    expect(openTitles).toEqual(['O que você procura', 'Quem você gostaria de conhecer?']);
    expect(view.querySelector('.matching-mode')).toBeNull();
    expect(view.querySelector('.form-actions--pending')).toBeNull();

    const dating = Array.from(view.querySelectorAll('label')).find(label => label.textContent?.trim() === 'Encontros');
    dating!.querySelector('input')!.click();
    fixture.detectChanges();
    const prefer = view.querySelector<HTMLInputElement>('input[type="radio"][value="prefer"]');
    expect(view.querySelector<HTMLInputElement>('input[type="radio"][value="require"]')?.checked).toBe(true);
    prefer!.click();
    fixture.detectChanges();
    expect(view.querySelector('#relationshipIntentModeHelp')?.textContent).toContain('Outros perfis podem aparecer');
    expect(view.querySelector('.form-actions--pending')).not.toBeNull();
    expect(fixture.componentInstance.form.getRawValue().relationshipIntentMode).toBe('prefer');
    fixture.componentInstance.markSaved();
    fixture.componentInstance.form.updateValueAndValidity();
    fixture.detectChanges();
    expect(view.querySelector('.form-actions--pending')).toBeNull();
    fixture.destroy();
  });

  it('mostra opções complementares quando ritmo e distância foram escolhidos', () => {
    const fixture = TestBed.createComponent(PreferenceProfileFormComponent);
    fixture.componentRef.setInput('profile', createEmptyPreferenceProfile('u1'));
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();
    const view = fixture.nativeElement as HTMLElement;
    const { form } = fixture.componentInstance;
    const location = () => view.querySelector<HTMLInputElement>('input[formControlName="locationRequired"]');
    expect(view.querySelector('#conversationPaceHelp')).toBeNull();
    expect(location()).toBeNull();

    form.patchValue({ conversationPace: 'talk_first', maxDistanceKm: 20 });
    fixture.detectChanges();
    expect(view.querySelector('#conversationPaceHelp')).not.toBeNull();
    expect(location()).not.toBeNull();
    form.controls.locationRequired.setValue(true);
    form.controls.maxDistanceKm.setValue(null);
    fixture.detectChanges();
    expect(location()).toBeNull();
    form.controls.maxDistanceKm.setValue(20);
    fixture.detectChanges();
    expect(location()?.checked).toBe(true);
    fixture.destroy();
  });

  it('mantém visibilidade fora do editor geral e preserva o estado atual ao salvar', () => {
    const fixture = TestBed.createComponent(PreferenceProfileFormComponent);
    const base = createEmptyPreferenceProfile('u1');
    const profile = {
      ...base,
      visibility: {
        showPreferenceBadges: false,
        showIntentPublicly: true,
        discoveryMode: 'priority' as const,
      },
    };

    fixture.componentRef.setInput('profile', profile);
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const mapped = mapFormValueToPreferenceProfile(
      component.form.getRawValue(),
      profile,
      capabilities
    );

    expect(fixture.nativeElement.querySelector('#discoveryMode')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Sua visibilidade');
    // O editor preserva as demais políticas e só adiciona o opt-in da busca,
    // desligado para contas antigas que não possuem o novo campo.
    const seekingToggle = fixture.nativeElement.querySelector(
      'input[formControlName="showSeekingPublicly"]'
    ) as HTMLInputElement;
    expect(seekingToggle).not.toBeNull();
    expect(seekingToggle.checked).toBe(false);
    expect(fixture.nativeElement.querySelector('#seekingVisibilityHelp a')?.getAttribute('href'))
      .toBe('/preferencias/discovery-settings');
    expect(mapped.visibility).toEqual({
      ...profile.visibility,
      shareConversationPace: false,
      showSeekingPublicly: false,
    });

    fixture.destroy();
  });

  it('publica a busca somente após habilitação explícita sem alterar outras políticas', () => {
    const fixture = TestBed.createComponent(PreferenceProfileFormComponent);
    const profile = createEmptyPreferenceProfile('u1');
    profile.hardRules.acceptedGenders = ['women'];
    profile.visibility.showPreferenceBadges = true;

    fixture.componentRef.setInput('profile', profile);
    fixture.componentRef.setInput('capabilities', capabilities);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const seekingToggle = fixture.nativeElement.querySelector(
      'input[formControlName="showSeekingPublicly"]'
    ) as HTMLInputElement;

    expect(seekingToggle.checked).toBe(false);
    expect(fixture.nativeElement.querySelector('.seeking-visibility [aria-live]')?.textContent)
      .toContain('Só para minha descoberta');
    component.form.controls.showSeekingPublicly.setValue(true);
    fixture.detectChanges();
    expect(seekingToggle.checked).toBe(true);
    expect(fixture.nativeElement.querySelector('.seeking-visibility [aria-live]')?.textContent)
      .toContain('Ao salvar · Visível no perfil');

    const mapped = mapFormValueToPreferenceProfile(
      component.form.getRawValue(),
      profile,
      capabilities
    );
    expect(mapped.visibility).toEqual({
      ...profile.visibility,
      shareConversationPace: false,
      showSeekingPublicly: true,
    });
    expect(mapped.hardRules.acceptedGenders).toEqual(['women']);

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
  it('mantém o ritmo privado até a autorização e remove a autorização ao limpar a escolha', () => {
    const profile = createEmptyPreferenceProfile('u1');
    const resolve = (conversationPace: string, shareConversationPace?: boolean) =>
      mapFormValueToPreferenceProfile({ conversationPace, shareConversationPace }, profile, null);

    const privatePace = resolve('talk_first');
    expect(privatePace.conversationPace).toBe('talk_first');
    expect(privatePace.visibility.shareConversationPace).toBe(false);
    expect(resolve('talk_first', true).visibility.shareConversationPace).toBe(true);
    const cleared = resolve('', true);
    expect(cleared.conversationPace).toBeNull();
    expect(cleared.visibility.shareConversationPace).toBe(false);
  });

});
