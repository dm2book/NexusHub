/**
 * Mobile conversion rules, enforced against the shipped source.
 *
 * Every rule here was measured at 390×844 in a real browser first, and each one
 * had a real failure behind it:
 *   - the nav icon buttons were set to 40px but RENDERED at 20-27px, because the
 *     header row is over-full at 390px and they had no shrink-0 to hold their
 *     width. A CSS class alone does not prove a tap target.
 *   - the checkout captions were <label> elements with no htmlFor, so tapping
 *     the caption — a much bigger target than the field edge on a phone — did
 *     nothing.
 *   - /shop rendered the entire catalogue: 15,455px tall, 65 images fetched
 *     before the buyer scrolled once.
 *
 * These are source-level checks. They cannot re-measure the browser, so they
 * pin the *causes* that measurement traced back to.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

console.log('— Thumb targets survive a narrow header —');
{
  // Both headers: the storefront nav and the homepage's own copy of it.
  for (const [label, file] of [
    ['StoreNav', 'src/components/store/StoreNav.jsx'],
    ['HomeStore header', 'src/pages/HomeStore.jsx'],
  ]) {
    const src = read(file);
    // Every icon button in a header flex row must be w-11 (44px) AND shrink-0.
    // Without shrink-0 the browser compresses them; without w-11 they are under
    // the 44px guideline even uncompressed.
    const iconButtons = [...src.matchAll(/className="[^"]*\b(w-\d+) h-\d+([^"]*)"/g)]
      .filter((m) => /place-items-center/.test(m[0]) && /hover:bg-slate-100/.test(m[0]));
    ok(`${label}: icon buttons found`, iconButtons.length >= 2, String(iconButtons.length));
    const bad = iconButtons.filter((m) => m[1] !== 'w-11' || !/shrink-0/.test(m[0]));
    ok(`${label}: every icon button is 44px and cannot be squeezed`, bad.length === 0,
      bad.map((m) => m[0].slice(0, 70)).join(' | '));
  }
}

console.log('\n— A caption you can tap —');
{
  const checkout = read('src/pages/Checkout.jsx');
  // Every <label className="label"> either points at a field or is not a label.
  const labels = [...checkout.matchAll(/<label className="label"([^>]*)>/g)];
  const orphans = labels.filter((m) => !/htmlFor=/.test(m[1]));
  ok('no checkout caption is a <label> pointing at nothing', orphans.length === 0,
    `${orphans.length} without htmlFor`);
  for (const id of ['co-email', 'co-name', 'co-city']) {
    ok(`${id} caption and field are tied together`,
      checkout.includes(`htmlFor="${id}"`) && checkout.includes(`id="${id}"`));
  }
  const login = read('src/pages/Login.jsx');
  ok('the login field is tied to its caption',
    /htmlFor="login-id"/.test(login) && /id="login-id"/.test(login));
}

console.log('\n— The right keyboard, and no retyping —');
{
  const checkout = read('src/pages/Checkout.jsx');
  ok('email asks for the email keyboard', /type="email"[\s\S]{0,200}inputMode="email"/.test(checkout));
  // Autofill is the single biggest saving on a phone form.
  for (const [field, token] of [['email', 'autoComplete="email"'], ['name', 'autoComplete="name"'],
                                ['city', 'autoComplete="address-level2"']]) {
    ok(`${field} can be autofilled`, checkout.includes(token));
  }
  const track = read('src/pages/Track.jsx');
  // Order numbers are FM-2026-XXXXXXXX: caps, no autocorrect, Enter means "go".
  ok('the order-number field starts in caps', /autoCapitalize="characters"/.test(track));
  ok('its Enter key says go', /enterKeyHint="go"/.test(track));
  ok('it is not autocorrected into something else', /autoCorrect="off"/.test(track));

  const login = read('src/pages/Login.jsx');
  // iOS and Android fill a one-time code straight from the notification.
  ok('the login code field accepts an SMS/email autofill',
    /autoComplete="one-time-code"/.test(login) && /inputMode="numeric"/.test(login));
}

console.log('\n— Every control has a name —');
{
  const shop = read('src/pages/Shop.jsx');
  ok('the shop search input is named', /aria-label=\{t\('shop\.search'/.test(shop));
  ok('the sort dropdown is named', /aria-label=\{t\('shop\.sortBy'/.test(shop));
  const nav = read('src/components/store/StoreNav.jsx');
  ok('the cart link is named', /aria-label=\{t\('nav\.cart'/.test(nav));
  ok('the menu button is named', /aria-label=\{t\('nav\.menu'/.test(nav));
  const checkout = read('src/pages/Checkout.jsx');
  ok('the coupon field is named', /aria-label=\{t\('checkout\.couponPh'/.test(checkout));
  // The delivery choice is two buttons, so it needs a group role, not a <label>.
  ok('the delivery choice announces itself as a group',
    /role="radiogroup"/.test(checkout) && /aria-labelledby="co-delivery-label"/.test(checkout));
  ok('each delivery option reports whether it is chosen',
    (checkout.match(/role="radio" aria-checked=/g) || []).length === 2);
}

console.log('\n— A phone does not download the whole catalogue —');
{
  const shop = read('src/pages/Shop.jsx');
  ok('the grid renders a window, not everything', /visible\.slice\(0, shown\)/.test(shop));
  ok('the rest is one tap away', /shop\.loadMore/.test(shop));
  ok('the window resets when the filter changes',
    /useEffect\(\(\) => \{ setShown\(PAGE\); \}, \[category, sort, search\]\)/.test(shop));

  /* The card no longer renders an <img> itself — ProductMedia does, once, for
     every surface. And "lazy on everything" turned out to be the wrong rule: it
     applied to the first row too, so the images a visitor is actually looking at
     were the ones the browser deferred. The property that matters on a phone is
     that the LONG TAIL defers, which is what this checks now. */
  const media = read('src/components/store/ProductMedia.jsx');
  ok('images below the fold still defer', /loading=\{priority \? 'eager' : 'lazy'\}/.test(media),
    'a 74-product grid must not fetch 74 pictures');
  ok('…and only the first screenful is eager',
    /priority=\{i < 8\}/.test(shop) && /priority=\{i < 4\}/.test(shop),
    'eager everywhere is the same as lazy nowhere');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
