# Auri — Automação de ofertas

Auri é um bot privado do Telegram para cadastrar ofertas e enviá-las automaticamente para um grupo de WhatsApp.

## Como fica no dia a dia

Depois da configuração inicial, você usa apenas o Telegram:

1. toque em **➕ Nova oferta**;
2. envie a foto;
3. envie o texto;
4. envie o link de afiliada;
5. toque em **✅ Salvar e colocar na fila**.

Pronto. Você pode fechar o Telegram. Auri envia sozinha a próxima oferta da fila para o grupo escolhido.

## Programação configurada

- 1 oferta por vez;
- a cada 10 minutos;
- de 08:00 até 22:00;
- fuso `America/Sao_Paulo`;
- fila persistente quando `PERSIST_DIR` aponta para um volume permanente.

Se a fila estiver vazia, não envia nada. Se estiver pausada, aguarda você retomar.

## Painel no Telegram

- ➕ Nova oferta
- 📦 Fila
- 📱 WhatsApp
- 👥 Escolher grupo
- 📊 Status
- ▶️ Enviar agora
- ⏸️ Pausar envios / ▶️ Retomar envios

## Configuração inicial

O bot precisa ficar rodando em um servidor Node.js. Telegram não hospeda o código do bot.

Variáveis necessárias:

```env
TELEGRAM_BOT_TOKEN=SEU_TOKEN_DO_BOTFATHER
TELEGRAM_ADMIN_ID=SEU_ID_NUMERICO_DO_TELEGRAM
TZ=America/Sao_Paulo
INCLUDE_22=true
PERSIST_DIR=/data
```

Depois de iniciar o serviço:

1. abra a Auri e envie `/start`;
2. toque em **📱 WhatsApp**;
3. envie seu número com DDI + DDD + número, apenas dígitos;
4. use o código de pareamento exibido pela Auri no menu de aparelhos conectados do WhatsApp;
5. toque em **👥 Escolher grupo** e selecione o grupo;
6. confirme em **📊 Status** que WhatsApp, grupo e automação estão corretos.

A partir daí, basta salvar ofertas na Auri.

## Segurança

Auri aceita comandos somente do `TELEGRAM_ADMIN_ID` configurado. Não publique o token do BotFather no GitHub ou em mensagens.

## WhatsApp

A conexão usa Baileys/WhatsApp Web e não é a API oficial da Meta. A sessão pode precisar ser reconectada em alguns casos e o uso deve respeitar as regras do WhatsApp e as expectativas dos participantes do grupo.
