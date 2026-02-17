# CLAUDE.md

## Project

TypeScript CLI that automates Delaware franchise tax payment using Puppeteer. Single-file app at `src/index.ts`.

## Build & Run

```bash
npm install
npm run build        # tsc -> dist/
node dist/index.js   # run with --help for usage
```

## Architecture

Three-page Puppeteer flow against `icis.corp.delaware.gov/ecorp/`:

1. **Page 1** (`logintax.aspx`) — File number entry + captcha. Captcha image is displayed inline in the terminal and user is prompted to enter the code manually. With `--enable-anthropic`, captcha is instead solved automatically via Claude Sonnet vision API. Retries up to 5 times with captcha refresh.
2. **Page 2** (`LlcFiling.aspx`) — Tax review. Checks entity is active, verifies amount due <= `--max-payment`, clicks "Pay Taxes".
3. **Page 3** (`Payment.aspx`) — Payment form. Fills ACH or CC fields based on `--payment-method`, address, phone (split into 3 fields), email, checks authorize box, submits, then verifies success/failure from the response page.

## Key Details

- All form element IDs use ASP.NET naming like `ctl00_ContentPlaceHolder1_...`. These are stable server-generated IDs from the HTML.
- Phone number is split across 3 inputs: `txtPhone1` (area), `txtPhone2` (prefix), `txtPhone3` (line).
- Payment type toggle calls the page's `showpaymenttype()` JS function to show/hide ACH vs CC fields.
- Credit card expiration is two separate dropdowns: month (`DrpExpMonth`) and year (`DrpExpYear`). CLI accepts `MM/YYYY` format.
- Country dropdown defaults to `US`. Only US is currently supported.
- `--verbose` prints full page HTML at each step for debugging.
- Captcha is manual by default (user enters code at prompt). `--enable-anthropic` enables automatic solving via Claude vision (requires `ANTHROPIC_API_KEY` env var).

## Dependencies

- `puppeteer` — browser automation
- `commander` — CLI arg parsing
- `@anthropic-ai/sdk` — captcha solving via Claude vision
