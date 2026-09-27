# weektally-site

The public site at weektally.com: the landing page and the demo page for
[Weektally](https://weektally.app/), by Fyren Labs. The app itself lives in
a separate, private repository.

Plain HTML and CSS, no build step. The palette and type are the app's
(Fjord, Manrope).

- `forward.js` sends old app links (`weektally.com/#/week`) to the same route
  on weektally.app. The part after `#` never reaches the server, so this
  can only be done in the browser.
- Pushes to `main` deploy to an Azure Static Web App (Free, West Europe).
  Only the files listed in `.github/workflows/deploy.yml` are published.
- `staticwebapp.config.json` sets a strict Content-Security-Policy: scripts
  from this site only, fonts from Google Fonts, no inline script.

Preview locally with any static server, for example:

    python3 -m http.server 8750
