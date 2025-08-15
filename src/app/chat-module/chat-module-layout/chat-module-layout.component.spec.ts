// src/app/chat-module/chat-module-layout/chat-module-layout.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { ChatModuleLayoutComponent } from './chat-module-layout.component';

describe('ChatModuleLayoutComponent', () => {
  let component: ChatModuleLayoutComponent;
  let fixture: ComponentFixture<ChatModuleLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatModuleLayoutComponent], // ⬅ não-standalone
      imports: [CommonModule, RouterTestingModule],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatModuleLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
