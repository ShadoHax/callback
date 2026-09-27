# Callback deployment

Production: **https://callback-khaki-phi.vercel.app**

Vercel team/project: `callback-hack-gt/callback`, Free Hobby plan. Supabase project: `lamxdooshyhikqgwpupq`. The first production deployment passed its build and hosted integration checks on September 26.

## Update the app

Run from `callback/` using the authorized Vercel account:

```sh
npx vercel@60.1.3 login
npx vercel@60.1.3 link --project callback --scope callback-hack-gt
npx vercel@60.1.3 deploy --prod --scope callback-hack-gt
```

The setup machine is already logged in and linked; only the deploy command is needed there. `.vercelignore` excludes `.env*` and `data/private/` from uploads. Review `git diff` before deploying because CLI deployments include the current working files, including uncommitted changes.

GitHub automatic deployments are **not connected**: the Vercel account could not access `AaravAgarwal/callback`. CLI deployment works independently. A repository owner can connect that repository later if desired.

## Hover memory migration

Apply `supabase/migrations/20260926_context_indexes.sql` before enabling hover. This was applied to the configured Supabase project on September 26. The table is private, owner-readable, and writable only by the server. Start hover prepares memory; switching model/provider or changing approved context requires preparation again. See [hover behavior and phone rehearsal](HOVER.md).

## Environment

Production and Preview select Meta muse-spark-1.3 with MODEL_API_KEY stored as a secret. They also have the Supabase URL, publishable key, server-only service-role key, `DEMO_MODE`, `DEMO_OWNER_ID`, `COMMERCE_ENABLED`, and model/reasoning settings. Demo login passwords stay local; they are not deployed. Keep model API keys in Vercel's sensitive environment settings, never in source files or `NEXT_PUBLIC_` variables.

Only for an explicit fallback deployment, set `MODEL_PROVIDER=openai`, `OPENAI_MODEL=gpt-5.4-mini`, `OPENAI_API_KEY`, and `MODEL_MAX_COMPLETION_TOKENS=6000` locally in the ignored `.env.local` and, when deploying that route, in Vercel's Production and Preview environments. The OpenAI route uses only `OPENAI_API_KEY` and the official OpenAI endpoint; `MODEL_API_KEY` remains reserved for Meta. Changing Vercel environment variables does not alter an existing deployment, so redeploy after the change.

For the Meta deployment, set `MODEL_PROVIDER=meta`, add `MODEL_API_KEY` as a sensitive value, and confirm `META_MODEL` and any `META_API_BASE_URL` change with the organizers. Redeploy and rerun the photo smoke, live scan loop, and physical two-phone rehearsal on Meta. Do not describe an OpenAI run as Meta-powered.

For checkout, add **test-only** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and set `APP_ORIGIN=https://callback-khaki-phi.vercel.app`. Without an explicit `APP_ORIGIN`, hosted checkout uses the current request origin. Keep the local development origin at `http://localhost:3000`. Never deploy a live Stripe key.

Configured September 26: `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`, and `APP_ORIGIN` are set on Vercel production. The Stripe test-mode webhook endpoint is `https://callback-khaki-phi.vercel.app/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Environment changes need a redeploy to take effect.

## Verify a deployment

With `.env.local` containing the demo credentials, run these **sequentially**, away from an active rehearsal. The commerce check briefly inserts a synthetic context update and deletes it afterwards.

```sh
npm run access:check -- --app https://callback-khaki-phi.vercel.app
npm run commerce:check -- --app https://callback-khaki-phi.vercel.app
```

The initial hosted run passed 24/24 and 17/17 respectively, with no inference or checkout. Local GPT-5.4 mini smoke passed text and a Wingspan image, and one localhost end-to-end loop passed 8/8 with a public manufacturer image and scripted reply. Hosted GPT-5.4 mini subsequently passed 51/51 checks (five complete loops) and 14/14 cancellation/reset checks. Physical human exchanges remain unverified. For each deployed provider, run the photo smoke and live scan loops from [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md), then rehearse with physical phones. Label developer fixtures and scripted replies as such.

## Optional settings added September 26

- Proximity remains disabled unless `NEXT_PUBLIC_ENABLE_PROXIMITY=true` at build and runtime. Before enabling it, apply the presence migration and verify the explicit opt-in flow; ordinary scans do not require proximity.

- `PREVIEW_SIGNING_SECRET` (32+ random characters, e.g. `openssl rand -hex 32`): signs unsaved hover previews. Without it, a key is derived from the service credential with HKDF. Setting or rotating it invalidates outstanding 10-minute previews only.
- `MEMORY_REASONING_EFFORT` (`low` default): effort for preparing relationship memory. `medium` was slower (18–23 s) and once overflowed the output cap.
