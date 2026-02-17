#!/usr/bin/env node

import { Command } from 'commander';
import puppeteer, { Browser, Page } from 'puppeteer';
import * as readline from 'readline';
import Anthropic from '@anthropic-ai/sdk';

const BASE_URL = 'https://icis.corp.delaware.gov/ecorp/logintax.aspx?FilingType=FranchiseTax';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CLIOptions {
  fileNumber: string;
  maxPayment: number;
  paymentMethod: 'ach' | 'cc';
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
  routingNumber?: string;
  accountNumber?: string;
  cardNumber?: string;
  expDate?: string;
  cvv?: string;
  verbose: boolean;
  enableAnthropic: boolean;
  noPrompt: boolean;
}

function parseOptions(): CLIOptions {
  const program = new Command();

  program
    .name('de-franchise-tax-payer')
    .description('File Delaware franchise tax via the DE Corp website')
    .requiredOption('--file-number <number>', 'Business Entity File Number (up to 9 digits)')
    .option('--max-payment <amount>', 'Max payment amount allowed in dollars', '300')
    .requiredOption('--payment-method <type>', 'Payment method: "ach" or "cc"')
    .requiredOption('--first-name <name>', 'First name')
    .requiredOption('--last-name <name>', 'Last name')
    .requiredOption('--address1 <address>', 'Mailing address line 1')
    .option('--address2 <address>', 'Mailing address line 2')
    .requiredOption('--city <city>', 'City')
    .requiredOption('--state <state>', 'State (2-letter abbreviation)')
    .requiredOption('--zip <zip>', 'Zip code')
    .option('--country <country>', 'Country (2-letter code)', 'US')
    .requiredOption('--phone <phone>', 'Phone number (10 digits, no country code)')
    .requiredOption('--email <email>', 'Email address')
    .option('--routing-number <number>', 'Bank routing number (for ACH)')
    .option('--account-number <number>', 'Bank account number (for ACH)')
    .option('--card-number <number>', 'Credit card number')
    .option('--exp-date <date>', 'Card expiration date (MM/YYYY)')
    .option('--cvv <cvv>', 'Card CVV number')
    .option('--verbose', 'Print page HTML at each step', false)
    .option('--enable-anthropic', 'Use Anthropic API to solve captcha automatically', false)
    .option('--no-prompt', 'Skip payment confirmation prompt', false)
    .parse();

  const opts = program.opts();

  const paymentMethod = opts.paymentMethod.toLowerCase();
  if (paymentMethod !== 'ach' && paymentMethod !== 'cc') {
    console.error('Error: --payment-method must be "ach" or "cc"');
    process.exit(1);
  }

  if (opts.fileNumber.length > 9 || !/^\d+$/.test(opts.fileNumber)) {
    console.error('Error: --file-number must be up to 9 digits');
    process.exit(1);
  }

  if (paymentMethod === 'ach') {
    if (!opts.routingNumber || !opts.accountNumber) {
      console.error('Error: --routing-number and --account-number are required for ACH payment');
      process.exit(1);
    }
  } else {
    if (!opts.cardNumber || !opts.expDate || !opts.cvv) {
      console.error('Error: --card-number, --exp-date, and --cvv are required for credit card payment');
      process.exit(1);
    }
  }

  return {
    fileNumber: opts.fileNumber,
    maxPayment: parseFloat(opts.maxPayment),
    paymentMethod: paymentMethod as 'ach' | 'cc',
    firstName: opts.firstName,
    lastName: opts.lastName,
    address1: opts.address1,
    address2: opts.address2,
    city: opts.city,
    state: opts.state.toUpperCase(),
    zip: opts.zip,
    country: opts.country.toUpperCase(),
    phone: opts.phone.replace(/\D/g, ''),
    email: opts.email,
    routingNumber: opts.routingNumber,
    accountNumber: opts.accountNumber,
    cardNumber: opts.cardNumber,
    expDate: opts.expDate,
    cvv: opts.cvv,
    verbose: opts.verbose ?? false,
    enableAnthropic: opts.enableAnthropic ?? false,
    noPrompt: opts.noPrompt ?? false,
  };
}

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function solveCaptcha(imageBase64: string): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: 'This is a CAPTCHA image with a code on a dark blue background. Read the exact characters shown in the image. Reply with ONLY the captcha code characters, nothing else. The code is typically 5 alphanumeric characters.',
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return text.trim();
}

