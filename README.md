# Consequence Games

Site for [consequence.games](https://consequence.games/)

Games where choices matter, and the dice fall where they may.

## Stack

Static site, no build step. Deployed on Vercel.

- `index.html` — home page, list of games
- `about.html` — about page (served at `/about`)
- `blob/index.html` — BLOB, the first game (served at `/blob`)
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
