/**
 * Die fünfzig UGC-Skripte auf Deutsch — dieselben Beats, Produkte, Bilder und
 * Preisrechnungen wie die niederländischen in ugcScripts.js; hier stehen nur
 * die Worte. So geschrieben, wie ein Spieler redet, nicht Wort für Wort übersetzt.
 */
const R1 = 'ROBUX-1000', R45 = 'ROBUX-4500', R10 = 'ROBUX-10000', R22 = 'ROBUX-22500';
const V1 = 'VBUCKS-1000', V28 = 'VBUCKS-2800', V5 = 'VBUCKS-5000', V13 = 'VBUCKS-13500';
const site = ($) => $.site('forgemarket.nl');
const fa = ($) => $.say('2FA', 'Zwei-Faktor-Authentifizierung');

export default {
  'ugc-01': {
    hook: () => 'Ich dachte echt, gratis Robux funktionieren…',
    problem: () => 'Du gibst deinen Namen ein, dann dein Passwort. Und dann kommt nichts.',
    solution: ($) => `Echte Robux gibt es ohne dein Passwort. Du gibst nur deinen ${$.field(R1, 'acc')} an.`,
    cta: ($) => `Tausend Robux, ${$.p(R1)}. ${site($)}` },
  'ugc-02': {
    hook: () => 'Dieser „Robux-Generator" wollte nur eins von mir.',
    problem: () => 'Mein Passwort. Wozu sollte ein Verkäufer das brauchen?',
    solution: () => 'ForgeMarket fragt nur nach deinem Benutzernamen. Dein Passwort bleibt deins.',
    cta: ($) => `Schau selbst: ${site($)}` },
  'ugc-03': {
    hook: () => 'Mein kleiner Bruder hat auf einen „Gratis-Robux"-Link geklickt.',
    problem: () => 'Er sollte sich auf einer Seite einloggen, die wie Roblox aussah. War sie aber nicht.',
    solution: () => 'Robux kaufen geht ohne Login woanders. Bei ForgeMarket nur dein Benutzername.',
    cta: ($) => `Zeig es ihm: ${site($)}` },
  'ugc-04': {
    hook: () => 'Zehntausend Robux gratis? Nein.',
    problem: () => 'Wenn etwas gratis ist, zahlst du mit deinem Account.',
    solution: ($) => `Zehntausend Robux kosten bei ForgeMarket ${$.p(R10)}. Einfach ein Preis, keine Tricks.`,
    cta: ($) => site($) },
  'ugc-05': {
    hook: () => 'Ich bekam eine DM: „Willst du gratis Robux?"',
    problem: () => 'Erst dein Passwort, dann „Verifizierung". Kennst du.',
    solution: () => 'Ich kaufe lieber ganz normal. Nur mein Benutzername, nie mein Passwort.',
    cta: () => 'Link in Bio.' },
  'ugc-06': {
    hook: () => 'Diesen Fehler machen Roblox-Spieler ständig.',
    problem: () => 'Sie geben ihr Passwort jemandem, der „Robux besorgt".',
    solution: () => 'Das musst du nie. Für Robux bei ForgeMarket reicht dein Benutzername.',
    cta: ($) => `${site($)}. Dein Passwort bleibt deins.` },
  'ugc-07': {
    hook: () => 'Schalte das ein, bevor du Robux kaufst.',
    problem: ($) => `Ohne ${fa($)} ist dein Account eine offene Tür.`,
    solution: ($) => `ForgeMarket liefert erst, wenn ${fa($)} an ist, und fragt nur nach deinem Benutzernamen.`,
    cta: ($) => `Erst ${fa($)}, dann ${site($)}`,
    checklist: () => ['2FA an', 'Nur dein Benutzername', 'Nie dein Passwort'] },
  'ugc-08': {
    hook: () => 'Mein Kumpel hat seinen Roblox-Account verloren.',
    problem: () => 'Er hat sein Passwort für „billige Robux" hergegeben.',
    solution: () => 'Robux kaufen geht, ohne dass jemand in deinen Account kommt. Nur dein Benutzername.',
    cta: ($) => site($) },
  'ugc-09': {
    hook: () => 'Was braucht ein Robux-Verkäufer wirklich von dir?',
    problem: () => 'Nicht dein Passwort. Nicht deinen E-Mail-Code.',
    solution: ($) => `Bei ForgeMarket: deinen ${$.field(R1, 'acc')}. Mehr nicht.`,
    cta: ($) => `Tausend Robux, ${$.p(R1)}. ${site($)}` },
  'ugc-10': {
    hook: () => 'Meine Mutter fragte: „Musst du dein Passwort angeben?"',
    problem: () => 'Bei vielen dieser Seiten schon. Deshalb hat sie ihnen nicht getraut.',
    solution: ($) => `Hier nicht. Du gibst nur deinen ${$.field(R1, 'acc')} ein.`,
    cta: ($) => `Zeig es ihr: ${site($)}` },
  'ugc-11': {
    hook: () => 'Ich habe zu viel für Robux bezahlt. Selbst schuld.',
    problem: ($) => `Ich habe immer wieder tausend Robux für ${$.p(R1)} gekauft.`,
    solution: ($) => `Zehntausend kosten ${$.p(R10)}. Das sind ${$.per(R10)} pro tausend statt ${$.per(R1)}.`,
    cta: ($) => `Rechne nach: ${site($)}` },
  'ugc-12': {
    hook: () => 'Hol kurz deinen Taschenrechner.',
    problem: ($) => `Tausend Robux: ${$.p(R1)}. Klingt okay, oder?`,
    solution: ($) => `Bei ${$.size(R22)} Robux zahlst du ${$.per(R22)} pro tausend. Größeres Paket, kleinerer Preis pro tausend.`,
    cta: ($) => site($) },
  'ugc-13': {
    hook: () => 'Jede Woche ein bisschen Robux kaufen? Teurer Spaß.',
    problem: ($) => `Zehnmal tausend Robux: ${$.m(10 * $.c(R1))}.`,
    solution: ($) => `Zehntausend auf einmal: ${$.p(R10)}. Das sind ${$.m(10 * $.c(R1) - $.c(R10))} weniger.`,
    cta: ($) => site($) },
  'ugc-14': {
    hook: () => 'Ich warte jetzt mit Robux kaufen. Mit Absicht.',
    problem: () => 'Jeder kleine Kauf hat mich pro tausend mehr gekostet.',
    solution: ($) => `${$.size(R45)} Robux für ${$.p(R45)} sind ${$.per(R45)} pro tausend. Tausend einzeln kosten ${$.p(R1)}.`,
    cta: ($) => `Schau selbst: ${site($)}` },
  'ugc-15': {
    hook: () => 'Keiner schaut auf den Preis pro tausend Robux.',
    problem: () => 'Man sieht die Summe und klickt.',
    solution: ($) => `Bei ForgeMarket geht es von ${$.per(R1)} bis ${$.per(R22)} pro tausend, je nach Paket.`,
    cta: ($) => site($) },
  'ugc-16': {
    hook: () => 'Das hat mich jahrelang zu viel V-Bucks-Geld gekostet.',
    problem: ($) => `Ich habe immer das kleinste Paket gekauft. Tausend für ${$.p(V1)}.`,
    solution: ($) => `Das ${$.size(V13)}er-Paket kostet ${$.p(V13)}. Das sind ${$.per(V13)} pro tausend.`,
    cta: ($) => `Rechne nach auf ${site($)}` },
  'ugc-17': {
    hook: ($) => `${$.per(V1)} oder ${$.per(V13)}. Dieselben tausend V-Bucks.`,
    problem: () => 'Der Unterschied ist nur, wie viele du auf einmal kaufst.',
    solution: ($) => `Bei ForgeMarket: tausend V-Bucks ${$.p(V1)}, ${$.size(V13)} für ${$.p(V13)}.`,
    cta: ($) => site($) },
  'ugc-18': {
    hook: () => 'Jede Season wieder V-Bucks kaufen?',
    problem: () => 'Immer ein kleines Paket, immer der höchste Preis pro tausend.',
    solution: ($) => `${$.size(V5)} V-Bucks für ${$.p(V5)}, oder ${$.size(V13)} für ${$.p(V13)}. Rechne pro tausend.`,
    cta: ($) => site($) },
  'ugc-19': {
    hook: () => 'Ich dachte, V-Bucks gibt es nur im Spiel.',
    problem: () => 'Da siehst du nie, was tausend kosten.',
    solution: ($) => `Bei ForgeMarket bekommst du einen V-Bucks-Code per E-Mail. Einlösen auf ${$.site('fortnite.com/vbuckscard')}.`,
    cta: ($) => site($) },
  'ugc-20': {
    hook: () => 'Zwanzig Euro Taschengeld. Wie viele V-Bucks?',
    problem: () => 'Mit kleinen Paketen holst du am wenigsten raus.',
    solution: ($) => `${$.size(V28)} V-Bucks kosten ${$.p(V28)}. Tausend einzeln kosten ${$.p(V1)}.`,
    cta: ($) => `Schau, was passt: ${site($)}` },
  'ugc-21': {
    hook: () => 'Ich habe keine Lust auf noch einen Account.',
    problem: () => 'Überall Passwörter, Newsletter, E-Mails bestätigen.',
    solution: () => 'Bei ForgeMarket bezahlst du als Gast.',
    cta: ($) => site($) },
  'ugc-22': {
    hook: () => 'Ich will einfach Robux kaufen. Kein Profil.',
    problem: () => 'Jede Seite will, dass du dich erst registrierst.',
    solution: ($) => `Hier nicht. Als Gast bezahlen, und deine Bestellung verfolgst du auf ${$.site('forgemarket.nl/track')}.`,
    cta: ($) => site($) },
  'ugc-23': {
    hook: () => 'Das Passwort von dieser einen Seite? Weg.',
    problem: () => 'Deshalb mache ich nirgends mehr einfach so einen Account.',
    solution: () => 'ForgeMarket: als Gast bezahlen.',
    cta: ($) => site($) },
  'ugc-24': {
    hook: () => 'Einmal was gekauft, und jetzt jeden Tag Mails.',
    problem: () => 'Account gemacht, Häkchen vergessen.',
    solution: () => 'Bei ForgeMarket kannst du als Gast bezahlen.',
    cta: ($) => site($) },
  'ugc-25': {
    hook: () => 'Ohne Account kann man seine Bestellung nicht verfolgen. Dachte ich.',
    problem: () => 'Ich wollte keinen Account, aber wissen, wo meine Bestellung bleibt.',
    solution: ($) => `Auf ${$.site('forgemarket.nl/track')} verfolgst du sie mit deiner Bestellnummer.`,
    cta: ($) => site($) },
  'ugc-26': {
    hook: () => 'Meine größte Angst beim Online-Kauf von Codes?',
    problem: () => 'Bezahlen und dann nichts bekommen.',
    solution: () => 'Bei ForgeMarket steht es schwarz auf weiß: nicht geliefert, Geld zurück.',
    cta: ($) => `Lies es selbst: ${$.site('forgemarket.nl/refunds')}` },
  'ugc-27': {
    hook: () => 'Bevor ich irgendwo bestelle, lese ich zuerst das hier.',
    problem: () => 'Die Rückerstattungsregeln. Da steckt meistens der Haken.',
    solution: ($) => `Bei ForgeMarket: nicht geliefert, Geld zurück. Steht auf ${$.site('forgemarket.nl/refunds')}.`,
    cta: () => 'Lies es und entscheide selbst.' },
  'ugc-28': {
    hook: () => '„Wo bleibt meine Bestellung?" Nie mehr raten.',
    problem: () => 'Bei manchen Shops hörst du nach dem Bezahlen nichts mehr.',
    solution: ($) => `Auf ${$.site('forgemarket.nl/track')} siehst du den Status deiner Bestellung.`,
    cta: ($) => site($) },
  'ugc-29': {
    hook: () => 'Ich mache immer einen Screenshot von den Rückerstattungsregeln.',
    problem: () => 'Man weiß nie, wann man sie braucht.',
    solution: () => 'Die von ForgeMarket sind kurz: nicht geliefert, Geld zurück.',
    cta: ($) => $.site('forgemarket.nl/refunds') },
  'ugc-30': {
    hook: () => 'Ich habe immer Fragen, bevor ich etwas bestelle.',
    problem: () => 'Bei vielen Shops findest du nirgends einen Menschen.',
    solution: () => 'ForgeMarket hat einen Discord, wo du einfach fragen kannst.',
    cta: ($) => $.site('forgemarket.nl/discord') },
  'ugc-31': {
    hook: () => 'Mein Kind wollte Robux. Ich wollte sein Passwort nicht rausgeben.',
    problem: () => 'Genau das verlangen viele Seiten.',
    solution: ($) => `Bei ForgeMarket nur den ${$.field(R1, 'acc')}, und ${fa($)} muss an sein.`,
    cta: ($) => site($) },
  'ugc-32': {
    hook: () => 'Meine Tochter wollte Steam-Guthaben. Meine Karte will ich nicht in ihrem Account.',
    problem: () => 'Dann kann sie damit einfach weiter kaufen.',
    solution: () => 'Ein Steam-Wallet-Code kommt per E-Mail. Sie löst ihn ein, deine Karte bleibt bei dir.',
    cta: ($) => site($) },
  'ugc-33': {
    hook: () => 'Was schenkt man einem Gamer, der schon alles hat?',
    problem: () => 'Man weiß nie, welches Spiel oder welches Item.',
    solution: () => 'Guthaben. V-Bucks, Robux oder ein Steam-Code. Dann sucht er selbst aus.',
    cta: ($) => site($) },
  'ugc-34': {
    hook: () => 'Mein Sohn gibt sein Taschengeld für kleine Robux-Pakete aus.',
    problem: ($) => `Tausend Robux für ${$.p(R1)}, immer wieder.`,
    solution: ($) => `Zusammen sparen für zehntausend: ${$.p(R10)}. Das sind ${$.per(R10)} pro tausend.`,
    cta: ($) => `Rechnet zusammen nach: ${site($)}` },
  'ugc-35': {
    hook: () => 'Mein Neffe will Spieleguthaben. Aber für welches Spiel?',
    problem: () => 'Er spielt Fortnite und Steam-Spiele. Ich verstehe nichts davon.',
    solution: () => 'Ein Steam- oder V-Bucks-Code kommt per E-Mail. Den gibst du einfach weiter.',
    cta: ($) => site($) },
  'ugc-36': {
    hook: () => 'Ich habe V-Bucks auf den falschen Account geladen.',
    problem: () => 'Eingeloggt mit dem Account von meinem Bruder. Weg.',
    solution: ($) => `Prüf auf ${$.site('fortnite.com/vbuckscard')} zuerst, wer eingeloggt ist. Dann erst der Code.`,
    cta: ($) => `V-Bucks-Codes auf ${site($)}`,
    checklist: () => ['Richtiger Account?', 'Dann erst einlösen', 'Code aus deiner E-Mail'] },
  'ugc-37': {
    hook: () => 'Mach das, bevor du einen Code einlöst.',
    problem: () => 'Einen eingelösten Code bekommst du nicht zurück.',
    solution: () => 'Schau, in welchem Account du eingeloggt bist. Dein Code kommt per E-Mail, du entscheidest, wann.',
    cta: ($) => site($) },
  'ugc-38': {
    hook: () => 'Steam-Guthaben auf dem falschen Account? Pech.',
    problem: () => 'Das Guthaben kannst du danach nicht mehr verschieben.',
    solution: () => 'Erst im richtigen Steam-Account einloggen, dann den Code einlösen.',
    cta: ($) => `Steam-Wallet-Codes auf ${site($)}`,
    checklist: () => ['Richtiger Steam-Account', 'Dann erst der Code', 'Code aus deiner E-Mail'] },
  'ugc-39': {
    hook: () => 'Ein Buchstabe falsch im Benutzernamen. Willst du nicht.',
    problem: () => 'Dann sucht die Lieferung den falschen Account.',
    solution: ($) => `Kopier deinen ${$.field(R1, 'acc')} direkt aus deinem Profil, wenn du bestellst.`,
    cta: ($) => site($) },
  'ugc-40': {
    hook: () => 'Teile deinen Geschenkcode nie in einem Gruppenchat.',
    problem: () => 'Wer ihn zuerst einlöst, hat ihn.',
    solution: () => 'Dein Code geht nur an deine eigene E-Mail. Lass ihn dort, bis du ihn benutzt.',
    cta: ($) => site($) },
  'ugc-41': {
    hook: () => 'Dieser eine Skin. Und knapp zu wenig VP.',
    problem: () => 'Im Spiel siehst du nicht, was tausend kosten.',
    solution: ($) => `Tausend VP für ${$.p('VAL-1000')}. ${$.size('VAL-2050')} VP für ${$.p('VAL-2050')}.`,
    cta: ($) => site($) },
  'ugc-42': {
    hook: () => 'Jeden Monat wieder Nitro kaufen?',
    problem: ($) => `Zwölf einzelne Monate sind ${$.m(12 * $.c('NITRO-1M'))}.`,
    solution: ($) => `Ein Monat kostet ${$.p('NITRO-1M')}. Ein Jahr ${$.p('NITRO-1Y')}.`,
    cta: ($) => `Rechne nach: ${site($)}` },
  'ugc-43': {
    hook: () => 'Minecoins in kleinen Häppchen kaufen?',
    problem: () => 'Dann zahlst du pro Coin am meisten.',
    solution: ($) => `${$.size('MC-1720')} Minecoins: ${$.p('MC-1720')}. ${$.size('MC-3500')}: ${$.p('MC-3500')}.`,
    cta: ($) => site($) },
  'ugc-44': {
    hook: () => 'Ich habe immer fünfhundert Gems auf einmal gekauft.',
    problem: ($) => `${$.p('COC-500')} pro Kauf. Das läppert sich.`,
    solution: ($) => `${$.size('COC-2500')} Gems kosten ${$.p('COC-2500')}. Fünfmal fünfhundert sind ${$.m(5 * $.c('COC-500'))}.`,
    cta: ($) => site($) },
  'ugc-45': {
    hook: () => 'Ultimate Team leert dir das Konto.',
    problem: () => 'Vor allem, wenn du immer kleine Pakete Points kaufst.',
    solution: ($) => `${$.size('EAFC-1600')} FC Points: ${$.p('EAFC-1600')}. ${$.size('EAFC-12000')}: ${$.p('EAFC-12000')}. Rechne pro tausend.`,
    cta: ($) => site($) },
  'ugc-46': {
    hook: () => '„Codes online kaufen ist immer Fake." Hör ich oft.',
    problem: () => 'Deshalb schaue ich zuerst auf eine Sache.',
    solution: () => 'Was passiert, wenn nichts kommt. Bei ForgeMarket: nicht geliefert, Geld zurück.',
    cta: ($) => $.site('forgemarket.nl/refunds') },
  'ugc-47': {
    hook: () => 'Du brauchst keinen Account, um zu bestellen.',
    problem: () => 'Viele denken, es muss sein, und brechen ab.',
    solution: () => 'Bei ForgeMarket bezahlst du als Gast.',
    cta: ($) => site($) },
  'ugc-48': {
    hook: () => '„Ein großes Paket ist rausgeworfenes Geld." Stimmt nicht immer.',
    problem: () => 'Pro tausend zahlst du bei kleinen Paketen sogar mehr.',
    solution: ($) => `V-Bucks: ${$.per(V1)} pro tausend im kleinsten Paket, ${$.per(V13)} im größten.`,
    cta: ($) => site($) },
  'ugc-49': {
    hook: () => 'Meine Checkliste, bevor ich Spieleguthaben kaufe.',
    problem: () => 'Passwort? Account nötig? Und wenn nichts kommt?',
    solution: () => 'ForgeMarket: kein Passwort, als Gast bezahlen, nicht geliefert heißt Geld zurück.',
    cta: ($) => site($),
    checklist: () => ['Kein Passwort', 'Als Gast bezahlen', 'Nicht geliefert? Geld zurück'] },
  'ugc-50': {
    hook: () => '„Wo kaufst du deine Robux?" Ehrliche Antwort.',
    problem: () => 'Irgendwo, wo man nie nach meinem Passwort fragt.',
    solution: ($) => `Bei ForgeMarket nur mein Benutzername. Tausend Robux, ${$.p(R1)}.`,
    cta: () => 'Link in Bio.' },
};
