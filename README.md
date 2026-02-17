# de-franchise-tax-payer

CLI tool to pay Delaware franchise tax via Puppeteer.

## Install

```bash
npm install
npm run build
```

By default, the captcha is displayed in the terminal and you enter the code manually. To automate captcha solving with Claude vision, pass `--enable-anthropic` and set the `ANTHROPIC_API_KEY` env var. Create one at https://console.anthropic.com/settings/keys.

## Usage

### ACH Payment

```bash
node dist/index.js \
  --file-number 123456789 \
  --payment-method ach \
  --first-name John --last-name Doe \
  --address1 "123 Main St" --city Wilmington --state DE --zip 19801 \
  --phone 3025551234 --email john@example.com \
  --routing-number 021000021 --account-number 123456789
```

### Credit Card Payment

```bash
node dist/index.js \
  --file-number 123456789 \
  --payment-method cc \
  --first-name John --last-name Doe \
  --address1 "123 Main St" --city Wilmington --state DE --zip 19801 \
  --phone 3025551234 --email john@example.com \
  --card-number 4111111111111111 --exp-date 06/2028 --cvv 123
```

### Options

| Flag | Required | Description |
|------|----------|-------------|
| `--file-number` | Yes | Business Entity File Number (up to 9 digits) |
| `--payment-method` | Yes | `ach` or `cc` |
| `--first-name` | Yes | First name |
| `--last-name` | Yes | Last name |
| `--address1` | Yes | Mailing address line 1 |
| `--address2` | No | Mailing address line 2 |
| `--city` | Yes | City |
| `--state` | Yes | State (2-letter code) |
| `--zip` | Yes | Zip code |
| `--country` | No | Country code (default: `US`) |
| `--phone` | Yes | Phone number (10 digits, no country code) |
| `--email` | Yes | Email address |
| `--routing-number` | ACH only | Bank routing number |
| `--account-number` | ACH only | Bank account number |
| `--card-number` | CC only | Credit card number |
| `--exp-date` | CC only | Expiration date (`MM/YYYY`) |
| `--cvv` | CC only | CVV number |
| `--max-payment` | No | Max allowed payment amount (default: `300`) |
| `--verbose` | No | Print page HTML at each step |
| `--enable-anthropic` | No | Use Anthropic API to solve captcha automatically |
