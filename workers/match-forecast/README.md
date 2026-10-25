# Match-of-the-day forecast

This Cloudflare Worker reads today's published match from the existing match API, requests a short speculative German-language tip from the OpenAI API, and caches the result for six hours. The OpenAI key is only stored as a Worker secret. Requests are limited to the configured site origins and five per IP per minute.

## Deploy

1. Install or use Wrangler and log in to the Cloudflare account:

   ```powershell
   npx wrangler login
   ```

2. From the repository root, deploy the Worker and set the OpenAI API key as a secret:

   ```powershell
   npx wrangler deploy --config workers/match-forecast/wrangler.toml
   npx wrangler secret put OPENAI_API_KEY --config workers/match-forecast/wrangler.toml
   ```

   Wrangler prints the Worker URL after deployment. The forecast endpoint is that URL followed by `/api/forecast`.

3. In the GitHub repository settings, add the Actions **repository variable** `MATCH_FORECAST_URL` with the complete HTTPS endpoint, for example `https://bgb-match-of-day-forecast.<workers-subdomain>.workers.dev/api/forecast`. The site also accepts a host/path without the `https://` prefix and adds HTTPS automatically.

4. Push or manually run the GitHub Pages workflow to rebuild the site with the endpoint configured.

The Worker allows the production site and `http://localhost:4321` by default. Change `ALLOWED_ORIGINS` in `wrangler.toml` if the site is hosted at a different origin. If the rate-limit namespace ID `725001` is already used by another Worker in the Cloudflare account, change it to a unique numeric ID before deploying.

The generated tip is not based on current form, injuries, odds, or match statistics. Keep the on-page disclaimer visible.
