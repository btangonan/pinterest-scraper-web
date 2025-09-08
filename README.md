# Pinterest Board Scraper (Next.js 15, TypeScript)

Server-side scraper for public Pinterest boards with:
- JSON-first extraction from Pinterest’s inline data (__PWS_DATA__)
- Pagination via Pinterest’s internal BoardFeedResource bookmarks (no auth)
- CORS-safe image proxy for reliable thumbnails and downloads
- Optional Playwright-based browser automation fallback

This replaces the default Create Next App README and documents the scraper as implemented.

## Features

- Extracts high-resolution images from public Pinterest boards without authentication
- Robust pagination using Pinterest’s internal bookmark mechanism
- Strong pin identification rules to avoid UI assets, avatars, and ads
- CORS-proof image rendering and downloading through a server proxy
- Optional headless automation route (Playwright) that gracefully falls back to static scraping

## Key Files and Endpoints

Core logic
- JSON/HTML extraction and pagination:
  - [TypeScript.extractImagesFromHtml()](lib/scraper.ts:38)
  - [TypeScript.parseBoardUrl()](lib/scraper.ts:659)
  - [TypeScript.fetchBoardPins()](lib/scraper.ts:698)
  - [TypeScript.scrapePinterestBoard()](lib/scraper.ts:789)
- Image URL transformation:
  - [TypeScript.transformImageUrl()](lib/scraper.ts:29)

API routes
- Scrape with HTML + internal API pagination:
  - [TypeScript.POST() — /api/scrape](app/api/scrape/route.ts:4)
- Multi-strategy static scraping:
  - [TypeScript.POST() — /api/enhanced-scrape](app/api/enhanced-scrape/route.ts:5)
- Comprehensive analysis (multiple strategies, comparisons):
  - [TypeScript.POST() — /api/comprehensive-scrape](app/api/comprehensive-scrape/route.ts:5)
- Download proxy (fixes CORS; used for grid and ZIP downloads):
  - [TypeScript.GET() — /api/download](app/api/download/route.ts:3)
- Optional Playwright automation fallback:
  - [TypeScript.POST() — /api/playwright-scrape](app/api/playwright-scrape/route.ts:7)
  - Node runtime export: [TypeScript.runtime](app/api/playwright-scrape/route.ts:5)
  - Dynamic import for Playwright core inside the route (optional dep): [TypeScript.dynamic import](app/api/playwright-scrape/route.ts:30)

UI
- Renders all thumbnails via proxy to avoid CORS; progressive fallback to larger sizes through proxy:
  - [TypeScript.img usage](app/page.tsx:258)

## How It Works

1) Initial HTML parse (__PWS_DATA__)
- On the first board page, Pinterest embeds a JSON blob in a script tag with id __PWS_DATA__.
- [TypeScript.extractImagesFromHtml()](lib/scraper.ts:38) parses this JSON and extracts pin objects (id + images map; prefers images['236x']).

2) Bookmark-based pagination (no auth)
- For public boards, Pinterest exposes an internal BoardFeedResource endpoint that returns subsequent pin pages when provided a bookmark token.
- [TypeScript.fetchBoardPins()](lib/scraper.ts:698) calls this resource with realistic headers, referer, and X-Requested-With to retrieve successive pages and nextBookmark until exhausted.
- [TypeScript.scrapePinterestBoard()](lib/scraper.ts:789) coordinates: parse the board URL, collect initial pins from HTML, then loop fetchBoardPins() until no next bookmark or no new pins are found. Pins are de-duplicated by id.

3) Strong filtering to avoid false positives
- For HTML regex fallback (when JSON isn’t sufficient), the scraper only allows known pin image dimensions: 170x, 236x, 474x, 564x, 736x, originals, and excludes avatars, /user/, /static/, /closeup/ and other non-pin URLs. See [TypeScript.extractImagesFromHtml()](lib/scraper.ts:38).

4) CORS-safe images and downloads
- Browsers cannot directly fetch from i.pinimg.com due to CORS. The app routes images through a server-side proxy that sets a Pinterest referer header.
- Grid thumbnails, medium/large, and originals are all requested via /api/download. See [TypeScript.GET()](app/api/download/route.ts:3) and [TypeScript.img usage](app/page.tsx:258).

5) Optional Playwright automation
- The /api/playwright-scrape route attempts a headless Chromium session (infinite scroll + page.content()). If Playwright isn’t installed or not available in runtime, it falls back to static scraping. See [TypeScript.POST()](app/api/playwright-scrape/route.ts:7).

## Setup

Requirements
- Node 18+
- macOS, Linux, or Windows

Install dependencies
```bash
npm install
```

Run dev
```bash
npm run dev
# visit http://localhost:3000
```

Build and start
```bash
npm run build
npm start
```

Optional: Enable Playwright route
- If you want /api/playwright-scrape to drive a headless browser:
```bash
npm i -D playwright
npx playwright install chromium
```
The route dynamically imports Playwright at runtime and will skip automation if Playwright isn’t installed. See [TypeScript.dynamic import](app/api/playwright-scrape/route.ts:30).

## Usage

Web UI
- Paste a Pinterest board URL (e.g., https://www.pinterest.com/<username>/<board>/) and click “Scrape Board”.
- Select/deselect pins; choose Medium (474), Large (736), or Original resolution.
- Click “Download as ZIP”. All downloads route via /api/download for CORS-safety.

API endpoints

1) Scrape board (HTML + internal API pagination)
POST /api/scrape
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H 'Content-Type: application/json' \
  -d '{"boardUrl":"https://www.pinterest.com/username/board-slug/"}'
