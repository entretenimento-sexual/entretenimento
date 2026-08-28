//src\app\register-module\register-routing.module.spec.ts
import { TestBed } from '@angular/core/testing';
import { RegisterRoutingModule } from './register-routing.module';
import { beforeEach, describe, expect, it } from 'vitest';

describe('RegisterRoutingModule', () => {
  let pipe: RegisterRoutingModule;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RegisterRoutingModule] });
    pipe = TestBed.inject(RegisterRoutingModule);
  });

  it('can load instance', () => {
    expect(pipe).toBeTruthy();
  });
});
