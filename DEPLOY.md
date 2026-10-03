# Deploying OpenChart as a free static site

OpenChart ships as **one self-contained `index.html` (~600 KB)**: no build
step, no framework, no external network calls (verified: no `fetch`, no
external scripts/fonts/styles; the only URL in the file is the Lucide icons
license comment). Diagrams live in each visitor's `localStorage` on their
own device, and "Save copy" / JSON download makes work portable. That means
**any static host can serve it as-is from the repository root**.

> Note: saved diagrams are per-domain (browser localStorage). If you later
> move the site to a different domain, users' saved drafts do not follow
> automatically — the JSON download/import is the portable path.

## Recommended: GitHub repo + Cloudflare Pages

Best free combination: your code lives on GitHub (open-source home, issues,
PRs), while Cloudflare Pages serves it with **no bandwidth or request caps**
on static assets, a fast global CDN, free SSL, and free custom domains.
Free tier facts (Cloudflare docs): 500 builds/month, 20,000 files, 25 MiB
per file — far beyond what this one-file site needs.

1. Create an empty repo on GitHub and push this folder (see "First push"
   below).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
   Connect to Git**, pick the repo.
3. Build settings: **Framework preset = None**, **Build command = empty**,
   **Build output directory = /** (the repo root already *is* the site).
4. Deploy. You get `<project>.pages.dev` with HTTPS. Every `git push`
   auto-deploys; pull requests get preview URLs.

## Simplest: GitHub Pages (repo and site in one place)

1. Push the repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: "Deploy from a
   branch"**, branch `main`, folder `/` → Save.
3. The site goes live at `https://<user>.github.io/<repo>/` (allow a minute
   for the first build; hard-refresh if you see a stale page).

GitHub Pages is free for public repositories with a soft **100 GB/month
bandwidth** limit and a 1 GB site-size limit — a 600 KB page is roughly
160,000 page loads/month against that cap. The included `.nojekyll` file
skips Jekyll processing so deploys are faster and nothing is transformed.

## Zero-git one-off: Netlify Drop

For a quick shareable demo without any git: go to
**app.netlify.com/drop**, drag this folder's `index.html` onto the page,
and the site is live immediately on `*.netlify.app` with HTTPS. Free plan
allows **100 GB bandwidth/month** (then it rate-limits until the next
cycle). Claim the site to a (free) Netlify account to keep it beyond the
temporary window and to rename the subdomain.

## First push (run inside this folder)

```bash
git init
git config user.name  "Your Name"        # if not configured globally
git config user.email "you@example.com"
git add -A
git commit -m "OpenChart: initial public snapshot"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

(`git init` has already been run here; everything is staged except
`.DS_Store` and the scratch `output/` directory.)

## Custom domain (optional, free on all three hosts)

- **Cloudflare Pages**: add the domain in the Pages project (best if the
  domain's DNS is already on Cloudflare — it is one click and auto-SSL).
- **GitHub Pages**: add a `CNAME` file containing your domain (or set it in
  Settings → Pages), plus the DNS records GitHub shows you.
- **Netlify**: add the domain in Site settings → Domain management.

## Optional polish before announcing

- Add a favicon (an inline SVG data-URI `<link rel="icon">` keeps the
  single-file property).
- The page already has `<title>OpenChart — Diagram editor` and a meta
  description; consider Open Graph (`og:title`, `og:image`) tags for nicer
  link previews when shared.
- If you want usage insight without cookies or accounts, Cloudflare Web
  Analytics (free) or a privacy-friendly counter can be added as a tiny
  script — this is the only kind of external request the site would ever
  make, so it stays opt-in.
