import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { ContentStateComponent } from './content-state.component';

describe('ContentStateComponent', () => {
  let fixture: ComponentFixture<ContentStateComponent>;
  let component: ContentStateComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContentStateComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ContentStateComponent);
    component = fixture.componentInstance;
  });

  it('renderiza skeleton acessível durante carregamento', () => {
    component.state = 'loading';
    component.message = 'Carregando resultados.';
    component.skeletonRows = 4;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector('[aria-busy="true"]');
    const rows = host.querySelectorAll('.content-state__skeleton-row');

    expect(region).toBeTruthy();
    expect(rows.length).toBe(4);
    expect(host.textContent).toContain('Carregando resultados.');
  });

  it('emite ação sem embutir lógica de domínio', () => {
    const action = vi.fn();
    component.state = 'error';
    component.title = 'Falha ao carregar';
    component.message = 'Tente novamente.';
    component.actionLabel = 'Atualizar';
    component.action.subscribe(action);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '.content-state__action'
    ) as HTMLButtonElement;
    button.click();

    expect(action).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Falha ao carregar');
  });

  it('limita a quantidade de linhas do skeleton', () => {
    component.state = 'loading';
    component.skeletonRows = 99;
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll(
      '.content-state__skeleton-row'
    );

    expect(rows.length).toBe(6);
  });
});
