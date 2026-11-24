# consequence-scores

High score API for consequence.games, on Cloudflare Workers with a D1 (SQLite) database. The site itself stays on Vercel; this folder is excluded from the Vercel deploy by `.vercelignore`.

## One-time setup

From this folder:

```sh
npm install
npx wrangler login                              # opens a browser to sign in to Cloudflare
npx wrangler d1 create consequence-scores       # prints a database_id
#   paste that database_id into wrangler.toml
npx wrangler d1 execute consequence-scores --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN             # any long random string; you'll use it to delete scores
npx wrangler secret put IP_SALT                 # any random string
npx wrangler deploy                             # prints the URL, e.g. https://consequence-scores.<you>.workers.dev
```

Then set `SCORES_API` near the top of the script in `snail/index.html` to that URL and push. While `SCORES_API` is empty the game hides high scores.

## API

- `GET /scores?game=snail` returns the top 10 all time and the top 10 from the past 24 hours.
- `POST /scores` with `{ game, name, elapsed, detail }`. The worker computes the score itself from `elapsed` and `detail.counts`, using the same rules as the game, and rejects numbers that aren't possible.
- `DELETE /scores/<id>` with header `Authorization: Bearer <ADMIN_TOKEN>` removes an entry.

```sh
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://consequence-scores.<you>.workers.dev/scores/42
```

## Keep in sync with the game

If you change ISA's scoring (`baseRate`, `lootEvery`, the `sets` tables in `LOOT`), change the matching numbers in `GAMES.snail` in `src/index.js`, or new scores will be computed with the old rules.

## Limits

- Names are 3 letters A-Z. `BLOCKED_NAMES` in `src/index.js` refuses a few; delete anything else with the admin call.
- One submit per 5 seconds and 30 per hour per IP. IPs are stored only as a salted hash.
- Cheating is limited, not prevented: someone can still post invented but plausible runs.

## Local testing

```sh
printf 'ADMIN_TOKEN=test\nIP_SALT=test\n' > .dev.vars
npx wrangler d1 execute consequence-scores --local --file=schema.sql
npx wrangler dev
```