```

2) Enhanced static scrape (multi-user-agent HTML sweeps; no automation)
POST /api/enhanced-scrape
```bash
curl -X POST http://localhost:3000/api/enhanced-scrape \
  -H 'Content-Type: application/json' \
  -d '{"boardUrl":"https://www.pinterest.com/username/board-slug/"}'
```

3) Comprehensive analysis (compares strategies and dedupes)
POST /api/comprehensive-scrape
```bash
curl -X POST http://localhost:3000/api/comprehensive-scrape \
  -H 'Content-Type: application/json' \
  -d '{"boardUrl":"https://www.pinterest.com/username/board-slug/"}'
```

4) Image download proxy (CORS-safe)
GET /api/download?url=<encoded i.pinimg.com URL>
```bash
curl -L "http://localhost:3000/api/download?url=$(node -e "console.log(encodeURIComponent('https://i.pinimg.com/236x/..../image.jpg'))")" \
  -o image.jpg
```

5) Optional headless scrape (Playwright; infinite scroll)
POST /api/playwright-scrape
```bash
curl -X POST http://localhost:3000/api/playwright-scrape \
  -H 'Content-Type: application/json' \
  -d '{"boardUrl":"https://www.pinterest.com/username/board-slug/"}'
```
Note: Requires Playwright installed; otherwise gracefully falls back.

## Design and Filtering Details

Pin identification
- JSON-first approach: look for pin objects with:
  - A numeric id (typical Pinterest pin id length) and
  - An images map containing a 236x URL
- Board scoping: when available, ensure pin.board.id matches current board.
- Exclusions: related/suggestions/story/idea content is ignored.

HTML fallback
- Accept only i.pinimg.com URLs whose dimension segment is one of:
  - 170x, 236x, 474x, 564x, 736x, originals
- Exclude explicit non-pin patterns:
  - /user/, /avatars/, /static/, /boards/, /closeup/
- Dimension- and occurrence-based filtering avoids major UI assets.

Pagination (no browser automation)
- [TypeScript.fetchBoardPins()](lib/scraper.ts:698) and [TypeScript.scrapePinterestBoard()](lib/scraper.ts:789) iterate BoardFeedResource bookmarks until none remain or no new pins are retrieved.
- Requests include realistic headers (User-Agent, X-Requested-With, X-Pinterest-AppState) and referer to the board URL, with a small randomized delay (300–800ms) between calls.

CORS
- All browser image loads and downloads go through /api/download. The proxy adds Referer: https://www.pinterest.com/ and Accept: image/* headers required by the CDN.
- UI renders thumbnails via proxy by default. See [TypeScript.img usage](app/page.tsx:258).
- The download ZIP builder already uses the proxy.

## Configuration Notes

TypeScript target and regex
- tsconfig targets ES2017; any regex using the /s flag has been replaced with [\s\S] to remain compatible.
- __PWS_DATA__ parsing in [TypeScript.extractImagesFromHtml()](lib/scraper.ts:38) avoids scoping issues and logs a short script sample on parse failure for diagnostics.

Node runtime for Playwright route
- /api/playwright-scrape exports [TypeScript.runtime](app/api/playwright-scrape/route.ts:5) as 'nodejs'.
- Playwright is dynamically imported to avoid bundling/type errors if not installed.

## Respecting Pinterest Terms and Rate Limiting

- This tool is intended for public boards only, for personal use, education, or analysis.
- The scraper uses modest page_size and brief randomized delays to be courteous.
- Do not hammer endpoints; do not attempt to circumvent Pinterest security. Review Pinterest’s Terms of Service for acceptable use.

## Troubleshooting

- No images found:
  - Verify the board is public and the URL format is https://www.pinterest.com/<username>/<board>/
  - Try the comprehensive endpoint to compare strategies.
- Some images missing (e.g., 60/88 pins):
  - The bookmark pagination in [TypeScript.scrapePinterestBoard()](lib/scraper.ts:789) should continue until bookmarks are exhausted. Check server logs for page-by-page counts.
- CORS errors on thumbnails:
  - Ensure the grid uses the proxy source (already wired). See [TypeScript.img usage](app/page.tsx:258).
- Playwright route error:
  - If you do not need browser automation, ignore /api/playwright-scrape. If you do, install Playwright and chromium: npm i -D playwright && npx playwright install chromium.

## Changelog (recent)

- Implemented BoardFeedResource pagination with robust headers and bookmark handling
  - [TypeScript.fetchBoardPins()](lib/scraper.ts:698), [TypeScript.scrapePinterestBoard()](lib/scraper.ts:789)
- Hardened pin identification and removed arbitrary upper extraction cap
  - [TypeScript.extractImagesFromHtml()](lib/scraper.ts:38)
- Proxied all browser image loads (grid + ZIP) through /api/download with Pinterest referer header
  - [TypeScript.GET()](app/api/download/route.ts:3), [TypeScript.img usage](app/page.tsx:258)
- Replaced MCP automation with optional Playwright core in Node.js runtime
  - [TypeScript.POST()](app/api/playwright-scrape/route.ts:7), [TypeScript.dynamic import](app/api/playwright-scrape/route.ts:30)

## License

MIT — see LICENSE if provided in this repository.
