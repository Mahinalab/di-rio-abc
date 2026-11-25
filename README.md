# Diário ABC

App de diário (check-in, registros ABC, calma, compras e saídas) que funciona no navegador e pode ser instalado no celular.

- **Endereço do app:** https://mahinalab.github.io/di-rio-abc/
- Os registros são criptografados no próprio aparelho antes de irem para o banco. O banco (Supabase) só guarda dados embaralhados.
- Para criar conta é preciso o **código de convite**.

## Como está montado

- `app/` – o site (publicado no GitHub Pages pelo workflow `site.yml`).
- `supabase/schema.sql` – tabelas e funções do banco. Rode uma vez no SQL Editor do Supabase, trocando `CONVITE-AQUI` pelo seu código de convite.
- `scripts/lembretes.mjs` + `.github/workflows/lembretes.yml` – a cada 15 minutos envia as notificações (check-in e avisos de saída/compras).

## Segredos (Settings → Secrets and variables → Actions)

- `SUPABASE_URL` – endereço do projeto Supabase.
- `SUPABASE_SECRET_KEY` – a chave **secreta** do Supabase. Nunca coloque essa chave em arquivo nem mande em conversa.

A chave pública (publishable) fica em `app/config.js` e pode ser pública.

## Trocar o código de convite

No SQL Editor do Supabase: `select abc_definir_convite('novo-codigo');`
