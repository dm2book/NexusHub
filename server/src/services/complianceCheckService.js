/**
 * Is this shop legally able to open, or does it only look like it?
 *
 * ── The rule this file is built around ────────────────────────────────────
 *
 * A page existing proves nothing. This shop has a terms page, a privacy policy,
 * a cookie policy and a refund page, all written and all substantive — and it
 * can still be illegal to open, because compliance is a property of what the
 * business DOES and DISCLOSES, not of which routes return 200.
 *
 * So every check here tests a fact, not a file:
 *
 *   · the terms say prices include VAT — is VAT actually configured anywhere?
 *   · the privacy policy names Resend and Neon — is that what is deployed?
 *   · the invoice is titled "Invoice" — does it carry what an invoice must?
 *   · the cookie banner exists — does refusing it actually delete anything?
 *
 * A check that cannot be decided by software is reported as OWNER, never as a
 * pass. There are three of those and they are the ones that matter most: whether
 * the business is registered, whether processing agreements were really signed,
 * and whether the published identity is truthful. Software can see that a field
 * is filled in. It cannot see that it is true.
 *
 * ── Levels ────────────────────────────────────────────────────────────────
 *
 *   FAIL   opening the shop like this breaks a rule, or publishes a claim the
 *          system contradicts
 *   WARN   legal, but thin — or true today and easy to make untrue
 *   OWNER  needs a real fact about the real business; no code can answer it
 *   PASS   verified against configuration or source, and said so
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, manualPayMethods } from '../config/env.js';
import { isEnabled as mollieEnabled } from '../services/mollieService.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; }
};

/** Loaded from source rather than imported: this runs in the API, which has no JSX. */
async function sellerIdentity() {
  try {
    const mod = await import(path.join(ROOT, 'src/lib/legalIdentity.js'));
    return mod.LEGAL;
  } catch {
    return null;
  }
}

const HOST = () => {
  try { return new URL(config.appUrl).hostname.replace(/^www\./, ''); } catch { return ''; }
};

