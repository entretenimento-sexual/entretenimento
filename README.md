# Entretenimento

> **Política Git para agentes e colaboradores:** desenvolvimento somente na `main`. **Proibido criar branches, abrir PRs ou executar merges.** Sem deploy ou operações destrutivas sem autorização explícita. Leia [`AGENTS.md`](./AGENTS.md) antes de editar o repositório.

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 16.1.4.


## Pré-deploy e pendências de produção

A auditoria `DATA_WRITE` do Firestore e a certificação de 30 dias do
cutover de nickname estão **adiadas por custo durante o desenvolvimento**.
Antes de qualquer deploy público, revisar o
[checklist de pré-deploy](./docs/operations/production-release-deferred-audit-checklist.md)
e o [runbook completo](./docs/operations/registration-nickname-cutover-runbook.md).
Esses documentos não autorizam deploy, mudança de IAM ou alteração de Rules.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.
