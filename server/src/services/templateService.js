/**
 * Branded email layout + token rendering.
 *
 * Templates store only the inner content; we wrap it in a consistent,
 * email-client-safe HTML shell using the configured brand colours/logo so the
 * sender always looks on-brand. Admin edits to subject/body are honoured.
 *
 * Layout notes: table-based structure + widely-supported CSS only (no flex/grid),
 * so it renders correctly in Gmail, Outlook, Apple Mail and mobile clients.
 */
import { config } from '../config/env.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Replace {{a.b}} tokens from a flat/nested context. Unknown tokens → ''.
 *  Values are HTML-escaped UNLESS the token name ends in `Html` (itemsHtml,
 *  deliveriesHtml, …) — those are built server-side with their own escaping.
 *  Without this, customer-controlled fields (e.g. billing.full_name → user.name)
 *  would inject raw HTML into branded emails sent from our verified domain,
 *  turning checkout into a phishing relay to any address. */
export function renderTokens(str, ctx, { where = 'template' } = {}) {
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, pathExpr) => {
    const val = pathExpr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    if (val == null) {
      /* An empty string is still the right OUTPUT — half a subject line beats a
         raw {{token}} in someone's inbox — but it must not be silent. A caller
         that forgets a field ships mail like " is your ForgeMarket login code",
         and nothing anywhere notices; this is the only place that can see it. */
      console.warn(`[email] ${where}: {{${pathExpr}}} had no value — rendered as empty`);
      return '';
    }
    return /Html$/.test(pathExpr.split('.').pop()) ? String(val) : esc(String(val));
  });
}

/**
 * Per-email identity.
 *
 * Every mail used to carry the same purple header and the same three pills
 * ("Instant delivery · Buyer protected · 24/7 support"), so a login code, a
 * refund and a delivery were indistinguishable in an inbox — and two of those
 * pills were claims the storefront no longer makes.
 *
 * Each template now gets an accent, an eyebrow line that says what the mail IS,
 * and a footer strip that only makes promises that hold for THAT mail. `pills`
 * of [] renders no strip at all — a security code is not a place for marketing.
 */
