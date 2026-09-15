# Auri v4 — Universo da Esther

Bot privado no Telegram para organizar ofertas, gerar textos, buscar oportunidades e enviar automaticamente para grupos do WhatsApp.

## O que funciona sem nenhuma chave nova
- Telegram + WhatsApp
- fila
- envio automático 08h–22h
- múltiplos grupos
- atraso aleatório entre grupos
- cadastro manual
- oferta por link (mantém o link informado)
- anti-duplicação
- pausar/retomar/enviar agora

## O que ativa ao adicionar credenciais
### Shopee Affiliate Open API
Variáveis:
- SHOPEE_AFFILIATE_APP_ID
- SHOPEE_AFFILIATE_SECRET

Ativa:
- busca de produtos
- dados reais: imagem, preço, vendas, avaliação, comissão
- geração automática de link de afiliada
- busca automática por nichos
- atualização de preço antes do envio
- resultados/comissões dos últimos 7 dias

### IA
Adicione ao menos uma:
- OPENAI_API_KEY
- GEMINI_API_KEY
- ANTHROPIC_API_KEY

Sem chave de IA, a Auri usa um texto local simples e não inventa dados.

### Amazon
- AMAZON_ACCESS_KEY
- AMAZON_SECRET_KEY
- AMAZON_PARTNER_TAG

### Mercado Livre
- MELI_ACCESS_TOKEN (para dados via API). O link de afiliado deve ser gerado pelo Portal/Barra de Afiliados oficial e colado na Auri.

### SHEIN
A SHEIN exige que os produtos compartilhados para comissão sejam selecionados/gerados no Centro de Afiliados. A Auri aceita esse link oficial e cuida do restante, mas não transforma um link comum da SHEIN em link com comissão sem uma API oficial da conta.

## Railway
Mantenha o Volume montado em `/data` e `PERSIST_DIR=/data`.

Suba os arquivos no mesmo repositório. O volume preserva sessão do WhatsApp, fila e histórico.
