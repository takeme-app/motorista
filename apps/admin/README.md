# Take Me — Admin (painel web)

Repositório do **painel administrativo** Take Me (Expo Web). O pacote [`@take-me/shared`](packages/shared) fica em `packages/shared` (cópia do monorepo principal — alinhar versões quando necessário).

- **Remoto:** `git@github.com:takeme-app/admin.git`

## Rodar localmente

Na raiz deste repositório:

```bash
npm install
npm run start
```

Abra a URL indicada (porta **8090** por omissão). O Metro usa `metro.config.js` da raiz.

## Variáveis de ambiente

Copie [.env.example](.env.example) para `.env` e preencha. O `app.config.js` expõe variáveis em `Constants.expoConfig.extra`.

## Build / deploy (Vercel)

`npm run build` (Expo export web → `dist/`). Na Vercel, use a raiz do repositório; `vercel.json` está na raiz.

**Variáveis típicas:** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## Documentação QA (monorepo Take Me)

Os runbooks detalhados continuam no repositório principal Take Me, em `docs/admin-qa-*.md` (clone o monorepo ou abra no GitHub da organização Fraktal).

## Testes E2E (Playwright)

1. Uma vez: `npx playwright install chromium`
2. Credenciais: `E2E_ADMIN_EMAIL` e `E2E_ADMIN_PASSWORD` no `.env` na raiz (ver `.env.example`).
3. `npm run test:e2e`

Com servidor já a correr: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8090 PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e`