export const EMAIL_THEMES = {
  account_created: { accent: '#7c5cff', accent2: '#a855f7',
    eyebrow: { nl: 'Account aangemaakt', en: 'Account created', de: 'Konto erstellt', fr: 'Compte créé' },
    pills: [
      { nl: '🔐 Geen wachtwoord om te onthouden', en: '🔐 No password to remember', de: '🔐 Kein Passwort zu merken', fr: '🔐 Aucun mot de passe à retenir' },
      { nl: '💬 Hulp via Discord', en: '💬 Help on Discord', de: '💬 Hilfe über Discord', fr: '💬 De l’aide sur Discord' },
    ] },
  order_received: { accent: '#f5b324', accent2: '#fb923c',
    eyebrow: { nl: 'Bestelling ontvangen', en: 'Order received', de: 'Bestellung eingegangen', fr: 'Commande reçue' },
    pills: [
      { nl: '🧾 Kenmerk = je bestelnummer', en: '🧾 Reference = your order number', de: '🧾 Verwendungszweck = deine Bestellnummer', fr: '🧾 Référence = ton numéro de commande' },
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
    ] },
  payment_reminder: { accent: '#f5b324', accent2: '#f97316',
    eyebrow: { nl: 'Wacht op betaling', en: 'Awaiting payment', de: 'Wartet auf Zahlung', fr: 'En attente de paiement' },
    pills: [
      { nl: '⏳ Nog voor je gereserveerd', en: '⏳ Still held for you', de: '⏳ Noch für dich reserviert', fr: '⏳ Toujours réservé pour toi' },
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
    ] },
  payment_confirmed: { accent: '#34d399', accent2: '#10b981',
    eyebrow: { nl: 'Betaling bevestigd', en: 'Payment confirmed', de: 'Zahlung bestätigt', fr: 'Paiement confirmé' },
    pills: [
      { nl: '✅ Betaling ontvangen', en: '✅ Payment received', de: '✅ Zahlung eingegangen', fr: '✅ Paiement reçu' },
      { nl: '📦 We maken je bestelling klaar', en: '📦 We are preparing your order', de: '📦 Wir machen deine Bestellung fertig', fr: '📦 Nous préparons ta commande' },
    ] },
  order_processing: { accent: '#38bdf8', accent2: '#6366f1',
    eyebrow: { nl: 'Bestelling in behandeling', en: 'Order in progress', de: 'Bestellung in Arbeit', fr: 'Commande en cours' },
    pills: [
      { nl: '📦 Wordt klaargemaakt', en: '📦 Being prepared', de: '📦 Wird vorbereitet', fr: '📦 En préparation' },
      { nl: '💬 Hulp via Discord', en: '💬 Help on Discord', de: '💬 Hilfe über Discord', fr: '💬 De l’aide sur Discord' },
    ] },
  order_completed: { accent: '#34d399', accent2: '#10b981',
    eyebrow: { nl: 'Geleverd', en: 'Delivered', de: 'Geliefert', fr: 'Livrée' },
    pills: [
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
      { nl: '💬 Klopt er iets niet? Antwoord even', en: '💬 Something off? Just reply', de: '💬 Stimmt etwas nicht? Antworte einfach', fr: '💬 Un souci ? Réponds simplement' },
    ] },
  refund_issued: { accent: '#a855f7', accent2: '#d946ef',
    eyebrow: { nl: 'Terugbetaald', en: 'Refunded', de: 'Zurückerstattet', fr: 'Remboursée' },
    pills: [
      { nl: '↩️ Je geld is onderweg', en: '↩️ Your money is on its way', de: '↩️ Dein Geld ist unterwegs', fr: '↩️ Ton argent est en route' },
    ] },
  custom_message: { accent: '#7c5cff', accent2: '#a855f7',
    eyebrow: { nl: 'Bericht van support', en: 'Message from support', de: 'Nachricht vom Support', fr: 'Message du support' },
    pills: [
      { nl: '💬 Antwoord gewoon — er zit een mens achter', en: '💬 Just reply — a person reads this', de: '💬 Antworte einfach — hier sitzt ein Mensch', fr: '💬 Réponds simplement — une personne te lit' },
    ] },
  support_reply: { accent: '#7c5cff', accent2: '#a855f7',
    eyebrow: { nl: 'Antwoord op je ticket', en: 'Reply to your ticket', de: 'Antwort auf dein Ticket', fr: 'Réponse à ton ticket' },
    pills: [
      { nl: '💬 Antwoord gewoon — er zit een mens achter', en: '💬 Just reply — a person reads this', de: '💬 Antworte einfach — hier sitzt ein Mensch', fr: '💬 Réponds simplement — une personne te lit' },
    ] },
  cart_reminder: { accent: '#7c5cff', accent2: '#d946ef',
    eyebrow: { nl: 'Staat nog in je winkelwagen', en: 'Still in your basket', de: 'Liegt noch in deinem Warenkorb', fr: 'Toujours dans ton panier' },
    pills: [
      { nl: '🛒 Geen account nodig', en: '🛒 No account needed', de: '🛒 Kein Konto nötig', fr: '🛒 Pas besoin de compte' },
      { nl: '💸 Geen verborgen kosten', en: '💸 No hidden fees', de: '💸 Keine versteckten Kosten', fr: '💸 Aucun frais caché' },
    ] },
  review_request: { accent: '#f59e0b', accent2: '#f97316',
    eyebrow: { nl: 'Hoe deden we het?', en: 'How did we do?', de: 'Wie haben wir das gemacht?', fr: 'Comment avons-nous fait ?' },
    pills: [
      { nl: '⭐ Kost 20 seconden', en: '⭐ Takes 20 seconds', de: '⭐ Dauert 20 Sekunden', fr: '⭐ 20 secondes suffisent' },
    ] },
  gift_card: { accent: '#d946ef', accent2: '#a855f7',
    eyebrow: { nl: 'Cadeaubon', en: 'Gift card', de: 'Geschenkkarte', fr: 'Carte cadeau' },
    pills: [
      { nl: '🎁 Vervalt niet zolang hij niet gebruikt is', en: '🎁 Does not expire while unused', de: '🎁 Verfällt nicht, solange sie ungenutzt ist', fr: '🎁 N’expire pas tant qu’elle n’est pas utilisée' },
    ] },
  launch_announcement: { accent: '#22d3ee', accent2: '#6366f1',
    eyebrow: { nl: 'We zijn open', en: 'We are open', de: 'Wir haben geöffnet', fr: 'Nous sommes ouverts' },
    /* Only what is true on day one. The shop has no reviews and no sales
       history to boast about, and a launch mail that overclaims is the first
       thing a new buyer has to weigh against. */
    pills: [
      { nl: '🚀 De winkel is open', en: '🚀 The shop is open', de: '🚀 Der Shop ist offen', fr: '🚀 La boutique est ouverte' },
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
    ] },
  // Security mail: no marketing, no distractions, nothing to click by mistake.
  login_otp: { accent: '#64748b', accent2: '#475569',
    eyebrow: { nl: 'Beveiligingscode', en: 'Security code', de: 'Sicherheitscode', fr: 'Code de sécurité' },
    pills: [] },
};

