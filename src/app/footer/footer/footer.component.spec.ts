// src/app/footer/footer/footer.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AppRoutingModule } from '../../app-routing.module';
import { FooterModule } from '../footer.module';
import { FooterComponent } from './footer.component';

describe('FooterComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FooterComponent],
      schemas: [NO_ERRORS_SCHEMA], // 👈 ignora componentes/inputs desconhecidos
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(FooterComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});

describe('Public footer routes', () => {
  it('matches all published legal documents before the login fallback', () => {
    TestBed.configureTestingModule({ imports: [AppRoutingModule, FooterModule] });
    const routes = TestBed.inject(Router).config;
    const fallback = routes.findIndex(route => route.path === '**');

    expect(fallback).toBeGreaterThan(0);
    for (const path of ['politica-de-privacidade', 'termos-e-condicoes', 'politica-de-cookies']) {
      const index = routes.findIndex(route => route.path === path);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(fallback);
    }
  });
});