async function printPageHtml(page: Page, verbose: boolean): Promise<void> {
  if (!verbose) return;
  const html = await page.content();
  console.log('\n--- Page HTML ---');
  console.log(html);
  console.log('--- End HTML ---\n');
}

async function page1_enterFileNumber(page: Page, options: CLIOptions): Promise<void> {
  console.log('Step 1: Navigating to file number entry page...');

  await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
  await printPageHtml(page, options.verbose);

  // Enter the file number
  await page.type('#ctl00_ContentPlaceHolder1_txtPrimaryFileNo', options.fileNumber);

  // Solve the captcha
  console.log('Step 1: Solving captcha...');

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Get captcha image as base64
    const captchaImg = await page.$('#ctl00_ContentPlaceHolder1_ecorpCaptcha1_captchaImage');
    if (!captchaImg) {
      throw new Error('Could not find captcha image element');
    }

    const captchaBase64 = await captchaImg.screenshot({ encoding: 'base64' });

    // Display captcha image in terminal (iTerm2/Kitty/VSCode inline image protocol)
    console.log('Step 1: Captcha image:');
    process.stdout.write(`\x1b]1337;File=inline=1;width=30;preserveAspectRatio=1:${captchaBase64}\x07\n`);

    let captchaCode: string;
    if (options.enableAnthropic) {
      captchaCode = await solveCaptcha(captchaBase64 as string);
      console.log(`Step 1: Captcha attempt ${attempt} (Anthropic): "${captchaCode}"`);
    } else {
      captchaCode = await promptUser('Enter captcha code: ');
      console.log(`Step 1: Captcha attempt ${attempt}: "${captchaCode}"`);
    }

    // Clear any previous captcha input and type new one
    const captchaInput = '#ctl00_ContentPlaceHolder1_ecorpCaptcha1_txtCaptcha';
    await page.$eval(captchaInput, (el: any) => (el.value = ''));
    await page.type(captchaInput, captchaCode);

    // Click continue
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('#ctl00_ContentPlaceHolder1_btnContinue')]);

    await printPageHtml(page, options.verbose);

    // Check if we moved to page 2 (URL should change)
    const currentUrl = page.url();
    if (currentUrl.includes('LlcFiling.aspx') || currentUrl.includes('Filing.aspx')) {
      console.log('Step 1: Successfully passed captcha and file number entry.');
      return;
    }

    // Check for error messages on page
    const errorText = await page.evaluate(() => {
      const errorSection = document.querySelector('.errorSection');
      return errorSection?.textContent?.trim() ?? '';
    });

    if (errorText) {
      console.log(`Step 1: Error on page: ${errorText}`);
    }

    if (attempt < maxAttempts) {
      console.log('Step 1: Captcha may have failed, retrying...');

      // Re-enter the file number (page may have reloaded)
      const fileInput = await page.$('#ctl00_ContentPlaceHolder1_txtPrimaryFileNo');
      if (fileInput) {
        await page.$eval('#ctl00_ContentPlaceHolder1_txtPrimaryFileNo', (el: any) => (el.value = ''));
        await page.type('#ctl00_ContentPlaceHolder1_txtPrimaryFileNo', options.fileNumber);
      }

      // Refresh captcha
      await page.evaluate(() => {
        const btn = document.getElementById('btnRefresh');
        if (btn) btn.click();
      });
      await delay(2000);
    }
  }

  throw new Error(`Failed to solve captcha after ${maxAttempts} attempts`);
}

