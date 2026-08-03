/**
 * Utilitário para carregar o arquivo .env da raiz do monorepo.
 * Isso garante que segredos como MAPBOX_DOWNLOADS_TOKEN fiquem disponíveis
 * para o processo do Gradle.
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const rootEnvPath = path.resolve(__dirname, '../../../../.env');
  if (!fs.existsSync(rootEnvPath)) {
    console.log('Aviso: Arquivo .env não encontrado na raiz do repositório.');
    return;
  }

  const envContent = fs.readFileSync(rootEnvPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) return;

    const [key, ...valueParts] = trimmedLine.split('=');
    const value = valueParts.join('=').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  });
  console.log('Variáveis de ambiente carregadas do .env da raiz.');
}

module.exports = { loadEnv };
