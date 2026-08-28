# 🔐 Importância da Função onUserCreateIndexNickname e sua Implantação Futura

## 📌 Objetivo da Função

A função `onUserCreateIndexNickname` foi criada com o propósito de **indexar os apelidos (nicknames) dos usuários** em uma coleção pública (`public_index`), permitindo que o sistema valide rapidamente se um apelido já está em uso **sem depender de autenticação**.

Essa indexação é especialmente útil na fase de registro, quando o usuário **ainda não está autenticado**, mas é necessário verificar a unicidade do apelido.

---

## ⚠️ Por que ainda não foi implantada no Firebase?

Atualmente, o projeto está no **plano gratuito (Spark)**, e para realizar o deploy dessa função é necessário ativar a API `cloudbuild.googleapis.com`, **o que só é possível no plano Blaze (pago)**.

**Erro ao tentar o deploy:**
```
Error: Your project must be on the Blaze (pay-as-you-go) plan to complete this command.
Required API cloudbuild.googleapis.com can't be enabled until the upgrade is complete.
```

---

## 🛠️ Solução Temporária

Por enquanto, estamos realizando a validação diretamente na collection `users`, o que exige permissões de leitura **que não são ideais** para usuários anônimos ou recém-chegados.

Esta abordagem temporária foi implementada nos services Angular (`firestore-validation.service.ts`), utilizando uma **consulta na coleção `users` com regras de segurança afrouxadas**.

Essa abordagem **não é recomendada para produção**, mas foi necessária para manter a funcionalidade ativa durante o desenvolvimento.

---

## ✅ O que fazer na fase final (produção)

1. **Migrar o projeto para o plano Blaze (Firebase).**
2. **Fazer o deploy da função `onUserCreateIndexNickname`.**
3. **Ajustar as regras de segurança do Firestore para negar leitura direta à collection `users` para não autenticados.**
4. **Alterar os services para consultar apenas `public_index` ao validar apelidos.**
5. **Remover qualquer lógica temporária relacionada à leitura direta da `users` em usuários anônimos.**

---

## 🧠 Aviso Importante

> ⚠️ **NUNCA** mantenha leitura pública direta da collection `users` em produção.

Essa permissão enfraquece a privacidade e segurança do sistema. Assim que o projeto estiver pronto para produção, essa permissão **deve ser removida** e o fluxo de validação de apelido **deve passar a usar exclusivamente a coleção `public_index`.

---

## 📁 Local da Função

```
functions/src/public_index/onUserCreateIndexNickname.ts
```