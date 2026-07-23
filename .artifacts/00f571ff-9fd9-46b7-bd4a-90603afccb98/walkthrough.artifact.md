# Walkthrough: Configuração para Geração de AAB (App Cliente)

Implementamos a infraestrutura necessária para gerar o Android App Bundle (AAB) localmente, seguindo o padrão de automação do projeto.

## Mudanças Realizadas

### Scripts de Automação
- **[build-release-bundle.js](file:///Users/andrade/Documents/Mirror/motorista/apps/cliente/scripts/build-release-bundle.js)**: Novo script que automatiza o build via Gradle (`bundleRelease`), gerencia o incremento de versão no `package.json` e renomeia o arquivo final para um padrão identificável.
- **[package.json](file:///Users/andrade/Documents/Mirror/motorista/apps/cliente/package.json)**: Adicionado o atalho `npm run android:bundle`.

### Otimização de Memória do Gradle
- **[gradle.properties](file:///Users/andrade/Documents/Mirror/motorista/apps/cliente/android/gradle.properties)**: Aumentamos o `MaxMetaspaceSize` para `1024m` e o heap (`-Xmx`) para `4096m`. Isso resolve o erro de `Metaspace` que ocorreu durante o processamento intensivo de Lint e KSP em projetos grandes.

### Configuração de Assinatura de Produção
- **[gradle.properties](file:///Users/andrade/Documents/Mirror/motorista/apps/cliente/android/gradle.properties)**: Adicionados campos para `TAKEME_RELEASE_STORE_FILE`, `TAKEME_RELEASE_STORE_PASSWORD`, etc.
- **[build.gradle](file:///Users/andrade/Documents/Mirror/motorista/apps/cliente/android/app/build.gradle)**: Configurada a `signingConfig` de release para usar as propriedades acima, permitindo assinar o app com a chave real localmente.

## Como resolver o erro de permissão do EAS
O erro indica que seu usuário atual (`lucasazmuth23`) não faz parte da organização `fraktal-softwares` no Expo.

1.  **Trocar de conta:** No terminal, rode `npx eas-cli login` e entre com a conta que possui acesso ao projeto.
2.  **Baixar a chave:** Após o login, rode `npx eas-cli credentials` para baixar o arquivo `.jks`.
3.  **Configurar senhas:** Preencha os valores em `apps/cliente/android/gradle.properties`.

## Como usar

Para gerar o bundle agora, execute o seguinte comando no seu terminal (dentro da pasta `apps/cliente` ou na raiz se usar workspaces):

```bash
cd apps/cliente
npm run android:bundle
```

O arquivo será gerado em:
`apps/cliente/android/app/build/outputs/bundle/release/take-me-cliente-1.0.27.aab`

---

> [!WARNING]
> Durante a execução automatizada neste ambiente, o Gradle encontrou um erro de permissão ao tentar criar serviços de localização (`AndroidLocationsBuildService`). Isso é comum em ambientes restritos.
>
> **Ação recomendada:** Execute o comando acima diretamente no seu terminal local, onde o ambiente Android (SDK, Java e permissões de usuário) já está configurado.

## Verificação
- [x] Script criado com sucesso.
- [x] `package.json` atualizado com o novo comando.
- [x] Versão incrementada para `1.0.27`.
