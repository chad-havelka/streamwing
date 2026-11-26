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
    ├── /start               opens the bot
    ├── /invite/<code>       referral links
    └── /privacy, /terms     required for opt-in, WhatsApp review and trust
```

- `site/` is the website. Netlify publishes it on every push to `main`.
- `netlify.toml` sets the publish folder and the `/invite/<code>` redirect.
- Signups and survey answers go to Netlify Forms (`early-access` and `pain-survey`).
- Share buttons log to the `share` form: who shared (`lead-id`), their `invite-code`, the channel and where on the page.
- A lead's invite code is the first 8 characters of their `lead-id` with dashes removed. Signups that arrive through `/invite/<code>` carry it as `referral-code`, so a referral matches back to the person who shared.

## Rules

- Never commit tokens, keys or `.env` files. Chaturbate API tokens stay out of this repo.
- Internal reference material (like the Chaturbate developer docs notes) stays out of this repo.