async function page2_reviewAndPay(page: Page, options: CLIOptions): Promise<void> {
  console.log('Step 2: Reviewing tax filing information...');

  await printPageHtml(page, options.verbose);

  // Check for inactive entity
  const isInactive = await page.evaluate(() => {
    const row = document.getElementById('ctl00_ContentPlaceHolder1_trcancelentity');
    return row ? row.style.display !== 'none' : false;
  });
  if (isInactive) {
    throw new Error('Entity is inactive. Payment of tax does not restore the entity to good standing.');
  }

  // Extract entity name for display
  const entityName = await page.$eval('#ctl00_ContentPlaceHolder1_lblName', (el) => el.textContent?.trim() ?? '').catch(() => '');
  if (entityName) {
    console.log(`Step 2: Entity: ${entityName}`);
  }

  // Extract the total amount due
  const totalDueText = await page.$eval('#ctl00_ContentPlaceHolder1_lblTotalDue', (el) => el.textContent?.trim() ?? '$0.00');

  const totalDue = parseFloat(totalDueText.replace(/[$,]/g, ''));
  console.log(`Step 2: Total amount due: ${totalDueText}`);

  if (totalDue > options.maxPayment) {
    throw new Error(`Amount due ${totalDueText} exceeds max payment allowed $${options.maxPayment.toFixed(2)}. Aborting.`);
  }

  if (totalDue <= 0) {
    throw new Error('Amount due is $0.00 or negative. Nothing to pay.');
  }

  // Click "Pay Taxes" button
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#ctl00_ContentPlaceHolder1_btnPayTax')]);

  console.log('Step 2: Proceeded to payment page.');
}

