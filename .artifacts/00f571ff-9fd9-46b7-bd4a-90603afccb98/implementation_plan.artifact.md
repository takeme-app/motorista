# Correção de Assinatura com Chave de Upload Original (Motorista)

Confirmamos que o Google Play exige a assinatura com a **Chave de Upload** original (`SHA1: D5:32:73...`). Identificamos o arquivo `release_real.keystore` no projeto, que provavelmente contém esta chave.

## User Review Required

> [!IMPORTANT]
> A senha que usamos anteriormente (`7e007eec...`) pertence à chave do Expo e **não funciona** para o arquivo `release_real.keystore`.
>
> **Você sabe qual é a senha (Store Password e Key Password) deste arquivo `release_real.keystore`?**
>
> Sem a senha correta deste arquivo específico, não conseguiremos assinar o app. Se você não tiver a senha, teremos que seguir com o processo de reset da chave de upload no Google Play Console.

## Proposed Changes

### Configuração de Assinatura

#### [MODIFY] [gradle.properties](file:///Users/andrade/Documents/Mirror/motorista/apps/motorista/android/gradle.properties)
Atualizaremos o arquivo para apontar para `release_real.keystore` e usaremos as novas senhas assim que você as fornecer.

## Verification Plan

### Manual Verification
1. Testar as senhas fornecidas via `keytool` para confirmar o SHA1.
2. Gerar o bundle: `cd apps/motorista && npm run android:bundle`.
3. Validar se o bundle gerado possui o SHA1 `D5:32:73:5F:6E:2F:58:29:32:FB:56:76:D4:A7:DA:DA:ED:7E:05:6B`.
