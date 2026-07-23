# Configuração de Assinatura de Produção (Build Local)

Para gerar o AAB que a Google Play aceite, precisamos assinar o app com a chave de produção correta em vez da chave de debug.

## User Review Required

> [!IMPORTANT]
> Você precisará baixar a keystore do EAS e me fornecer (ou configurar você mesmo) as senhas. Siga este passo a passo:
> 1. No seu terminal, rode: `eas credentials`
> 2. Escolha **Android** -> **Production** -> **Keystore: Download**.
> 3. Salve o arquivo como `apps/cliente/android/app/release-key.jks` (ou similar).

## Proposed Changes

### Gradle Configuration

#### [MODIFY] [build.gradle](file:///Users/andrade/Documents/Mirror/motorista/apps/cliente/android/app/build.gradle)
Adicionar suporte para assinatura de produção (`signingConfigs.release`) que lê os dados do arquivo `gradle.properties`.

#### [MODIFY] [gradle.properties](file:///Users/andrade/Documents/Mirror/motorista/apps/cliente/android/gradle.properties)
Adicionar os campos para configurar o caminho da chave, alias e senhas.

## Verification Plan

### Manual Verification
- Após configurar as senhas no `gradle.properties` e colocar o arquivo `.jks` na pasta `app`, rodar:
  ```bash
  cd apps/cliente
  npm run android:bundle
  ```
- O Gradle deve usar a nova configuração de `release` para assinar o bundle.