export async function auditCompliance() {
  const out = [];
  const add = (area, id, level, title, detail, action = null) =>
    out.push({ area, id, level, title, detail, ...(action ? { action } : {}) });

  const LEGAL = await sellerIdentity();
  const terms = read('src/content/legal.js') || '';
  const invoice = read('server/src/services/billingService.js') || '';
  const consent = read('src/lib/consent.js') || '';
  const support = read('src/lib/support.js') || '';

  // ── 1. Who is selling ─────────────────────────────────────────────────────
  //
  // Art. 6:230m BW / Consumer Rights Directive: a trader must give their
  // identity and geographic address BEFORE the consumer is bound. Not in a
  // reply to an email afterwards — before.
  const idFields = { legalName: 'legal name', address: 'street address', postcode: 'postcode', city: 'city' };
  const missing = LEGAL ? Object.entries(idFields).filter(([k]) => !LEGAL[k]).map(([, v]) => v) : Object.values(idFields);
  if (!LEGAL) {
    add('identity', 'identity.unreadable', 'FAIL', 'Seller identity could not be read',
      'src/lib/legalIdentity.js did not load, so nothing here can be verified.');
  } else if (missing.length) {
    add('identity', 'identity.missing', 'FAIL', 'The shop cannot say who is selling',
      `Missing: ${missing.join(', ')}. Dutch and EU law require a name and a geographic `
      + 'address before a consumer is bound by the order — a footer that omits them is not a '
      + 'formality, it is the disclosure the rest of the terms hang off.',
      'Fill in legalName, address, postcode and city in src/lib/legalIdentity.js.');
  } else {
    add('identity', 'identity.present', 'PASS', 'Seller identity is published',
      `${LEGAL.legalName}, ${[LEGAL.address, LEGAL.postcode, LEGAL.city].filter(Boolean).join(' ')}.`);
    // Filled in is not the same as true, and only one person can confirm that.
    add('identity', 'identity.truthful', 'OWNER', 'Is the published identity your real one?',
      'The fields are filled in. Whether the name and address are the ones a court and a '
      + 'consumer authority would accept is not something this can check.');
  }

  // ── 2. Registration and VAT ───────────────────────────────────────────────
  const registered = !!(LEGAL?.kvk);
  const hasVatNumber = !!(LEGAL?.vat);
  add('tax', 'tax.registration', 'OWNER', 'Are you registered, and do you have to be?',
    registered
      ? `KvK ${LEGAL.kvk} is published${hasVatNumber ? ` and VAT ${LEGAL.vat}` : ', but no VAT number is'}.`
      : 'No KvK number is set. Selling digital goods commercially in the Netherlands generally '
        + 'requires registration with the Kamer van Koophandel, and turnover above the KOR '
        + 'threshold requires a BTW number.',
    'Only you and the Belastingdienst can decide this. Do not open a commercial shop on the '
    + 'assumption that it does not apply.');

  /* The terms make a VAT claim in both languages. That claim has to be backed
     by something in the system, and right now it is backed by nothing at all:
     there is no rate, no breakdown on an order, and no VAT number on the
     invoice. This is the clearest example of the rule this file exists for —
     the page is written, and the page is not evidence. */
  /* Is the VAT sentence hard-coded, or does it follow the published VAT number?
     A flat "prices include VAT" in the document body is a claim the shop makes
     regardless of whether it is true. Gated on LEGAL.vat, it is made only when
     there is a number to back it. */
  const identitySrc = read('src/lib/legalIdentity.js') || '';
  const hardCodedClaim = /'[^']*inclusief btw[^']*'/.test(terms) || /'[^']*include VAT[^']*'/.test(terms);
  const gated = /vatStatement/.test(identitySrc) && /LEGAL\.vat\s*\?/.test(identitySrc);
  if (hardCodedClaim) {
    add('tax', 'tax.claim-unbacked', 'FAIL', 'The terms assert VAT unconditionally',
      'The document body states that prices include VAT regardless of whether a BTW number is '
      + 'published or any VAT is handled. If you are not VAT-registered that sentence is untrue, '
      + 'and it is untrue in the direction a consumer authority cares about.',
      'Make the sentence follow the published VAT status instead of being written into the text.');
  } else if (gated) {
    add('tax', 'tax.claim-gated', 'PASS', 'The VAT sentence follows the published VAT number',
      hasVatNumber
        ? `A BTW number is published, so the terms state that prices include VAT.`
        : 'No BTW number is published, so the terms make no VAT claim at all — they state only '
          + 'that nothing is added at checkout, which this system does enforce.');
  }

  /* Publishing a VAT number and charging VAT are different things, and the
     second one is not implemented anywhere. Only worth raising once there IS a
     number, because until then the shop is not claiming to charge it. */
  const ordersStoreVat = /vat_amount|vatAmount/.test(read('server/src/services/orderService.js') || '');
  if (hasVatNumber && !ordersStoreVat) {
    add('tax', 'tax.no-breakdown', 'FAIL', 'A VAT number is published but no VAT is recorded',
      'The terms now state that prices include VAT, and no order stores a VAT rate or amount. '
      + 'You cannot produce a VAT return from this data, and the invoice cannot show a breakdown '
      + 'it does not have.',
      'Record the rate and amount per order line, or remove the VAT number until you do.');
  }

  // ── 3. The invoice ────────────────────────────────────────────────────────
  //
  // A document headed "Invoice" is held to what an invoice must contain. This
  // one is generated for every order and downloadable from the account area.
  if (invoice) {
    const shows = {
      'the seller’s legal name': /LEGAL\.legalName/.test(invoice),
      'the seller’s address': /legalAddressLine/.test(invoice),
      'a KvK or VAT number': /LEGAL\.kvk/.test(invoice) && /LEGAL\.vat/.test(invoice),
      'a statement about VAT': /vatLine/.test(invoice),
    };
    const absent = Object.entries(shows).filter(([, ok]) => !ok).map(([k]) => k);
    if (absent.length) {
      add('tax', 'tax.invoice-incomplete', 'FAIL', 'The invoice is not one',
        `renderInvoice() produces a document titled "Invoice" that omits ${absent.join(', ')}.`,
        'Add the seller block — server/src/services/billingService.js.');
    } else {
      /* The fields are wired. Whether the document is a VALID invoice still
         depends on the identity being filled in, which is checked separately —
         and the document itself now says so on its face when it is not. */
      const saysWhenInvalid = /not a valid invoice/i.test(invoice);
      add('tax', 'tax.invoice-fields', 'PASS', 'The invoice names the seller',
        'Legal name, address and registration numbers are pulled from the seller identity, and '
        + 'unset fields are omitted rather than printed blank.');
      add('tax', 'tax.invoice-honest', saysWhenInvalid ? 'PASS' : 'WARN',
        'An incomplete invoice says so on its face',
        saysWhenInvalid
          ? 'With the identity unset the document states that it is not a valid invoice, rather '
            + 'than looking like one that is merely missing a line.'
          : 'The document does not flag its own incompleteness — a buyer would have to know what '
            + 'an invoice must contain to notice.');
    }
  }

  // ── 4. Contact ────────────────────────────────────────────────────────────
  const supportEmail = (support.match(/SUPPORT_EMAIL\s*=\s*'([^']+)'/) || [])[1] || '';
  if (!supportEmail) {
    add('contact', 'contact.none', 'FAIL', 'No contact address is published',
      'A trader must give an email address or an equally direct channel.');
  } else {
    const onOwnDomain = HOST() && supportEmail.endsWith(`@${HOST()}`);
    add('contact', 'contact.email', onOwnDomain ? 'PASS' : 'WARN',
      'A contact address is published',
      onOwnDomain
        ? `${supportEmail}, on the shop's own domain.`
        : `${supportEmail} is not on ${HOST() || 'the shop domain'} — buyers have no way to tell it is you.`);
    add('contact', 'contact.reachable', 'OWNER', `Does mail to ${supportEmail} actually reach you?`,
      'The address is advertised on every page and set as the Reply-To on every transactional '
      + 'email. If the forward is not set up it fails silently: buyers get no bounce and you get '
      + 'no message.',
      'Send yourself a test and confirm it arrives.');
  }

  // ── 5. Transactional email identity ───────────────────────────────────────
  const from = config.email.fromAddress || '';
  const mailerConfigured = !!(config.email.resendApiKey || config.email.smtpUrl);
  if (!mailerConfigured) {
    add('email', 'email.none', 'FAIL', 'Nothing can email the buyer',
      'No RESEND_API_KEY and no SMTP_URL. Order confirmations and delivery codes are written to '
      + 'email_log and never sent.');
  } else if (from === 'onboarding@resend.dev') {
    add('email', 'email.shared-sender', 'FAIL', 'Order email comes from a domain you do not own',
      'EMAIL_FROM_ADDRESS is still Resend\'s shared sender, which only delivers to the Resend '
      + 'account owner\'s own inbox. Customers receive nothing, and the sender does not identify '
      + 'the seller.',
      'Verify your domain with Resend and set EMAIL_FROM_ADDRESS to an address on it.');
  } else {
    const fromDomain = (from.split('@')[1] || '').toLowerCase();
    const matches = HOST() && (fromDomain === HOST() || fromDomain.endsWith(`.${HOST()}`));
    add('email', 'email.sender', matches ? 'PASS' : 'WARN', 'Transactional email sender',
      matches ? `${from} — on the shop's own domain.`
        : `${from} is not on ${HOST()}. Mail that claims to be from the shop but comes from `
          + 'elsewhere is what a spam filter is built to catch.');
  }
  add('email', 'email.replyto', config.email.replyTo ? 'PASS' : 'WARN', 'Reply-To is set',
    config.email.replyTo || 'Unset — a reply to an order email goes to the sending address.');

  // ── 6. Consent, verified as behaviour ─────────────────────────────────────
  //
  // A banner is not consent. Consent is: nothing non-essential written before
  // the answer, refusing as easy as accepting, and withdrawal removing what is
  // already there. All three are checkable in the source.
  if (!consent) {
    add('consent', 'consent.missing', 'FAIL', 'No consent module', 'src/lib/consent.js not found.');
  } else {
    const defaultsToNo = /if \(category === 'essential'\) return true;[\s\S]*?return !!c && c\[category\] === true;/.test(consent);
    const purges = /purgeRefused/.test(consent) && /removeItem/.test(consent);
    const bothStores = (consent.match(/removeItem/g) || []).length >= 2;
    add('consent', 'consent.default-deny', defaultsToNo ? 'PASS' : 'FAIL',
      'Unanswered means no',
      defaultsToNo ? 'Every non-essential category is false until the visitor says otherwise.'
        : 'The default is not a clear deny — an unanswered banner must not count as permission.');
    add('consent', 'consent.withdraw', purges && bothStores ? 'PASS' : 'WARN',
      'Withdrawing removes what was stored',
      purges && bothStores
        ? 'Refusing a category deletes its keys from local and session storage.'
        : 'Refusal appears to stop future writes without deleting what is already on the device.');
    /* "As easy to refuse as to accept" is not satisfied by a refusal existing —
       an Accept button next to a grey text link is the pattern regulators have
       repeatedly ruled against. What is checked is that both choices are one
       click AND that they are laid out as equals: the same width constraint and
       the same padding on both. A styling change that quietly demotes one of
       them is the thing that would otherwise go unnoticed. */
    const banner = read('src/components/CookieConsent.jsx') || '';
    const buttons = [...banner.matchAll(/<button[^>]*onClick=\{\(\) => decide\((true|false)\)\}[^>]*className="([^"]*)"/g)]
      .map((m) => ({ accepts: m[1] === 'true', cls: m[2] }));
    const accept = buttons.find((b) => b.accepts);
    const refuse = buttons.find((b) => !b.accepts);
    const sizing = (cls) => (cls.match(/(min-w-\[[^\]]+\]|py-[\d.]+|flex-1|text-sm)/g) || []).sort().join(' ');
    const equal = accept && refuse && sizing(accept.cls) === sizing(refuse.cls);
    add('consent', 'consent.refuse-is-equal', equal ? 'PASS' : 'WARN',
      'Refusing is as easy as accepting',
      equal
        ? 'Both choices are one click and share the same size and padding.'
        : accept && refuse
          ? `Both choices exist but are styled differently (${sizing(accept.cls)} vs `
            + `${sizing(refuse.cls)}) — a demoted refusal is not a free choice.`
          : 'Could not find a one-click refusal alongside the accept button.');
  }

  // ── 7. What the privacy policy claims about the deployment ────────────────
  //
  // The processor table names specific companies. Those are statements about
  // this deployment, and a deployment can drift away from them silently.
  const names = (re) => re.test(terms);
  if (names(/Resend/) && mailerConfigured && !config.email.resendApiKey) {
    add('privacy', 'privacy.mailer-drift', 'WARN', 'The policy names Resend, the deployment uses SMTP',
      'The privacy policy lists Resend as the processor sending your email. This deployment is '
      + 'configured with SMTP_URL instead, so the actual recipient of customer addresses is a '
      + 'different company from the one disclosed.',
      'Either use Resend or name the provider you do use.');
  }
  const dbHost = (() => {
    try { return new URL(config.databaseUrl || process.env.DATABASE_URL || '').hostname; } catch { return ''; }
  })();
  if (names(/Neon Inc/) && dbHost && !/neon\.tech|neon\.build/.test(dbHost) && !/localhost|127\.0\.0\.1/.test(dbHost)) {
    add('privacy', 'privacy.db-drift', 'WARN', 'The policy names Neon, the database is somewhere else',
      `The privacy policy lists Neon as the processor holding accounts and orders; DATABASE_URL `
      + `points at ${dbHost}.`,
      'Name the provider that actually holds the data.');
  }
  // Twilio receives phone numbers and is not in the table.
  if (config.sms?.accountSid && !names(/Twilio/i)) {
    add('privacy', 'privacy.twilio-undisclosed', 'FAIL', 'SMS login is on and Twilio is not disclosed',
      'Phone numbers are sent to Twilio (US) for login codes. The processor table in the privacy '
      + 'policy does not list them, so a customer cannot see who receives their number.',
      'Add Twilio to the processor table, or turn SMS login off.');
  } else if (!config.sms?.accountSid) {
    add('privacy', 'privacy.twilio-off', 'PASS', 'SMS login is off',
      'No phone numbers leave the system, and none needs disclosing.');
  }

  add('privacy', 'privacy.dpas', 'OWNER', 'Have you actually signed the processing agreements?',
    'The privacy policy states, in both languages, that a verwerkersovereenkomst is in place with '
    + 'every processor it lists. That is a claim about paperwork, not about code, and it is '
    + 'currently unverifiable from here.',
    'Accept the DPA in each provider\'s dashboard (Mollie, Vercel, Neon, Resend) and keep a copy. '
    + 'If any is not in place, that sentence has to change.');

  // ── 8. The documents themselves ───────────────────────────────────────────
  const docs = [
    ['terms', '/terms', /path: '\/terms'/],
    ['privacy', '/privacy', /path: '\/privacy'/],
    ['cookies', '/cookies', /path: '\/cookies'/],
  ];
  for (const [id, route, re] of docs) {
    add('docs', `docs.${id}`, re.test(terms) ? 'PASS' : 'FAIL', `${route} exists`,
      re.test(terms) ? 'Present in src/content/legal.js, in Dutch and English.' : 'Not found.');
  }
  /* Written and reachable is as far as this goes. Whether the content is
     correct for THIS business is a lawyer's question, and a green tick here
     would be the exact false comfort this file was written to avoid. */
  add('docs', 'docs.reviewed', 'OWNER', 'Has anyone qualified read these?',
    'The terms, privacy and cookie documents are detailed and internally consistent, and they '
    + 'were written for a shop of this shape. That is not the same as being right for your '
    + 'business, and nothing in this audit should be read as saying they are.');

  // ── 9. Payments ───────────────────────────────────────────────────────────
  if (config.payments.demoMode) {
    add('payments', 'payments.demo', 'FAIL', 'Demo payments are on',
      'Orders are marked paid without money arriving.', 'Set DEMO_PAYMENTS=false.');
  }
  if (mollieEnabled()) {
    const test = /^test_/.test(config.payments.mollie.apiKey || '');
    add('payments', 'payments.mollie', test ? 'FAIL' : 'PASS', 'Mollie',
      test ? 'MOLLIE_API_KEY is a test key — buyers reach the sandbox and no money moves.'
        : 'Live key configured.');
  } else if (manualPayMethods().length) {
    add('payments', 'payments.manual', 'WARN', 'Manual payment only',
      'Every payment is confirmed by hand. Legal, but each order waits for a person.');
  } else {
    add('payments', 'payments.none', 'FAIL', 'No way to pay', 'Orders dead-end as pending.');
  }
  add('payments', 'payments.terms-match', 'OWNER', 'Does your Mollie account allow what you sell?',
    'Payment providers restrict digital goods and top-ups, and an account closed mid-launch takes '
    + 'the shop with it.', 'Confirm your product categories with Mollie in writing before opening.');

  const level = (l) => out.filter((c) => c.level === l).length;
  return {
    checks: out,
    summary: { fail: level('FAIL'), warn: level('WARN'), owner: level('OWNER'), pass: level('PASS') },
    /* Deliberately not "compliant". This says the automated checks found nothing
       left to flag, which is a much smaller claim and the only one available. */
    automatedChecksClear: level('FAIL') === 0,
  };
}

export const COMPLIANCE_AREAS = {
  identity: 'Seller identity',
  tax: 'VAT and invoicing',
  contact: 'Contact',
  email: 'Transactional email',
  consent: 'Cookie consent',
  privacy: 'Privacy disclosures',
  docs: 'Legal documents',
  payments: 'Payments',
};
