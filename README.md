# Auri — Site Netlify V3

Esta versão muda a Auri para **site-first**: o painel no Netlify vira o centro de configuração. O Telegram fica apenas em `legacy-bot/` como opção/arquivo histórico.

## O que já está no painel
- login por senha (`DASHBOARD_PASSWORD`);
- Marketplaces: Shopee, Mercado Livre, SHEIN e TikTok Shop;
- busca de ofertas verificadas no próprio painel para Shopee e Mercado Livre;
- ofertas salvas/capturadas;
- nichos separados (inclui exemplos Achadinhos e Natal);
- grupos do WhatsApp sincronizados pelo worker;
- campanhas com início/fim por data e hora;
- seleção de nichos e grupos por campanha;
- intervalo mínimo/máximo, por exemplo 10–15 min;
- limite diário por campanha/nicho;
- filas e programação de produto específico;
- cupons, templates, histórico e configurações;
- mínimo padrão de 50 vendas confirmadas;
- termos de maternidade/bebê bloqueados;
- padrão de envio **sem foto anexada**: texto + link para gerar prévia no WhatsApp;
- worker protegido por `AURI_WORKER_TOKEN`.

## Estrutura
- `site/` → faça deploy no Netlify.
- `worker/` → serviço que precisa ficar ligado 24h para manter o WhatsApp conectado e enviar para grupos.
- `legacy-bot/` → código anterior da Auri/Telegram preservado; não é necessário para usar o painel.

## Variáveis do Netlify (site)
- `DASHBOARD_PASSWORD` — senha para entrar no painel.
- `DASHBOARD_SESSION_SECRET` — opcional, recomendado. Use uma frase longa e aleatória.
- `AURI_WORKER_TOKEN` — token secreto compartilhado somente com o worker.

As credenciais/API keys dos marketplaces podem ser adicionadas posteriormente às variáveis do Netlify conforme as integrações forem ativadas. Não coloque chaves dentro dos arquivos do site.

## Variáveis do worker
- `AURI_SITE_URL` — domínio publicado do Netlify, ex.: `https://seusite.netlify.app`
- `AURI_WORKER_TOKEN` — exatamente o mesmo configurado no Netlify.
- `PERSIST_DIR` — diretório persistente para `wa_auth` (recomendado quando hospedar).

## Importante sobre WhatsApp
O Netlify não mantém uma conexão Baileys aberta 24h. Por isso o painel fica no Netlify e o `worker/` fica em um serviço contínuo. Para você, o controle continua 100% pelo site: o worker apenas executa os envios.

O worker envia **somente texto + link**, com `generateHighQualityLinkPreview` ativado. A renderização final da prévia também depende do link/WhatsApp.

## Primeiro deploy
1. Suba a pasta `site/` para um repositório GitHub (ou configure o Netlify com Base directory = `site`).
2. No Netlify, adicione `DASHBOARD_PASSWORD` e `AURI_WORKER_TOKEN` em Environment variables.
3. Publique o site e teste o login.
4. Depois hospede a pasta `worker/` em um serviço que permaneça online 24h e configure `AURI_SITE_URL` + `AURI_WORKER_TOKEN`.
5. Na primeira conexão do worker, leia o QR do WhatsApp. Os grupos serão sincronizados automaticamente para o painel.

## Busca de ofertas no painel
A pesquisa segura foi ligada ao painel para **Shopee** e **Mercado Livre**, aplicando o mínimo configurado de vendas confirmadas. A base anterior de pesquisa mais ampla continua preservada em `legacy-bot/`.

Para **SHEIN** e **TikTok Shop**, esta versão não inventa vendas/preços nem chama link público de link afiliado. Enquanto não houver uma integração verificável no painel, use o cadastro por link/manual para esses marketplaces.
