# Consequence Games

Site for [consequence.games](https://consequence.games/)

Games where choices matter, and the dice fall where they may.

## Stack

Static site, no build step. Deployed on Vercel.

- `index.html` — home page, list of games
- `about.html` — about page (served at `/about`)
- `blob/index.html` — BLOB, the first game (served at `/blob`)
- `contact.html` — contact form (served at `/contact`)
- `api/contact.js` — Vercel function that emails form submissions via Resend

## Contact form setup

TODO: not enabled yet. `/contact` currently shows a mailto link; the form is hidden until the env vars below are set.

The form posts to `/api/contact`, which sends mail through [Resend](https://resend.com).
The recipient address and API key are Vercel environment variables, not code:

- `RESEND_API_KEY` (required)
- `CONTACT_TO` (required) — where messages go
- `CONTACT_FROM` (optional) — a sender on a domain verified in Resend. Without it, Resend's test sender is used, which only delivers to the Resend account owner's address.
- `consequence_banner.png` — logo / banner artwork
- `favicon.png` — die crop used as favicon

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Pushes to `main` deploy automatically via the Vercel GitHub integration.
Production domain: `consequence.games`
