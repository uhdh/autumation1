# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"엑셀아파트" — an apartment (Korean 아파트) real-estate transaction-price viewer disguised as a Microsoft Excel
spreadsheet (title bar, ribbon, sheet tabs), so it looks like work while showing MOLIT (국토교통부) real transaction
data for Seoul apartment complexes. Same disguise concept as the "엑셀코스피" stock-ticker site, with apartment
transactions swapping in for stock quotes. No login; watchlist is stored in `localStorage`.

## Stack and structure

Static site, zero build step, zero dependencies (no `package.json`, no bundler):

- `index.html` — the entire frontend: CSS, markup, and all application JS live in one inline `<script>` block at
  the bottom of the file. There is no module system and no separate JS files.
- `functions/api/apt-trade.js` — Cloudflare Pages Function. Proxies the public MOLIT apartment-trade API
  (`RTMSDataSvcAptTrade`), parses its XML response with regex (no XML library), and optionally caches in KV.
- `functions/api/apt-news.js` — Pages Function proxying the Naver News search API for the "부동산 뉴스" pane.
- `seoul_apt_complex.json` — static snapshot (3,174 rows) of Seoul apartment complexes from K-apt
  (공동주택관리정보시스템), used only to supply `householdCount`/`buildYearMonth`, which the MOLIT trade API doesn't
  return. Matched at runtime against trade results by normalized complex name.
- `seoul_chopuma.json` — static snapshot (95 rows) of "초품아" (elementary-school-adjacent) complexes scraped from a
  Namuwiki user-edited list — unofficial, surfaced only as a badge with a tooltip disclaimer.
- `seoul_lawd_codes.json` / the `SEOUL_GU` array duplicated in `index.html` — LAWD_CD (법정동코드) mapping for the 25
  Seoul districts the app currently supports.
- `아파트실거래가_기획문서.md` — the original planning doc; useful background on *why* the data pipeline is shaped
  the way it is (API quirks, rejected approaches) but not authoritative over the code.

Editing `index.html` directly changes production behavior — there's no compile/transpile step between source and
what ships.

## Commands

```bash
# Local dev server with Functions support (requires wrangler)
npx wrangler pages dev . --binding APT_SERVICE_KEY=<your_key>
```

Opening `index.html` directly in a browser also works, but `/api/*` calls will fail (404) and the UI silently falls
back to the hardcoded `SAMPLE_ITEMS`/`SAMPLE_NEWS` data with a status note explaining why.

There is no test suite, linter, or type checker in this repo — don't invent commands for them.

Deployment is via Cloudflare Pages connected to this repo. Required environment variables:
- `APT_SERVICE_KEY` — data.go.kr service key, must stay in its raw URL-encoded form (e.g. containing `%2B`)
- `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` — Naver Open API credentials for the news proxy
- KV namespace bound as `APT_CACHE` (optional — both functions degrade gracefully without it, just with no caching)

## Data flow / architecture

1. User picks a district (`lawdSelect`, LAWD_CD) and month (`ymdSelect`, YYYYMM) → `fetchLiveData()` calls
   `/api/apt-trade?lawdCd=&dealYmd=`.
2. `apt-trade.js` checks KV (`apt:{lawdCd}:{dealYmd}`, 6h TTL) → else calls the MOLIT XML endpoint (a `User-Agent`
   header is required or their WAF 400s the request) → regex-parses `<item>` blocks → caches → returns JSON.
3. Client-side, `loadHouseholdCounts()` matches each returned `aptNm` against `seoul_apt_complex.json` via
   `matchSeoulComplex()`: normalize both names with `normalizeAptName()` (strips whitespace/parens/dashes, and
   `stripDongSuffix()` first removes trailing unit/dong suffixes like `(102동)`), then prefer an exact-name match in
   the same 법정동 (`umdNm`/`dong`), else any exact-name match, else a substring fallback.
4. `filterMandatoryManaged()` then **drops any transaction whose complex didn't match** the K-apt list — this is
   intentional (the K-apt snapshot only covers 의무관리대상 complexes), not a bug, and it's why some real
   transactions never appear.
5. `render()` fans the filtered `currentItems` out to four independently-rendered "sheets": 대장단지 (top price per
   법정동, via `getFlagshipsByDong`), 관심단지 (user's `localStorage` watchlist), 실거래 속보 (feed sorted by date
   desc), and 부동산 뉴스 (from `apt-news.js`).
6. The "2026 최다거래" ribbon tab is a separate, independent flow: `aggregateTopTraded()` fetches all 25 districts ×
   6 months (150 requests) client-side with bounded concurrency (`mapWithConcurrency`, limit 6), reusing the same
   6h KV cache per (district, month) that `apt-trade.js` already provides — there's deliberately no dedicated
   aggregation backend. Results are cached in `localStorage` (`apt_review_top_traded_2026`, 6h TTL) and only
   recomputed on demand.

## Conventions specific to this repo

- All identifiers, UI strings, and comments are Korean; keep new code consistent with that rather than switching to
  English.
- Currency is formatted in 억 (`fmtAmount`, from 만원/manwon units) and area in 평/pyeong (`fmtAreaPyeong`, from ㎡),
  not raw API units — reuse these helpers rather than reformatting inline.
- `dealAmount` and other fields arrive from the MOLIT API as comma-formatted strings inside XML text nodes, not
  numbers — see `matchTag`/`parseItems` in `apt-trade.js` for the expected parsing pattern.
- `cdealType` non-empty means a cancelled/rescinded transaction (`isCancelled`); it's kept in the data (shown
  struck-through/flagged) rather than dropped, except in the top-traded aggregation, which excludes it.
- Both Functions files return errors as JSON with a `error` field and appropriate HTTP status rather than throwing;
  the frontend surfaces `data.error`/exception messages directly in the status bar for debuggability, so keep error
  messages descriptive when touching these files.
