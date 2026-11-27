# StreamWing

StreamWing.studio: the AI assistant that works inside the stream.

## What's here

```
StreamWing.studio            the company and the suite
├── StreamWing bot           flagship: the creator's AI assistant
│   └── the six features     Fan Management, Stream Prep, Chat Assistance,
│                            Business Intelligence, Creator Protection, Retention
├── CleverGURL               short links and landing pages
└── the site
    ├── /                    home, sells the bot
    ├── /connect-to-chaturbate   setup: connect a Chaturbate room
    ├── /owl                 StreamWing itself (/start forwards here)
    ├── /invite/<code>       referral links
    └── /privacy, /terms     required for opt-in, WhatsApp review and trust
```

- `site/` is the website. Netlify publishes it on every push to `main`.
- `netlify.toml` sets the publish folder and the `/invite/<code>` redirect.
- Signups and survey answers go to Netlify Forms (`early-access` and `pain-survey`).
- Share buttons log to the `share` form: who shared (`lead-id`), their `invite-code`, the channel and where on the page.
- A lead's invite code is the first 8 characters of their `lead-id` with dashes removed. Signups that arrive through `/invite/<code>` carry it as `referral-code`, so a referral matches back to the person who shared.

## Worker settings (Railway variables)

- `DATABASE_URL`, `TOKEN_SECRET`: references to the Railway Postgres service.
- `ANTHROPIC_API_KEY`: turns on the one-line AI note per fan. Without it, everything else works and the notes stay off.
- Optional: `AI_MODEL` (default `claude-haiku-5-5`), `AI_NOTES_PER_STREAM` (default 40).

## Rules

- Never commit tokens, keys or `.env` files. Chaturbate API tokens stay out of this repo.
- Internal reference material (like the Chaturbate developer docs notes) stays out of this repo.
