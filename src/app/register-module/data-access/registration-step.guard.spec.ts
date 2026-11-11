import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { firstValueFrom, Observable } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { RegisterFlowFacade } from './register-flow.facade';
import type { RegisterFlowVm } from './register-flow.model';
import { registrationStepGuard } from './registration-step.guard';

describe('registrationStepGuard / adult consent retired', () => {
  let router: Router;
  let currentVm: RegisterFlowVm;
  const route = { data: {allowedRegisterSteps:['profileCompletion']} } as unknown as ActivatedRouteSnapshot;
  const makeVm=(currentStep:RegisterFlowVm['currentStep'],nextRoute:string):RegisterFlowVm=>({
    authReady:true,uid:'u1',email:'teste@email.com',emailVerified:true,
    userResolved:true,userExists:true,termsAccepted:currentStep!=='termsAcceptance',
    ageEligibilityAllowed:currentStep!=='ageVerification' && currentStep!=='termsAcceptance',
    profileCompleted:currentStep==='preferences',currentStep,nextRoute,
    progress:75,canContinue:true,primaryActionLabel:'Continuar',
  });
  beforeEach(()=>{
    currentVm=makeVm('profileCompletion','/register/finalizar-cadastro');
    TestBed.configureTestingModule({
      imports:[RouterTestingModule],
      providers:[{provide:RegisterFlowFacade,useValue:{
        vm$:new Observable<RegisterFlowVm>(s=>{s.next(currentVm);s.complete();}),
      }}],
    });
    router=TestBed.inject(Router);
  });
  async function runGuard(url:string):Promise<boolean|UrlTree>{
    return firstValueFrom(TestBed.runInInjectionContext(
      ()=>registrationStepGuard(route,{url} as RouterStateSnapshot)
    ) as Observable<boolean|UrlTree>);
  }
  it('permite etapa atual de conclusão de perfil',async()=>{
    await expect(runGuard('/register/finalizar-cadastro')).resolves.toBe(true);
  });
  it('exige termos quando pendentes',async()=>{
    currentVm=makeVm('termsAcceptance','/register/aceitar-termos');
    const result=await runGuard('/register/finalizar-cadastro?redirectTo=%2Fdashboard%2Fprincipal');
    expect(router.serializeUrl(result as UrlTree)).toBe(
      '/register/aceitar-termos?redirectTo=%2Fdashboard%2Fprincipal');
  });
  it('exige idade canônica após termos',async()=>{
    currentVm=makeVm('ageVerification','/adulto/verificar-idade');
    const result=await runGuard('/register/finalizar-cadastro?redirectTo=%2Fdashboard%2Fprincipal');
    expect(router.serializeUrl(result as UrlTree)).toBe(
      '/adulto/verificar-idade?redirectTo=%2Fdashboard%2Fprincipal');
  });
  it('direciona perfis completos às preferências',async()=>{
    currentVm=makeVm('preferences','/preferencias/editar/u1');
    const result=await runGuard('/register/finalizar-cadastro');
    expect(router.serializeUrl(result as UrlTree)).toBe('/preferencias/editar/u1');
  });
});