/**
 * The frame's own words — everything outside the template body.
 *
 * These were hardcoded Dutch while the bodies had been translated into four
 * languages, so a German delivery mail arrived with GELEVERD printed across its
 * header, two Dutch promises under the letter and a Dutch footer: three Dutch
 * fragments wrapped around a German letter, from a shop the buyer had never
 * bought from. That is not a rough edge, it is the thing that makes a real
 * email look like a forged one.
 */
const FRAME = {
  why: {
    nl: 'Je krijgt deze mail omdat je een {brand}-account hebt of een bestelling hebt geplaatst.',
    en: 'You are receiving this because you have a {brand} account or placed an order.',
    de: 'Du bekommst diese Mail, weil du ein {brand}-Konto hast oder eine Bestellung aufgegeben hast.',
    fr: 'Tu reçois cet e-mail parce que tu as un compte {brand} ou que tu as passé une commande.',
  },
  track: { nl: 'Bestelling volgen', en: 'Track order', de: 'Bestellung verfolgen', fr: 'Suivre ma commande' },
  help: { nl: 'Hulp via Discord', en: 'Help on Discord', de: 'Hilfe über Discord', fr: 'De l’aide sur Discord' },
  settings: { nl: 'E-mailinstellingen', en: 'Email settings', de: 'E-Mail-Einstellungen', fr: 'Préférences e-mail' },
  tagline: {
    nl: 'Digitale producten voor gamers', en: 'Digital goods for gamers',
    de: 'Digitale Produkte für Gamer', fr: 'Produits numériques pour joueurs',
  },
};

/** One language out of a table, never `undefined` in someone's inbox. */
const pick = (table, lang) => (typeof table === 'string' ? table : (table?.[lang] ?? table?.nl ?? table?.en ?? ''));

const DEFAULT_THEME = { accent: null, eyebrow: FRAME.tagline, pills: [] };

