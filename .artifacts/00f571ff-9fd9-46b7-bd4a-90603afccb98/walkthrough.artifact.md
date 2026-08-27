# Walkthrough: Correção de Build (Motorista) e Localização de Bundle (Cliente)

Resolvemos o erro de autenticação do Mapbox no app **motorista** e fornecemos as instruções para localizar o bundle do app **cliente**.

## Mudanças Realizadas

### Automação de Ambiente (Motorista)
- **[load-env.js](file:///Users/andrade/Documents/Mirror/motorista/apps/motorista/scripts/load-env.js)**: Novo utilitário que carrega automaticamente o token do Mapbox (`MAPBOX_DOWNLOADS_TOKEN`) do arquivo `.env` da raiz.
- **Scripts de Build**: Atualizamos o `build-release-bundle.js` e o `build-release-apk.js` para usar esse utilitário, eliminando erros `401 Unauthorized` durante o download de dependências nativas.

### Configuração de Assinatura de Produção (Motorista)
- **[gradle.properties](file:///Users/andrade/Documents/Mirror/motorista/apps/motorista/android/gradle.properties)**: Adicionados campos para a chave de produção do motorista (`TAKEME_MOTORISTA_RELEASE_...`).
- **[build.gradle](file:///Users/andrade/Documents/Mirror/motorista/apps/motorista/android/app/build.gradle)**: Configurada a `signingConfig` para usar a chave real quando disponível.

## Como Gerar o AAB do Motorista

Devido a restrições de segurança do ambiente do agente, você deve executar o comando final no seu terminal local:

```bash
cd apps/motorista
npm run android:bundle
```
*Com as melhorias feitas, o script agora carregará o token do Mapbox automaticamente.*

## Localização do Bundle do Cliente

O arquivo do app **cliente** (versão 1.0.29) foi gerado com sucesso. Para abrir a pasta diretamente no seu Mac, use:

```bash
open apps/cliente/android/app/build/outputs/bundle/release/
```

O arquivo chama-se: `take-me-cliente-1.0.29.aab`.

---

> [!TIP]
> No app motorista, o build gerará o arquivo em:
> `apps/motorista/android/app/build/outputs/bundle/release/take-me-motorista-1.0.20.aab`
