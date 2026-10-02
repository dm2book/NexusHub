/**
 * The login SMS.
 *
 * It was one English sentence to everybody — "Your ForgeMarket code is …" to
 * a Dutch shop's Dutch buyers — and phones could not fill it in by themselves.
 * Now:
 *
 *   in the reader's language: the page's, else their account's, else the one
 *   their number's country speaks;
 *   ending in the origin-bound line "@www.forgemarket.nl #123456", which iPhone
 *   and Android use to offer the code — on forgemarket.nl and nowhere else;
 *   one SMS, not two: 160 characters or fewer, all of them in the GSM-7 set (a
 *   single emoji or curly quote turns the whole message into UCS-2, where a
 *   segment holds only 70 characters and the shop pays twice per code).
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const sms = await import('../src/services/smsService.js');
const { requestPhoneOtp } = await import('../src/services/authService.js');
const fs = await import('node:fs');

/* GSM 03.38 basic set (plus the newline). Anything else forces UCS-2. */
const GSM7 = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;

console.log('\n— The text —');
{
  const H = 'www.forgemarket.nl';
  const t = (lang) => sms.otpSmsText('482913', { lang, host: H, ttl: 10, brand: 'ForgeMarket' });
  ok('Dutch', /^Je ForgeMarket-code is 482913\. Geldig 10 min\./.test(t('nl')), t('nl'));
  ok('English', /^Your ForgeMarket code is 482913\./.test(t('en')));
  ok('German', /^Dein ForgeMarket-Code ist 482913\./.test(t('de')));
  ok('French', /^Votre code ForgeMarket est 482913\./.test(t('fr')));
  ok('an unknown language falls back to English', t('xx') === t('en'));
  for (const l of ['nl', 'en', 'de', 'fr']) {
    const s = t(l);
    ok(`${l}: ends with the origin-bound line, on its own line`, s.endsWith(`\n\n@${H} #482913`) && s.split('\n').pop() === `@${H} #482913`);
    ok(`${l}: one SMS — ${s.length} of 160 characters, all GSM-7`, s.length <= 160 && GSM7.test(s),
      [...s].filter((c) => !GSM7.test(c)).join(''));
    ok(`${l}: tells the reader the shop never asks for it`, /nooit|never|nie|jamais/.test(s));
  }
  ok('the host comes from the shop\'s own address when not given', sms.otpSmsText('1', { lang: 'en' }).includes('\n\n@'));
}

console.log('\n— Which language —');
{
  ok('+31 reads Dutch', sms.langForPhone('+31612345678') === 'nl');
  ok('+32 (Flanders) Dutch too', sms.langForPhone('+32470123456') === 'nl');
  ok('+49 German', sms.langForPhone('+4915112345678') === 'de');
  ok('+33 French', sms.langForPhone('+33612345678') === 'fr');
  ok('anything else English', sms.langForPhone('+447700900123') === 'en');
  ok('0031 is +31', sms.langForPhone('0031612345678') === 'nl');

  /* Through the real request path (development prints the SMS instead of sending it). */
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); };
  try {
    await requestPhoneOtp('+31611111111', { ip: '10.0.0.1' });
    await requestPhoneOtp('+31622222222', { ip: '10.0.0.2', lang: 'en' });
    const uid = newId('usr');
    await run(`INSERT INTO users (id, email, phone, phone_verified, lang, display_name, created_at, updated_at)
               VALUES (@id, @e, '+31633333333', 1, 'de', 'B', @at, @at)`, { id: uid, e: `${uid}@x.dev`, at: nowIso() });
    await requestPhoneOtp('+31633333333', { ip: '10.0.0.3' });
  } finally { console.log = log; }
  const out = said.filter((s) => /\[dev\] SMS to/.test(s));
  ok('a Dutch number with nothing else known gets Dutch', /\+31611111111:\s+Je ForgeMarket-code is \d{6}/.test(out[0] || ''), out[0]);
  ok('…the page\'s language wins over the number', /\+31622222222:\s+Your ForgeMarket code is/.test(out[1] || ''), out[1]);
  ok('…and the account\'s language over the number', /\+31633333333:\s+Dein ForgeMarket-Code/.test(out[2] || ''), out[2]);
  ok('every one sent ends with its own code on the origin-bound line', out.length === 3 && out.every((s) => {
    const code = (s.match(/(\d{6})\./) || [])[1];
    return code && s.trim().endsWith(`#${code}`);
  }));
}

console.log('\n— The login page reads it —');
{
  const login = fs.readFileSync(new URL('../../src/pages/Login.jsx', import.meta.url), 'utf8');
  ok('Android: WebOTP asks for the SMS code on the SMS step', /navigator\.credentials\.get\(\{ otp: \{ transport: \['sms'\] \}/.test(login)
    && /sms=\{channel === 'sms'\}/.test(login));
  ok('…and stops asking when the step goes away', /return \(\) => ac\.abort\(\)/.test(login));
  ok('iPhone: the inputs are marked one-time-code', /autoComplete="one-time-code"/.test(login));
  ok('the account page passes its language too', /requestPhoneOtp\(p, \{[^}]*lang \}\)/.test(
    fs.readFileSync(new URL('../src/routes/account.js', import.meta.url), 'utf8')));
}

console.log(`\n${fail ? '❌' : '✅'} sms-otp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