/** Wrap rendered content in the premium branded layout. */
export function wrapBranded(contentHtml, { preheader = '', theme = DEFAULT_THEME, lang = 'nl' } = {}) {
  const brand = config.email.fromName;
  // The accent tints the header, the button and the rules — so the mail's
  // purpose is readable before a single word is.
  const color = theme.accent || config.email.brandColor;
  const color2 = theme.accent2 || '#a855f7';
  const pills = (theme.pills || []).map((t) => pick(t, lang)).filter(Boolean);
  const eyebrow = pick(theme.eyebrow || DEFAULT_THEME.eyebrow, lang);
  const F = (key) => pick(FRAME[key], lang);
  const year = new Date().getFullYear();
  const logo = config.email.logoUrl
    ? `<img src="${config.email.logoUrl}" alt="${brand}" height="34" style="display:block;border:0" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
         <td style="background:rgba(255,255,255,.18);border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;font:800 18px/36px Arial,sans-serif;color:#fff">⚡</td>
         <td style="padding-left:10px;font:800 21px/1 Arial,sans-serif;color:#fff;letter-spacing:-.3px">${brand}</td>
       </tr></table>`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>
  body{margin:0;padding:0;background:#08080f;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#e5e7eb;-webkit-text-size-adjust:100%}
  .wrap{max-width:568px;margin:0 auto;padding:32px 16px}
  .card{background:#12121c;border:1px solid #26263a;border-radius:22px;overflow:hidden}
  .head{background:linear-gradient(120deg,${color} 0%,${color2} 100%);padding:28px 30px 24px;
        background-image:radial-gradient(circle at 85% 15%,rgba(255,255,255,.26),transparent 48%),
                         linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),
                         linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px),
                         linear-gradient(120deg,${color} 0%,${color2} 100%);
        background-size:auto,34px 34px,34px 34px,auto}
  /* The eyebrow sat loose under the wordmark and read as a second, smaller
     logo. In its own tinted chip it reads as what it is: a label saying which
     of the thirteen mails this one is, before a single word of the letter. */
  .head-sub{display:inline-block;font:700 10.5px/1 Arial,sans-serif;color:#fff;margin-top:14px;
            letter-spacing:1.7px;text-transform:uppercase;background:rgba(0,0,0,.22);
            border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:7px 13px}

  .body{padding:34px 30px 12px}
  h1{font-size:23px;line-height:1.3;color:#ffffff;margin:0 0 14px;font-weight:800;letter-spacing:-.3px}
  p{font-size:14.5px;line-height:1.7;color:#b9bfcd;margin:0 0 15px}
  .badge{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,${color},${color2});
         text-align:center;font-size:30px;line-height:64px;margin:2px auto 18px;
         box-shadow:0 10px 26px rgba(0,0,0,.5)}
  .pill-note{display:inline-block;font:700 12px/1 Arial,sans-serif;color:#c7d2fe;background:#1b1b30;
             border:1px solid #34345c;border-radius:999px;padding:9px 16px;letter-spacing:.4px}
  strong{color:#fff}
  a{color:#a78bfa}
  /* One action colour across every mail, deliberately NOT the accent.
     Half the templates draw their button as an inline-styled table (the shape
     Outlook renders reliably) hardcoded to the brand purple, and half use this
     class, which followed the accent — so a delivery mail had a green header
     and a purple button while a refund had purple and purple, and the two
     disagreed for no reason a reader could work out. The accent answers "which
     mail is this"; the button answers "what do I press". Those are different
     questions and they now have different, consistent answers. */
  a.btn{display:inline-block;background:#7c5cff;
        background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%);
        color:#ffffff !important;text-decoration:none;
        padding:15px 30px;border-radius:12px;font-weight:700;font-size:15.5px;margin:8px 0 20px;
        box-shadow:0 8px 22px rgba(124,92,255,.28)}
  .code{font:800 30px/1 'Courier New',monospace;letter-spacing:8px;color:#ffffff;
        background:linear-gradient(180deg,#1c1c2c,#17172a);border:1px solid #34345a;border-radius:14px;
        padding:20px;text-align:center;margin:4px 0 16px}
  .notice{background:#181826;border:1px solid #2c2c48;border-left:3px solid ${color};border-radius:0 12px 12px 0;
          padding:13px 16px;margin:6px 0 18px;color:#a8b0c2;font-size:13px;line-height:1.6}
  .notice strong{color:#e5e7eb}
  .quote{border-left:3px solid ${color};background:#1a1a2c;border-radius:0 12px 12px 0;
         padding:14px 18px;margin:0 0 18px;color:#cbd1de;font-size:14px;line-height:1.6}
  .summary{width:100%;border-collapse:collapse;margin:2px 0 20px;font-size:14px}
  .summary td{padding:10px 0;border-bottom:1px solid #24243a;color:#cbd1de}
  .summary .r{text-align:right;color:#fff;white-space:nowrap;font-weight:600}
  .summary .tot td{border-top:2px solid #34345a;border-bottom:0;font-weight:800;color:#fff;padding-top:14px;font-size:15px}
  .pill-row{padding:0 0 18px}
  .pill{display:inline-block;font:600 11px/1 Arial,sans-serif;color:#9aa3b8;background:#1a1a2c;
        border:1px solid #262640;border-radius:999px;padding:7px 12px;margin:0 6px 6px 0}
  .divider{height:1px;background:#22223a;margin:6px 0 20px}
  /* The footer was one grey paragraph in which the three links a reader might
     actually want were the least prominent thing. Now they lead, in a chip
     row, and the housekeeping sits under them at the size housekeeping
     deserves. */
  .foot{padding:18px 30px 28px;color:#5b6577;font-size:12px;line-height:1.6;text-align:center}
  .foot-links a{display:inline-block;color:#c3b5ff;text-decoration:none;font-weight:600;font-size:12.5px;padding:2px 0}
  .foot .dot{color:#2f3448;padding:0 9px}
  .foot-why{padding-top:14px;color:#5b6577;font-size:11.5px;line-height:1.6}
  .foot-legal{padding-top:10px;color:#4b5466;font-size:11.5px}
  .foot-legal a{color:#68718a;text-decoration:none}
  .preheader{display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all}
</style></head>
<body>
<span class="preheader">${preheader}</span>
<div class="wrap">
  <div class="card">
    <div class="head">${logo}
      <div class="head-sub">${esc(eyebrow)}</div>
    </div>
    <div class="body">${contentHtml}</div>
    ${pills.length ? `<div style="padding:0 30px">
      <div class="pill-row">${pills.map((p) => `<span class="pill">${esc(p)}</span>`).join('')}</div>
      <div class="divider"></div>
    </div>` : `<div style="padding:0 30px"><div class="divider"></div></div>`}
    <div class="foot">
      <div class="foot-links">
        <a href="${config.appUrl}/track">${esc(F('track'))}</a><span class="dot">·</span><a href="${config.appUrl}/discord">${esc(F('help'))}</a><span class="dot">·</span><a href="${config.appUrl}/account/settings">${esc(F('settings'))}</a>
      </div>
      <div class="foot-why">${esc(F('why').replace('{brand}', brand))}</div>
      <div class="foot-legal">© ${year} ${brand} — <a href="${config.appUrl}">${config.appUrl.replace(/^https?:\/\//, '')}</a></div>
    </div>
  </div>
</div>
</body></html>`;
}

/** Build a default context shared by all emails. */
export function baseContext(extra = {}) {
  return {
    brand: { name: config.email.fromName },
    app: { url: config.appUrl },
    ...extra,
  };
}

/** Render a stored template row → { subject, html }. */
export function renderTemplate(template, ctx) {
  const subject = renderTokens(template.subject, ctx, { where: `${template.id} subject` });
  const inner = renderTokens(template.body_html, ctx, { where: `${template.id} body` });
  // First line of text content doubles as the hidden inbox preview (preheader).
  const preheader = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  const theme = EMAIL_THEMES[template.id] || DEFAULT_THEME;
  /* The row already knows: loadTemplate picked it by language. Passing it on is
     what stops a German letter arriving inside a Dutch frame. */
  return { subject, html: wrapBranded(inner, { preheader, theme, lang: template.lang || 'nl' }) };
}