async function page3_submitPayment(page: Page, options: CLIOptions): Promise<void> {
  console.log('Step 3: Filling in payment information...');

  await printPageHtml(page, options.verbose);

  // Select payment type. The dropdown defaults to ACH. Only change it if needed,
  // since the onchange triggers an ASP.NET postback that reloads the page.
  const payTypeValue = options.paymentMethod === 'ach' ? 'ach' : 'cc';
  const currentPayType = await page.$eval(
    '#ctl00_ContentPlaceHolder1_PaymentControl1_DrpPayType',
    (el) => (el as HTMLSelectElement).value
  );
  if (currentPayType !== payTypeValue) {
    // Set up navigation listener before triggering the change
    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await page.select('#ctl00_ContentPlaceHolder1_PaymentControl1_DrpPayType', payTypeValue);
    await page.evaluate(() => {
      if (typeof (window as any).showpaymenttype === 'function') {
        (window as any).showpaymenttype();
      }
    });
    await navPromise;
    await delay(1000);
  }

  // Select "Pay Full Amount" radio
  await page.click('#ctl00_ContentPlaceHolder1_PaymentControl1_rbFullAmount');

  // Fill first name and last name
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtFirstName', options.firstName);
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtLastName', options.lastName);

  if (options.paymentMethod === 'ach') {
    // Fill ACH fields
    await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtRoutingNum', options.routingNumber!);
    await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtConfirmRoutingNum', options.routingNumber!);
    await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtAccountNum', options.accountNumber!);
    await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtConfirmAccountNum', options.accountNumber!);
  } else {
    // Fill credit card fields
    await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtCardNumber', options.cardNumber!);

    // Parse expiration date MM/YYYY
    const [expMonth, expYear] = options.expDate!.split('/');
    await page.select('#ctl00_ContentPlaceHolder1_PaymentControl1_DrpExpMonth', expMonth);
    await page.select('#ctl00_ContentPlaceHolder1_PaymentControl1_DrpExpYear', expYear);

    await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtCVVNumber', options.cvv!);
  }

  // Fill address fields
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtAddress1', options.address1);
  if (options.address2) {
    await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtAddress2', options.address2);
  }
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtCity', options.city);

  // Select state from dropdown
  await page.select('#ctl00_ContentPlaceHolder1_PaymentControl1_drpState', options.state);

  // Fill postal code
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtPostalCode', options.zip);

  // Select country
  await page.select('#ctl00_ContentPlaceHolder1_PaymentControl1_drpCountry', options.country);

  // Fill phone number (split into 3 fields: area code, prefix, line)
  const phone = options.phone;
  if (phone.length !== 10) {
    throw new Error('Phone number must be exactly 10 digits (no country code)');
  }
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_txtPhone1', phone.substring(0, 3));
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_txtPhone2', phone.substring(3, 6));
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_txtPhone3', phone.substring(6, 10));

  // Fill email
  await page.type('#ctl00_ContentPlaceHolder1_PaymentControl1_TxtEmailAddress', options.email);

  // Check the authorize checkbox
  await page.click('#ctl00_ContentPlaceHolder1_PaymentControl1_ChkAuthorize');

  console.log('Step 3: Payment form filled.');

  if (!options.noPrompt) {
    const confirm = await promptUser('Submit payment? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
      throw new Error('Payment cancelled by user.');
    }
  }

  console.log('Step 3: Submitting...');

  await printPageHtml(page, options.verbose);

  // Click Submit. The page may do a full navigation or an in-place UpdatePanel
  // postback, so try waiting for navigation but fall back to waiting for the
  // network to go idle if no navigation occurs.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    page.click('#ctl00_ContentPlaceHolder1_PaymentControl1_BtnSave'),
  ]);
  await delay(3000);

  await printPageHtml(page, options.verbose);

  // Verify payment success
  console.log('Step 3: Checking payment result...');

  const pageText = await page.evaluate(() => document.body.innerText);
  const pageHtml = await page.content();

  // Check for common error indicators
  const hasError =
    pageHtml.includes('style="color:Red;display: inline') ||
    (pageHtml.includes('ValidationSummary') && pageHtml.includes('display:inline')) ||
    (pageText.toLowerCase().includes('error') && pageText.toLowerCase().includes('payment'));

  // Check for success indicators
  const hasConfirmation =
    pageText.toLowerCase().includes('confirmation') ||
    pageText.toLowerCase().includes('receipt') ||
    pageText.toLowerCase().includes('successful') ||
    pageText.toLowerCase().includes('thank you') ||
    pageText.toLowerCase().includes('payment has been');

  if (hasConfirmation && !hasError) {
    console.log('Payment submitted successfully!');
  } else if (hasError) {
    // Try to extract the error message
    const errorMessages = await page.evaluate(() => {
      const errors: string[] = [];
      document.querySelectorAll('[style*="color:Red"], .reqdtxt, .errorvalidation').forEach((el) => {
        const text = el.textContent?.trim();
        if (text) errors.push(text);
      });
      return errors.filter((e) => e.length > 0);
    });
    throw new Error(`Payment failed. Errors: ${errorMessages.join('; ') || 'Unknown error. Check verbose output for details.'}`);
  } else {
    // If we can't determine success/failure clearly, check URL
    const finalUrl = page.url();
    if (finalUrl.includes('Payment.aspx') && !finalUrl.includes('Confirmation')) {
      throw new Error('Payment may have failed - still on payment page. Enable --verbose to inspect the page.');
    }
    console.log('Payment submission completed. Please verify the confirmation details.');
  }
}

async function main(): Promise<void> {
  const options = parseOptions();

  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.emulateMediaType('screen');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      platform: 'MacIntel',
    });

    // Step 1: Enter file number and solve captcha
    await page1_enterFileNumber(page, options);

    // Step 2: Review tax information and click Pay
    await page2_reviewAndPay(page, options);

    // Step 3: Fill payment details and submit
    await page3_submitPayment(page, options);
  } catch (error: any) {
    console.error(`\nFailed: ${error.message}`);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
