/**
 * The four UGC beats — hook, problem, solution, call to action — for the Ad
 * Studio engine.
 *
 * The look is the one big marketplaces run on TikTok and Reels: the spoken
 * line in TikTok's own white caption boxes, filling in word by word as it is
 * said; under it, the thing the line is about, drawn as UI — the fake
 * "generator" asking for a password, a stack of small top-ups, the checkout
 * field that only wants a username, product tiles with the real price, the
 * refund line with a marker through it; and an end card with the product.
 *
 * Drawn with the engine's own helpers, handed in by `makeUgcScenes(h)`, so
 * this file and engine.js do not import each other.
 */

export const UGC_TYPES = ['ugc-hook', 'ugc-problem', 'ugc-solution', 'ugc-cta'];

/* What the ear hears, relative to the cut. */
export const UGC_CUES = {
  'ugc-hook': [['impact', 0.0]],
  'ugc-problem': [['drop', 0.08], ['type', 0.45], ['type', 0.95], ['buzz', 1.6]],
  'ugc-solution': [['pop', 0.1], ['type', 0.5], ['check', 1.3], ['shine', 1.5]],
  'ugc-cta': [['impact', 0.05], ['pop', 0.35], ['ding', 0.8], ['shine', 1.2]],
};

export function makeUgcScenes(h) {
  const { cl, eo, eio, back, at, fit, fontOf, roundRect, sweep, hero, Y, VOICE_AT, readableOn } = h;
  const INK = '#0b0a12';

  /* Every word drawn inside a picture, per language. */
  const UI = {
    nl: { user: 'Gebruikersnaam', pass: 'Wachtwoord', fake: 'NEP', no: 'NEE', signup: 'Account aanmaken',
      fields: ['E-mail', 'Wachtwoord', 'Herhaal wachtwoord', 'Geboortedatum'], news: '☑  Ja, stuur mij de nieuwsbrief',
      myOrder: 'Mijn bestelling', paid: 'Betaald', andNow: 'En nu…?', yours: 'Jouw account', notYours: 'Niet jouw account',
      checkout: 'Afrekenen', notNeeded: 'Niet nodig', pay: 'Betalen', per: 'per 1.000', PER: 'PER 1.000',
      yourCode: 'Je code', redeem: 'Zelf inwisselen, wanneer jij wilt', login: 'Inloggen', guest: 'Afrekenen als gast',
      policy: 'Terugbetaalbeleid', refund: 'Niet geleverd? Geld terug.', track: 'Bestelling volgen', orderNo: 'Bestelnummer',
      steps: ['Besteld', 'Betaald', 'Onderweg'], ask: 'Hoe werkt de levering?' },
    en: { user: 'Username', pass: 'Password', fake: 'FAKE', no: 'NOPE', signup: 'Create account',
      fields: ['Email', 'Password', 'Repeat password', 'Date of birth'], news: '☑  Yes, send me the newsletter',
      myOrder: 'My order', paid: 'Paid', andNow: 'And now…?', yours: 'Your account', notYours: 'Not your account',
      checkout: 'Checkout', notNeeded: 'Not needed', pay: 'Pay', per: 'per 1,000', PER: 'PER 1,000',
      yourCode: 'Your code', redeem: 'Redeem it yourself, whenever you like', login: 'Log in', guest: 'Check out as guest',
      policy: 'Refund policy', refund: 'Not delivered? Money back.', track: 'Track order', orderNo: 'Order number',
      steps: ['Ordered', 'Paid', 'On its way'], ask: 'How does delivery work?' },
    de: { user: 'Benutzername', pass: 'Passwort', fake: 'FAKE', no: 'NEIN', signup: 'Konto erstellen',
      fields: ['E-Mail', 'Passwort', 'Passwort wiederholen', 'Geburtsdatum'], news: '☑  Ja, schickt mir den Newsletter',
      myOrder: 'Meine Bestellung', paid: 'Bezahlt', andNow: 'Und jetzt…?', yours: 'Dein Account', notYours: 'Nicht dein Account',
      checkout: 'Kasse', notNeeded: 'Nicht nötig', pay: 'Bezahlen', per: 'pro 1.000', PER: 'PRO 1.000',
      yourCode: 'Dein Code', redeem: 'Selbst einlösen, wann du willst', login: 'Einloggen', guest: 'Als Gast bezahlen',
      policy: 'Rückerstattung', refund: 'Nicht geliefert? Geld zurück.', track: 'Bestellung verfolgen', orderNo: 'Bestellnummer',
      steps: ['Bestellt', 'Bezahlt', 'Unterwegs'], ask: 'Wie läuft die Lieferung?' },
    fr: { user: 'Pseudo', pass: 'Mot de passe', fake: 'ARNAQUE', no: 'NON', signup: 'Créer un compte',
      fields: ['E-mail', 'Mot de passe', 'Répéter le mot de passe', 'Date de naissance'], news: '☑  Oui, envoyez-moi la newsletter',
      myOrder: 'Ma commande', paid: 'Payé', andNow: 'Et maintenant… ?', yours: 'Ton compte', notYours: 'Pas ton compte',
      checkout: 'Paiement', notNeeded: 'Pas besoin', pay: 'Payer', per: 'les 1 000', PER: 'LES 1 000',
      yourCode: 'Ton code', redeem: 'À utiliser quand tu veux', login: 'Se connecter', guest: 'Payer en invité',
      policy: 'Remboursement', refund: 'Pas livré ? Remboursé.', track: 'Suivre ma commande', orderNo: 'Numéro de commande',
      steps: ['Commandé', 'Payé', 'En route'], ask: 'Comment marche la livraison ?' },
  };
  const S = (A) => UI[A.lang] || UI.nl;

  /* ── The spoken line, in TikTok caption boxes ───────────────────────── */

  /** When each word is said: by its share of the letters, across the line. */
  function wordTimes(text, scene) {
    const ws = String(text).split(/[ \t\n]+/).filter(Boolean);   // not on no-break spaces: a price stays one word
    if (!scene.voiceDur) return ws.map((w, i) => ({ w, t: 0.08 + i * 0.06 }));
    const weights = ws.map((w) => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    return ws.map((w, i) => { const t = VOICE_AT + (acc / total) * scene.voiceDur; acc += weights[i]; return { w, t }; });
  }

  /* The words a viewer's eye should land on: the frustration and the money.
     Marked yellow in the caption box, the way creators mark them by hand. */
  const TAIL = '[.,!?…:;"»“”]*$';
  const KEY = {
    nl: new RegExp(`^(gratis|nooit|niks|nep|fout\\w*|wachtwoord\\w*|account\\w*|angst|bang|kwijt|verkeerde?|duur|zonde|teveel|veel|nóg|écht|weg|pech|alleen|gebruikersnaam\\w*|gast|geld|terug|scheelt|elke|steeds)${TAIL}`, 'i'),
    en: new RegExp(`^(free|never|nothing|fake|mistake|password\\w*|account\\w*|fear|lost|wrong|expensive|waste|overpaid|another|gone|only|username|guest|money|back|less|every|again|kept)${TAIL}`, 'i'),
    de: new RegExp(`^(gratis|nie|nichts|fake|fehler|passwörter|passwort|account\\w*|angst|verloren|falschen?|teurer?|zu|viel|noch|weg|pech|nur|benutzername\\w*|gast|geld|zurück|weniger|jede|immer)${TAIL}`, 'i'),
    fr: new RegExp(`^(gratuits?|jamais|rien|arnaque|erreur|mot|passe|compte|peur|perdu|mauvais|cher|trop|encore|juste|invité|remboursé|moins|chaque|toujours)${TAIL}`, 'i'),
  };
  const isMoney = (w) => /\u20ac\s?\d|\d\s?\u20ac/.test(w);   // €, escaped: survives any charset

  /**
   * White rounded boxes with black type, one per line, growing as each word
   * is spoken; the newest word pops. `all` shows the whole line at once (the
   * hook: the first frame is the thumbnail).
   */
  function boxed(ctx, G, scene, text, y, { u, px = 78, all = false, center = true, maxW = G.width, accentLast = null, A: A0 = { accent: '#22c55e', lang: 'nl' } } = {}) {
    const times = wordTimes(text, scene);
    const size = px * G.u;
    ctx.save();
    ctx.font = fontOf(size, 'Inter', '700');
    const space = ctx.measureText(' ').width;
    /* Wrap into lines that fit. */
    const lines = [];
    let line = [], w = 0;
    for (const x of times) {
      const ww = ctx.measureText(x.w).width;
      if (line.length && w + space + ww > maxW - 56 * G.u) { lines.push(line); line = []; w = 0; }
      line.push({ ...x, ww }); w += (line.length > 1 ? space : 0) + ww;
    }
    if (line.length) lines.push(line);
    const lh = size * 1.34, padX = 26 * G.u, padY = 12 * G.u, r = 16 * G.u;
    lines.forEach((ln, li) => {
      const vis = all ? ln : ln.filter((x) => u >= x.t);
      if (!vis.length) return;
      const width = vis.reduce((a, x) => a + x.ww, 0) + space * (vis.length - 1);
      const full = ln.reduce((a, x) => a + x.ww, 0) + space * (ln.length - 1);
      const cx = center ? G.W / 2 - full / 2 : G.left + padX;
      const ly = y + li * lh;
      const p = all ? 1 : eo(at(u, vis[0].t, 0.12));
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 24 * G.u; ctx.shadowOffsetY = 8 * G.u;
      roundRect(ctx, cx - padX, ly - size * 0.98 - padY, width + padX * 2, size * 1.26 + padY * 2, r);
      ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.fill();
      ctx.restore();
      let x = cx;
      vis.forEach((v, i) => {
        const pop = all ? 1 : 1 + 0.08 * (1 - eo(at(u, v.t, 0.14)));
        const last = li === lines.length - 1 && i === ln.length - 1;
        ctx.save();
        /* Grows from its left edge, so a popping word never eats the space before the next. */
        ctx.translate(x, ly - size * 0.32); ctx.scale(pop, pop);
        const money = isMoney(v.w), key = !money && (KEY[A0.lang] || KEY.nl).test(v.w) && v.w.length > 3;
        if (money || key) {
          roundRect(ctx, -8 * G.u, -size * 0.66, v.ww + 16 * G.u, size * 1.08, 10 * G.u);
          ctx.fillStyle = money ? A0.accent : '#facc15'; ctx.fill();
        }
        ctx.fillStyle = money ? '#ffffff' : accentLast && last ? accentLast : INK;
        ctx.fillText(v.w, 0, size * 0.32);
        ctx.restore();
        x += v.ww + space;
      });
    });
    ctx.restore();
    return { lines: lines.length, bottom: y + (lines.length - 1) * lh + size * 0.3 + padY };
  }

  /**
   * A slow wall of the product's own icon behind the picture: faint copies
   * drifting upward at their own speeds, so the frame is never an empty
   * gradient.
   */
  const WALL = [[0.08, 0.10, 210, 0.9], [0.84, 0.18, 170, 1.3], [0.22, 0.52, 150, 1.1], [0.92, 0.58, 230, 0.8],
    [0.10, 0.86, 190, 1.2], [0.70, 0.92, 160, 1.0], [0.50, 0.30, 130, 1.4]];
  function wall(ctx, G, A, img) {
    if (!img || A.footage) return;
    ctx.save();
    for (const [fx, fy, size, sp] of WALL) {
      const yy = ((fy - A.t * 0.018 * sp) % 1 + 1) % 1;
      const sz = size * G.u;
      ctx.globalAlpha = 0.07 + 0.03 * Math.sin(A.t * sp + fx * 7);
      ctx.save();
      ctx.translate(G.W * fx, -sz + yy * (G.H + 2 * sz)); ctx.rotate(Math.sin(A.t * 0.4 * sp + fy * 5) * 0.35);
      ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The top of a picture `hh` tall, centred in the space under the spoken line. */
  const top = (G, hh) => Math.max(Y(G, 0.27), (Y(G, 0.27) + G.bottom) / 2 - hh / 2);

  /* ── Pieces of UI ───────────────────────────────────────────────────── */

  /** A card that springs in: dark glass with an accent edge, or a light one. */
  function card(ctx, G, x, y, w, hh, { u, p0 = 0, accent = '#a855f7', light = false, tilt = 0 } = {}) {
    const p = at(u, p0, 0.42);
    if (p <= 0) return 0;
    const s = 0.86 + 0.14 * back(p);
    ctx.translate(x + w / 2, y + hh / 2 + (1 - eo(p)) * 60 * G.u); ctx.rotate(tilt * (1 - eo(p))); ctx.scale(s, s); ctx.translate(-(x + w / 2), -(y + hh / 2));
    ctx.globalAlpha *= eo(p);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 60 * G.u; ctx.shadowOffsetY = 24 * G.u;
    roundRect(ctx, x, y, w, hh, 36 * G.u);
    ctx.fillStyle = light ? '#fbfaff' : 'rgba(22,18,44,0.92)'; ctx.fill();
    ctx.restore();
    if (!light) {
      const edge = ctx.createLinearGradient(x, y, x + w, y + hh);
      edge.addColorStop(0, `${accent}dd`); edge.addColorStop(0.5, 'rgba(255,255,255,0.10)'); edge.addColorStop(1, `${accent}66`);
      roundRect(ctx, x, y, w, hh, 36 * G.u); ctx.strokeStyle = edge; ctx.lineWidth = 3 * G.u; ctx.stroke();
    }
    return p;
  }

  /** An input: a label above, a box, and its value typed in between t0 and t1. */
  function input(ctx, G, x, y, w, labelText, value, { u, t0, t1, light = false, mask = false, accent = '#a855f7', focus = false } = {}) {
    ctx.save();
    ctx.font = fontOf(34 * G.u, 'Inter', '600'); ctx.fillStyle = light ? '#5b5675' : '#a9a3c9';
    ctx.fillText(labelText, x, y);
    const by = y + 22 * G.u, bh = 104 * G.u;
    roundRect(ctx, x, by, w, bh, 20 * G.u);
    ctx.fillStyle = light ? '#ffffff' : 'rgba(255,255,255,0.06)'; ctx.fill();
    ctx.strokeStyle = focus && u > t0 && u < t1 + 0.4 ? accent : (light ? '#d9d6e6' : 'rgba(255,255,255,0.14)');
    ctx.lineWidth = (focus ? 3.5 : 2) * G.u; ctx.stroke();
    const n = Math.floor(cl((u - t0) / Math.max(0.01, t1 - t0)) * value.length);
    const shown = mask ? '•'.repeat(n) : value.slice(0, n);
    ctx.font = fontOf(46 * G.u, 'Inter', '600'); ctx.fillStyle = light ? INK : '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(shown, x + 30 * G.u, by + bh / 2 + 2 * G.u);
    if (u > t0 - 0.2 && u < t1 + 0.5 && Math.floor(u * 3) % 2 === 0) {
      const cx = x + 30 * G.u + ctx.measureText(shown).width + 4 * G.u;
      ctx.fillRect(cx, by + bh * 0.24, 4 * G.u, bh * 0.52);
    }
    ctx.restore();
    return by + bh;
  }

  /** A pill button. */
  function button(ctx, G, x, y, w, hh, text, { fill = '#a855f7', color = '#fff', outline = false, press = 0 } = {}) {
    ctx.save();
    const s = 1 - 0.05 * Math.sin(Math.PI * cl(press));
    ctx.translate(x + w / 2, y + hh / 2); ctx.scale(s, s); ctx.translate(-(x + w / 2), -(y + hh / 2));
    roundRect(ctx, x, y, w, hh, hh / 2);
    if (outline) { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2.5 * G.u; ctx.stroke(); }
    else {
      const g = ctx.createLinearGradient(x, y, x + w, y + hh);
      g.addColorStop(0, fill); g.addColorStop(1, `${fill}cc`);
      ctx.shadowColor = `${fill}88`; ctx.shadowBlur = 36 * G.u; ctx.shadowOffsetY = 10 * G.u;
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.shadowColor = 'transparent';
    ctx.font = fontOf(fit(ctx, text, 44 * G.u, w - 60 * G.u, 'Inter', '700'), 'Inter', '700');
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + hh / 2 + 2 * G.u);
    ctx.restore();
  }

  /** A tap: a ring that grows and fades where a finger touches. */
  function tap(ctx, G, x, y, u, t) {
    const k = cl((u - t) / 0.45);
    if (k <= 0 || k >= 1) return;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6 * G.u;
    ctx.beginPath(); ctx.arc(x, y, (30 + 70 * eo(k)) * G.u, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(x, y, 30 * G.u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** A stamp slammed across a card: a red cross, a word, or both. */
  function stamp(ctx, G, cx, cy, u, t, { word = null, cross = true, color = '#f43f5e', w = 520 } = {}) {
    const p = at(u, t, 0.22);
    if (p <= 0) return;
    const shake = u - t < 0.3 ? Math.sin((u - t) * 90) * 10 * G.u * (1 - (u - t) / 0.3) : 0;
    ctx.save();
    ctx.translate(cx + shake, cy);
    const s = 1 + 1.2 * (1 - back(p));
    ctx.scale(s, s);
    ctx.globalAlpha *= eo(at(u, t, 0.08));
    ctx.shadowColor = `${color}aa`; ctx.shadowBlur = 40 * G.u;
    if (cross) {
      ctx.strokeStyle = color; ctx.lineWidth = 34 * G.u; ctx.lineCap = 'round';
      const a = w * 0.36 * G.u;
      ctx.beginPath(); ctx.moveTo(-a, -a); ctx.lineTo(a, a); ctx.moveTo(a, -a); ctx.lineTo(-a, a); ctx.stroke();
    }
    if (word) {
      ctx.rotate(-0.14);
      ctx.font = fontOf(150 * G.u);
      const tw = ctx.measureText(word).width;
      roundRect(ctx, -tw / 2 - 36 * G.u, -128 * G.u, tw + 72 * G.u, 170 * G.u, 22 * G.u);
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(word, 0, 10 * G.u);
    }
    ctx.restore();
  }

  /** A green tick in a circle, popping in. */
  function tick(ctx, G, x, y, r, u, t, color = '#22c55e') {
    const p = at(u, t, 0.3);
    if (p <= 0) return;
    ctx.save();
    ctx.translate(x, y); ctx.scale(back(p), back(p));
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const k = eo(at(u, t + 0.08, 0.2));
    ctx.beginPath(); ctx.moveTo(-r * 0.42, 0); ctx.lineTo(-r * 0.1, r * 0.32 * Math.min(1, k * 2));
    if (k > 0.5) ctx.lineTo(-r * 0.1 + r * 0.55 * (k - 0.5) * 2, r * 0.32 - r * 0.7 * (k - 0.5) * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** A product tile: icon, name, price pill, and the price per 1.000 under the name. */
  function tile(ctx, G, A, x, y, w, hh, item, { u, p0, strong = false } = {}) {
    ctx.save();
    const p = card(ctx, G, x, y, w, hh, { u, p0, accent: strong ? A.accent : '#ffffff' });
    if (p <= 0) { ctx.restore(); return; }
    if (strong) {
      roundRect(ctx, x, y, w, hh, 36 * G.u);
      ctx.strokeStyle = A.accent; ctx.lineWidth = 6 * G.u; ctx.stroke();
    }
    const img = A.img(item.image);
    const is = hh - 56 * G.u;
    if (img) ctx.drawImage(img, x + 28 * G.u, y + 28 * G.u, is, is);
    const tx = x + (img ? is + 56 * G.u : 40 * G.u);
    const pillW = 250 * G.u;
    ctx.textBaseline = 'alphabetic';
    const nameSize = fit(ctx, item.name, 46 * G.u, x + w - tx - pillW - 40 * G.u, 'Inter', '700');
    ctx.font = fontOf(nameSize, 'Inter', '700'); ctx.fillStyle = '#ffffff';
    ctx.fillText(item.name, tx, y + hh / 2 - (item.per ? 6 : -14) * G.u);
    if (item.per) {
      ctx.font = fontOf(34 * G.u, 'Inter', '600'); ctx.fillStyle = strong ? A.accent : '#a9a3c9';
      ctx.fillText(`${item.per} ${S(A).per}`, tx, y + hh / 2 + 44 * G.u);
    }
    const px = x + w - pillW - 28 * G.u, ph = 96 * G.u, py = y + hh / 2 - ph / 2;
    roundRect(ctx, px, py, pillW, ph, ph / 2);
    ctx.fillStyle = strong ? A.accent : 'rgba(255,255,255,0.12)'; ctx.fill();
    ctx.font = fontOf(fit(ctx, item.price, 54 * G.u, pillW - 30 * G.u), 'Bric', '800');
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(item.price, px + pillW / 2, py + ph / 2 + 3 * G.u);
    ctx.restore();
    if (strong) sweep(ctx, x, y, w, hh, u, p0 + 0.45, 36 * G.u);
  }

  /* ── Problem pictures ───────────────────────────────────────────────── */
  const PROBLEM = {
    /* The "generator": a loud form that wants a username AND a password. */
    scam(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 640 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, light: true, tilt: -0.06 }) > 0) {
        roundRect(ctx, x, y, w, 130 * G.u, 36 * G.u); ctx.save(); ctx.clip();
        const g = ctx.createLinearGradient(x, y, x + w, y); g.addColorStop(0, '#facc15'); g.addColorStop(1, '#fb923c');
        ctx.fillStyle = g; ctx.fillRect(x, y, w, 130 * G.u); ctx.restore();
        ctx.font = fontOf(fit(ctx, d.title, 64 * G.u, w - 80 * G.u)); ctx.fillStyle = INK; ctx.textBaseline = 'middle';
        ctx.fillText(d.title, x + 40 * G.u, y + 68 * G.u); ctx.textBaseline = 'alphabetic';
        const b1 = input(ctx, G, x + 40 * G.u, y + 200 * G.u, w - 80 * G.u, S(A).user, 'speler123', { u, t0: 0.4, t1: 0.8, light: true });
        input(ctx, G, x + 40 * G.u, b1 + 60 * G.u, w - 80 * G.u, S(A).pass, 'xxxxxxxxxx', { u, t0: 0.9, t1: 1.4, light: true, mask: true });
      }
      ctx.restore();
      stamp(ctx, G, G.W / 2, y + hh / 2, u, 1.6, { word: S(A).fake });
    },
    /* The same small top-up, over and over. */
    receipts(ctx, G, d, u, A) {
      const it = d.receipt; if (!it) return;
      const n = Math.max(2, Math.min(12, d.count || 5)), step = n > 6 ? 0.42 : 0.72;
      const x = G.left, w = G.width, hh = 150 * G.u, y0 = top(G, hh * (1 + (n - 1) * step)) + 40 * G.u;
      for (let i = 0; i < n; i++) {
        ctx.save();
        tile(ctx, G, A, x + (i % 2 ? 14 : -14) * G.u, y0 + i * (hh * step), w, hh, { ...it, per: null }, { u, p0: 0.15 + i * (1.1 / n) });
        ctx.restore();
      }
      const k = Math.min(n, Math.floor(cl((u - 0.15) / 1.1) * n + (u > 0.15 ? 1 : 0)));
      if (k > 0) {
        const bx = G.right - 120 * G.u, by = y0 - 50 * G.u;
        ctx.save();
        ctx.translate(bx, by); const s = 1 + 0.25 * (1 - eo(cl(((u - 0.15) % (1.1 / n)) / 0.15)));
        ctx.scale(s, s);
        ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(0, 0, 78 * G.u, 0, Math.PI * 2); ctx.fill();
        ctx.font = fontOf(70 * G.u); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`×${k}`, 0, 4 * G.u);
        ctx.restore();
      }
    },
    /* Yet another sign-up form. */
    signup(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 760 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, light: true, tilt: 0.05 }) > 0) {
        ctx.font = fontOf(56 * G.u); ctx.fillStyle = INK; ctx.fillText(S(A).signup, x + 40 * G.u, y + 92 * G.u);
        const fields = S(A).fields;
        fields.forEach((f, i) => {
          const fy = y + 150 * G.u + i * 140 * G.u;
          ctx.font = fontOf(32 * G.u, 'Inter', '600'); ctx.fillStyle = '#5b5675'; ctx.fillText(f, x + 40 * G.u, fy);
          roundRect(ctx, x + 40 * G.u, fy + 16 * G.u, w - 80 * G.u, 84 * G.u, 18 * G.u);
          ctx.strokeStyle = '#d9d6e6'; ctx.lineWidth = 2 * G.u; ctx.stroke();
        });
        ctx.font = fontOf(30 * G.u, 'Inter', '600'); ctx.fillStyle = '#5b5675';
        ctx.fillText(S(A).news, x + 40 * G.u, y + hh - 50 * G.u);
      }
      ctx.restore();
      stamp(ctx, G, G.W / 2, y + hh / 2, u, 1.5, { word: S(A).no, cross: false });
    },
    /* Paid — and then nothing to see. */
    worry(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 520 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05 }) > 0) {
        ctx.font = fontOf(54 * G.u); ctx.fillStyle = '#fff'; ctx.fillText(S(A).myOrder, x + 44 * G.u, y + 100 * G.u);
        const row = (ry, name, done) => {
          ctx.font = fontOf(44 * G.u, 'Inter', '600'); ctx.fillStyle = '#d9d4f2'; ctx.fillText(name, x + 140 * G.u, ry + 14 * G.u);
          if (done) tick(ctx, G, x + 84 * G.u, ry, 34 * G.u, u, 0.35);
          else {
            ctx.save(); ctx.translate(x + 84 * G.u, ry); ctx.rotate(u * 7);
            ctx.strokeStyle = '#a9a3c9'; ctx.lineWidth = 7 * G.u; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(0, 0, 28 * G.u, 0, Math.PI * 1.4); ctx.stroke(); ctx.restore();
          }
        };
        row(y + 210 * G.u, S(A).paid, true);
        row(y + 330 * G.u, S(A).andNow, false);
      }
      ctx.restore();
      [[0.88, 0.18, 1.0], [0.78, 0.72, 1.3], [0.55, 1.08, 1.6]].forEach(([fx, fy, t]) => {
        const p = at(u, t, 0.3); if (p <= 0) return;
        ctx.save(); ctx.globalAlpha = eo(p);
        ctx.translate(G.left + G.width * fx, y + hh * fy + Math.sin(u * 3 + fx * 9) * 12 * G.u);
        ctx.scale(back(p), back(p)); ctx.rotate((fx - 0.5) * 0.5);
        ctx.font = fontOf(150 * G.u); ctx.fillStyle = '#f43f5e'; ctx.textAlign = 'center'; ctx.fillText('?', 0, 0);
        ctx.restore();
      });
    },
    /* Two accounts; the wrong one gets picked. */
    wrong(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 170 * G.u, y = top(G, hh * 2 + 40 * G.u);
      const accounts = [['speler123', S(A).yours], ['broertje_07', S(A).notYours]];
      accounts.forEach(([name, sub], i) => {
        ctx.save();
        const yy = y + i * (hh + 40 * G.u);
        if (card(ctx, G, x, yy, w, hh, { u, p0: 0.1 + i * 0.15 }) > 0) {
          ctx.fillStyle = i ? '#f43f5e' : '#22c55e';
          ctx.beginPath(); ctx.arc(x + 90 * G.u, yy + hh / 2, 46 * G.u, 0, Math.PI * 2); ctx.fill();
          ctx.font = fontOf(56 * G.u, 'Inter', '700'); ctx.fillStyle = '#fff'; ctx.fillText(name, x + 170 * G.u, yy + hh / 2 + 2 * G.u);
          ctx.font = fontOf(32 * G.u, 'Inter', '600'); ctx.fillStyle = '#a9a3c9'; ctx.fillText(sub, x + 170 * G.u, yy + hh / 2 + 48 * G.u);
          if (i === 1 && u > 0.8) {
            roundRect(ctx, x, yy, w, hh, 36 * G.u); ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 6 * G.u; ctx.stroke();
          }
        }
        ctx.restore();
      });
      tap(ctx, G, G.right - 140 * G.u, y + hh * 1.5 + 40 * G.u, u, 0.75);
      stamp(ctx, G, G.right - 140 * G.u, y + hh * 1.5 + 40 * G.u, u, 1.5, { w: 260 });
    },
    /* Only the line: the product, under a red light. */
    text(ctx, G, d, u, A) {
      hero(ctx, G, A.img(d.image), G.W / 2, top(G, 0) , 560, { u, p0: 0.1, accent: '#f43f5e', drop: 260, t: A.t });
    },
  };

  /* ── Solution pictures ──────────────────────────────────────────────── */
  const SOLUTION = {
    /* The shop's own checkout: one field, the username; no password. */
    username(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 640 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, accent: A.accent }) > 0) {
        ctx.font = fontOf(56 * G.u); ctx.fillStyle = '#fff'; ctx.fillText(S(A).checkout, x + 44 * G.u, y + 100 * G.u);
        const b = input(ctx, G, x + 44 * G.u, y + 180 * G.u, w - 88 * G.u, d.field || S(A).user, 'speler123', { u, t0: 0.45, t1: 1.0, accent: A.accent, focus: true });
        const ry = b + 70 * G.u;
        ctx.font = fontOf(44 * G.u, 'Inter', '600'); ctx.fillStyle = '#d9d4f2';
        ctx.fillText(S(A).pass, x + 44 * G.u, ry + 14 * G.u);
        const p = at(u, 1.25, 0.3);
        if (p > 0) {
          ctx.save(); ctx.globalAlpha *= eo(p);
          const pw = 330 * G.u, ph = 80 * G.u, px = x + w - 44 * G.u - pw;
          roundRect(ctx, px, ry - ph / 2, pw, ph, ph / 2); ctx.fillStyle = '#22c55e26'; ctx.fill();
          ctx.font = fontOf(38 * G.u, 'Inter', '700'); ctx.fillStyle = '#4ade80'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(S(A).notNeeded, px + pw / 2, ry + 2 * G.u);
          ctx.restore();
        }
        tick(ctx, G, x + w - 44 * G.u - 370 * G.u, ry, 30 * G.u, u, 1.3);
        button(ctx, G, x + 44 * G.u, y + hh - 150 * G.u, w - 88 * G.u, 110 * G.u, S(A).pay, { fill: A.accent, press: (u - 1.7) / 0.25 });
      }
      ctx.restore();
      tap(ctx, G, G.W / 2 + 160 * G.u, y + hh - 95 * G.u, u, 1.7);
    },
    /* Product tiles with the real prices; the bigger pack lit. */
    packs(ctx, G, d, u, A) {
      const items = d.packs || [];
      const hh = (items.length <= 2 ? 250 : 200) * G.u, gap = 40 * G.u;
      const first = items[0], last = items[items.length - 1];
      /* When the row is a real comparison, the sum itself, big, under the tiles:
         the dearest price per 1.000 struck through, the better one lit. */
      const sum = d.highlight && first?.per && last?.per && first !== last;
      const blockH = items.length * hh + (items.length - 1) * gap + (sum ? 300 * G.u : 0);
      const y0 = top(G, blockH);
      items.forEach((it, i) => tile(ctx, G, A, G.left, y0 + i * (hh + gap), G.width, hh, it,
        { u, p0: 0.1 + i * 0.28, strong: d.highlight && i === items.length - 1 }));
      if (!sum) return;
      const t0 = 0.3 + items.length * 0.28;
      const p = at(u, t0, 0.4);
      if (p <= 0) return;
      const yy = y0 + items.length * (hh + gap) + 150 * G.u;
      ctx.save();
      ctx.globalAlpha *= eo(p);
      ctx.textBaseline = 'alphabetic';
      ctx.font = fontOf(120 * G.u);
      const a1 = first.per, a2 = last.per, arrow = '  \u2192  ';
      const w1 = ctx.measureText(a1).width, wa = ctx.measureText(arrow).width, w2 = ctx.measureText(a2).width;
      const k = Math.min(1, G.width / (w1 + wa + w2));
      ctx.translate(G.W / 2, yy); ctx.scale(k, k);
      let x = -(w1 + wa + w2) / 2;
      ctx.fillStyle = '#a9a3c9'; ctx.fillText(a1, x, 0);
      const strike = eio(at(u, t0 + 0.3, 0.25));
      ctx.fillStyle = '#f43f5e'; ctx.fillRect(x - 6 * G.u, -44 * G.u, (w1 + 12 * G.u) * strike, 12 * G.u);
      x += w1;
      ctx.fillStyle = '#ffffff'; ctx.fillText(arrow, x, 0); x += wa;
      const pop = 1 + 0.3 * (1 - back(at(u, t0 + 0.55, 0.3)));
      ctx.save(); ctx.translate(x + w2 / 2, -40 * G.u); ctx.scale(pop, pop);
      ctx.fillStyle = A.accent; ctx.shadowColor = `${A.accent}aa`; ctx.shadowBlur = 40 * G.u;
      ctx.textAlign = 'center'; ctx.fillText(a2, 0, 40 * G.u); ctx.restore();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= eo(p);
      ctx.font = fontOf(42 * G.u, 'Raj', '600'); ctx.letterSpacing = `${6 * G.u}px`;
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
      ctx.fillText(S(A).PER, G.W / 2, yy + 80 * G.u);
      ctx.restore();
    },
    /* The code, in your inbox. */
    mailcode(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 560 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, light: true }) > 0) {
        ctx.fillStyle = A.accent; ctx.beginPath(); ctx.arc(x + 90 * G.u, y + 100 * G.u, 46 * G.u, 0, Math.PI * 2); ctx.fill();
        ctx.font = fontOf(46 * G.u); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('F', x + 90 * G.u, y + 102 * G.u);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.font = fontOf(42 * G.u, 'Inter', '700'); ctx.fillStyle = INK; ctx.fillText('ForgeMarket', x + 160 * G.u, y + 92 * G.u);
        ctx.font = fontOf(32 * G.u, 'Inter', '600'); ctx.fillStyle = '#5b5675';
        ctx.fillText(`${S(A).yourCode}: ${d.product?.name || ''}`.slice(0, 40), x + 160 * G.u, y + 140 * G.u);
        const code = 'XXXX-XXXX-XXXX';
        const n = Math.floor(cl((u - 0.5) / 0.7) * code.length);
        const cy = y + 230 * G.u, ch = 170 * G.u;
        roundRect(ctx, x + 40 * G.u, cy, w - 80 * G.u, ch, 26 * G.u);
        ctx.fillStyle = '#f1effa'; ctx.fill(); ctx.setLineDash([14 * G.u, 10 * G.u]); ctx.strokeStyle = A.accent; ctx.lineWidth = 3 * G.u; ctx.stroke(); ctx.setLineDash([]);
        ctx.font = fontOf(fit(ctx, code, 86 * G.u, w - 160 * G.u, 'Raj', '600', 6 * G.u), 'Raj', '600'); ctx.letterSpacing = `${6 * G.u}px`;
        ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(code.slice(0, n).replace(/X/g, '•') + code.slice(n).replace(/[X-]/g, ' '), x + w / 2, cy + ch / 2 + 4 * G.u);
        ctx.letterSpacing = '0px';
        ctx.font = fontOf(32 * G.u, 'Inter', '600'); ctx.fillStyle = '#5b5675';
        ctx.fillText(S(A).redeem, x + w / 2, y + hh - 70 * G.u);
      }
      ctx.restore();
      if (u > 1.3) sweep(ctx, x, y + 230 * G.u, w, 170 * G.u, u, 1.3, 26 * G.u);
    },
    /* Log in, or just check out as a guest. */
    guest(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 520 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, accent: A.accent }) > 0) {
        ctx.font = fontOf(56 * G.u); ctx.fillStyle = '#fff'; ctx.fillText(S(A).checkout, x + 44 * G.u, y + 100 * G.u);
        button(ctx, G, x + 44 * G.u, y + 170 * G.u, w - 88 * G.u, 110 * G.u, S(A).login, { outline: true, color: '#a9a3c9' });
        button(ctx, G, x + 44 * G.u, y + 320 * G.u, w - 88 * G.u, 120 * G.u, S(A).guest, { fill: A.accent, press: (u - 0.9) / 0.25 });
      }
      ctx.restore();
      tap(ctx, G, G.W / 2 + 120 * G.u, y + 380 * G.u, u, 0.9);
      tick(ctx, G, G.right - 40 * G.u, y + 10 * G.u, 56 * G.u, u, 1.3);
    },
    /* The refund line, with a marker through it. */
    refund(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 640 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, light: true }) > 0) {
        ctx.font = fontOf(54 * G.u); ctx.fillStyle = INK; ctx.fillText(S(A).policy, x + 44 * G.u, y + 100 * G.u);
        [0, 1, 3, 4].forEach((i) => {
          roundRect(ctx, x + 44 * G.u, y + 170 * G.u + i * 80 * G.u, (w - 88 * G.u) * (i % 2 ? 0.7 : 0.9), 26 * G.u, 13 * G.u);
          ctx.fillStyle = '#e6e3f0'; ctx.fill();
        });
        const ly = y + 170 * G.u + 2 * 80 * G.u + 16 * G.u;
        const line = S(A).refund;
        ctx.font = fontOf(fit(ctx, line, 54 * G.u, w - 88 * G.u, 'Inter', '700'), 'Inter', '700');
        const lw = ctx.measureText(line).width;
        const k = eio(at(u, 0.7, 0.5));
        ctx.fillStyle = `${A.accent}55`; ctx.fillRect(x + 36 * G.u, ly - 46 * G.u, (lw + 16 * G.u) * k, 64 * G.u);
        ctx.fillStyle = INK; ctx.fillText(line, x + 44 * G.u, ly);
        ctx.font = fontOf(32 * G.u, 'Inter', '600'); ctx.fillStyle = '#5b5675';
        ctx.fillText('forgemarket.nl/refunds', x + 44 * G.u, y + hh - 50 * G.u);
      }
      ctx.restore();
    },
    /* Following an order without an account. */
    track(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 660 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, accent: A.accent }) > 0) {
        ctx.font = fontOf(56 * G.u); ctx.fillStyle = '#fff'; ctx.fillText(S(A).track, x + 44 * G.u, y + 100 * G.u);
        const b = input(ctx, G, x + 44 * G.u, y + 175 * G.u, w - 88 * G.u, S(A).orderNo, 'FM-1234', { u, t0: 0.35, t1: 0.75, accent: A.accent, focus: true });
        S(A).steps.forEach((s, i) => {
          const sy = b + 90 * G.u + i * 92 * G.u;
          tick(ctx, G, x + 84 * G.u, sy, 30 * G.u, u, 1.0 + i * 0.25, i < 2 ? '#22c55e' : A.accent);
          const p = at(u, 1.0 + i * 0.25, 0.3);
          if (p > 0) { ctx.save(); ctx.globalAlpha *= eo(p); ctx.font = fontOf(44 * G.u, 'Inter', '600'); ctx.fillStyle = '#d9d4f2'; ctx.fillText(s, x + 140 * G.u, sy + 15 * G.u); ctx.restore(); }
        });
      }
      ctx.restore();
    },
    /* A question in the Discord. */
    discord(ctx, G, d, u, A) {
      const x = G.left, w = G.width, hh = 520 * G.u, y = top(G, hh);
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, accent: '#5865f2' }) > 0) {
        ctx.font = fontOf(46 * G.u, 'Inter', '700'); ctx.fillStyle = '#a9a3c9'; ctx.fillText('# support', x + 44 * G.u, y + 90 * G.u);
        const p = at(u, 0.4, 0.35);
        if (p > 0) {
          ctx.save(); ctx.globalAlpha *= eo(p); ctx.translate(0, (1 - eo(p)) * 30 * G.u);
          ctx.fillStyle = '#5865f2'; ctx.beginPath(); ctx.arc(x + 90 * G.u, y + 200 * G.u, 40 * G.u, 0, Math.PI * 2); ctx.fill();
          roundRect(ctx, x + 150 * G.u, y + 150 * G.u, w - 194 * G.u, 110 * G.u, 26 * G.u); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
          ctx.font = fontOf(fit(ctx, S(A).ask, 44 * G.u, w - 250 * G.u, 'Inter', '600'), 'Inter', '600'); ctx.fillStyle = '#fff';
          ctx.fillText(S(A).ask, x + 184 * G.u, y + 220 * G.u);
          ctx.restore();
        }
        if (u > 1.0) {
          for (let i = 0; i < 3; i++) {
            const a = 0.35 + 0.65 * Math.max(0, Math.sin(u * 7 - i * 0.9));
            ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
            ctx.beginPath(); ctx.arc(x + 190 * G.u + i * 40 * G.u, y + 360 * G.u, 12 * G.u, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.restore();
    },
    /* Three checks. */
    checklist(ctx, G, d, u, A) {
      const items = d.checklist || [];
      const x = G.left, w = G.width, hh = 150 * G.u, y0 = top(G, items.length * hh + (items.length - 1) * 34 * G.u);
      items.forEach((s, i) => {
        const yy = y0 + i * (hh + 34 * G.u);
        ctx.save();
        if (card(ctx, G, x, yy, w, hh, { u, p0: 0.1 + i * 0.3, accent: A.accent }) > 0) {
          ctx.font = fontOf(fit(ctx, s, 54 * G.u, w - 200 * G.u, 'Inter', '700'), 'Inter', '700'); ctx.fillStyle = '#fff';
          ctx.textBaseline = 'middle'; ctx.fillText(s, x + 150 * G.u, yy + hh / 2 + 2 * G.u);
        }
        ctx.restore();
        tick(ctx, G, x + 80 * G.u, yy + hh / 2, 38 * G.u, u, 0.35 + i * 0.3);
      });
    },
    text(ctx, G, d, u, A) {
      hero(ctx, G, A.img(d.image), G.W / 2, top(G, 0), 560, { u, p0: 0.1, accent: A.accent, drop: 260, t: A.t });
    },
  };

  /* ── The four beats ─────────────────────────────────────────────────── */
  const textTop = (G) => Y(G, 0.0) + 40 * G.u;

  return {
    'ugc-hook'(ctx, G, d, u, A, scene) {
      wall(ctx, G, A, A.img(d.image));
      if (!A.footage) {
        /* The thing it is about, huge and faint behind everything, drifting. */
        if (d.word) {
          ctx.save();
          ctx.translate(G.W / 2 + Math.sin(A.t * 0.6) * 30 * G.u, Y(G, 0.62)); ctx.rotate(-0.12);
          ctx.font = fontOf(fit(ctx, d.word, 420 * G.u, G.W * 1.3));
          ctx.textAlign = 'center'; ctx.lineWidth = 4 * G.u; ctx.strokeStyle = `${A.accent}55`;
          ctx.strokeText(d.word, 0, 0);
          ctx.restore();
        }
        hero(ctx, G, A.img(d.image), G.W / 2, Y(G, 0.80), 420, { u: u + 10, accent: A.accent, t: A.t });
      }
      /* On screen from frame 0, punching in with a short shake. */
      const s = 1 + 0.12 * (1 - eo(u / 0.35));
      const shake = u < 0.3 ? Math.sin(u * 95) * 9 * G.u * (1 - u / 0.3) : 0;
      ctx.save();
      ctx.translate(G.W / 2 + shake, Y(G, 0.42)); ctx.scale(s, s); ctx.translate(-G.W / 2, -Y(G, 0.42));
      boxed(ctx, G, scene, d.text, A.footage ? Y(G, 0.18) : Y(G, 0.24), { u, px: 96, all: true, A });
      ctx.restore();
    },
    'ugc-problem'(ctx, G, d, u, A, scene) {
      wall(ctx, G, A, A.img(d.image));
      (PROBLEM[d.prop?.kind] || PROBLEM.text)(ctx, G, { ...d.prop, image: d.image, product: d.product }, u, A);
      boxed(ctx, G, scene, d.text, textTop(G), { u, A });
    },
    'ugc-solution'(ctx, G, d, u, A, scene) {
      wall(ctx, G, A, A.img(d.image));
      (SOLUTION[d.prop?.kind] || SOLUTION.text)(ctx, G, { ...d.prop, image: d.image, product: d.product }, u, A);
      boxed(ctx, G, scene, d.text, textTop(G), { u, A });
    },
    'ugc-cta'(ctx, G, d, u, A, scene) {
      wall(ctx, G, A, A.img(d.image));
      const it = d.product || {};
      const x = G.left + 40 * G.u, w = G.width - 80 * G.u, y = Y(G, 0.27), hh = 640 * G.u;
      ctx.save();
      if (card(ctx, G, x, y, w, hh, { u, p0: 0.05, accent: A.accent }) > 0) {
        const img = A.img(it.image);
        if (img) {
          const s = 300 * G.u, float = Math.sin(A.t * 1.6) * 10 * G.u;
          const glow = ctx.createRadialGradient(x + w / 2, y + 200 * G.u, 0, x + w / 2, y + 200 * G.u, s);
          glow.addColorStop(0, `${A.accent}66`); glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = glow; ctx.fillRect(x, y, w, 420 * G.u);
          ctx.drawImage(img, x + w / 2 - s / 2, y + 50 * G.u + float, s, s);
        }
        ctx.font = fontOf(fit(ctx, it.name || '', 64 * G.u, w - 80 * G.u, 'Inter', '700'), 'Inter', '700');
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText(it.name || '', x + w / 2, y + 430 * G.u);
        const pp = at(u, 0.35, 0.35);
        if (pp > 0) {
          ctx.save();
          const s = 1 + 0.4 * (1 - back(pp));
          ctx.translate(x + w / 2, y + 550 * G.u); ctx.scale(s, s);
          ctx.font = fontOf(120 * G.u); ctx.fillStyle = A.accent;
          ctx.shadowColor = `${A.accent}aa`; ctx.shadowBlur = 40 * G.u;
          ctx.fillText(it.price || '', 0, 0);
          ctx.restore();
        }
      }
      ctx.restore();
      const pc = at(u, 0.6, 0.4);
      if (pc > 0) {
        const pulse = 1 + 0.03 * Math.sin(Math.max(0, u - 1) * 5);
        const bw = G.W - 300 * G.u, bh = 128 * G.u, bx = G.W / 2 - bw / 2, by = y + hh + 60 * G.u;
        ctx.save(); ctx.globalAlpha *= eo(pc);
        ctx.translate(G.W / 2, by + bh / 2); ctx.scale(pulse, pulse); ctx.translate(-G.W / 2, -(by + bh / 2));
        /* The brand's colour, like the rest of the frame — not the shop's purple. */
        ctx.shadowColor = `${A.accent}99`; ctx.shadowBlur = 60 * G.u;
        roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = A.accent; ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = readableOn(A.accent); ctx.font = fontOf(58 * G.u, 'Inter', '700'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('forgemarket.nl', G.W / 2, by + bh / 2 + 3 * G.u);
        ctx.restore();
        sweep(ctx, bx, by, bw, bh, u, 1.1, bh / 2);
      }
      boxed(ctx, G, scene, d.text, textTop(G), { u, A });
    },
  };
}
