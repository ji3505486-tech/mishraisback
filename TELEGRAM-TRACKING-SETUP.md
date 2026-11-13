# Telegram Tracking Setup

This project uses the existing Telegram bot with a Vercel webhook and Upstash Redis. It does not count landing-page button clicks as joins.

## Vercel Production environment variables

Add these in Vercel Project Settings → Environment Variables. Never put secrets in GitHub or the browser.

- `TELEGRAM_BOT_TOKEN`: token from BotFather
- `TELEGRAM_WEBHOOK_SECRET`: a random 32–64 character secret using letters, numbers, underscores, or hyphens
- `TELEGRAM_SETUP_KEY`: a separate random admin secret used only to authorize webhook setup
- `TELEGRAM_DASHBOARD_KEY`: a separate random admin secret used only to read reports
- `TELEGRAM_CHANNEL_ID`: numeric ID of the private channel, normally a negative number beginning with -100
- `UPSTASH_REDIS_REST_URL`: existing Upstash REST URL
- `UPSTASH_REDIS_REST_TOKEN`: existing Upstash REST token

Set all variables for Production, then redeploy.

## Telegram permissions

Add the bot as an administrator in the private channel. It needs permission to invite users/manage join requests and receive membership updates. It does not need permission to post messages.

## Configure webhook

Send a POST request to `/api/telegram-setup` with header `Authorization: Bearer <TELEGRAM_SETUP_KEY>`. Do not put the key in a URL or share it in chat. A successful response confirms Telegram accepted the webhook configuration.

## Endpoints

- `POST /api/telegram-webhook`: Telegram updates; verifies Telegram's secret-token header.
- `POST /api/telegram-setup`: authenticated one-time webhook configuration.
- `GET /api/telegram-report`: protected JSON report; requires `Authorization: Bearer <TELEGRAM_DASHBOARD_KEY>`.

The report separates join requests from accepted joins and leaves. Current member count is queried from Telegram. Telegram does not provide historical join events, so counts begin after webhook setup. The report endpoint is JSON, not a graphical dashboard yet.
