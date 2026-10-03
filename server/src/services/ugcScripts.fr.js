/**
 * Les cinquante scripts UGC en français — mêmes temps, produits, images et
 * calculs de prix que les scripts néerlandais de ugcScripts.js ; ici, seuls
 * les mots. Écrits comme parle un joueur, pas traduits mot à mot.
 */
const R1 = 'ROBUX-1000', R45 = 'ROBUX-4500', R10 = 'ROBUX-10000', R22 = 'ROBUX-22500';
const V1 = 'VBUCKS-1000', V28 = 'VBUCKS-2800', V5 = 'VBUCKS-5000', V13 = 'VBUCKS-13500';
const site = ($) => $.site('forgemarket.nl');
const fa = ($) => $.say('la 2FA', 'la double authentification');

export default {
  'ugc-01': {
    hook: () => 'Je croyais vraiment que les Robux gratuits marchaient…',
    problem: () => 'Tu mets ton pseudo, puis ton mot de passe. Et après, rien.',
    solution: ($) => `Les vrais Robux, c'est sans ton mot de passe. Tu donnes juste ton ${$.field(R1)}.`,
    cta: ($) => `Mille Robux, ${$.p(R1)}. ${site($)}` },
  'ugc-02': {
    hook: () => 'Ce « générateur de Robux » ne voulait qu\'une chose.',
    problem: () => 'Mon mot de passe. Pourquoi un vendeur en aurait besoin ?',
    solution: () => 'ForgeMarket ne demande que ton nom d\'utilisateur. Ton mot de passe reste à toi.',
    cta: ($) => `Vérifie toi-même : ${site($)}` },
  'ugc-03': {
    hook: () => 'Mon petit frère a cliqué sur un lien « Robux gratuits ».',
    problem: () => 'Il devait se connecter sur un site qui ressemblait à Roblox. Ce n\'était pas Roblox.',
    solution: () => 'Acheter des Robux, ça se fait sans se connecter ailleurs. Chez ForgeMarket, juste ton nom d\'utilisateur.',
    cta: ($) => `Montre-lui : ${site($)}` },
  'ugc-04': {
    hook: () => 'Dix mille Robux gratuits ? Non.',
    problem: () => 'Quand c\'est gratuit, tu paies avec ton compte.',
    solution: ($) => `Dix mille Robux sur ForgeMarket, c'est ${$.p(R10)}. Un prix, pas d'arnaque.`,
    cta: ($) => site($) },
  'ugc-05': {
    hook: () => 'J\'ai reçu un DM : « Tu veux des Robux gratuits ? »',
    problem: () => 'D\'abord ton mot de passe, puis la « vérification ». Tu connais.',
    solution: () => 'Je préfère les acheter. Juste mon nom d\'utilisateur, jamais mon mot de passe.',
    cta: () => 'Lien en bio.' },
  'ugc-06': {
    hook: () => 'Les joueurs Roblox font tout le temps cette erreur.',
    problem: () => 'Ils donnent leur mot de passe à quelqu\'un qui « s\'occupe des Robux ».',
    solution: () => 'Jamais besoin. Pour les Robux sur ForgeMarket, ton nom d\'utilisateur suffit.',
    cta: ($) => `${site($)}. Ton mot de passe reste à toi.` },
  'ugc-07': {
    hook: () => 'Active ça avant d\'acheter des Robux.',
    problem: ($) => `Sans ${fa($)}, ton compte est une porte ouverte.`,
    solution: ($) => `ForgeMarket ne livre que si ${fa($)} est activée, et ne demande que ton nom d'utilisateur.`,
    cta: ($) => `D'abord ${fa($)}, ensuite ${site($)}`,
    checklist: () => ['2FA activée', 'Juste ton nom d\'utilisateur', 'Jamais ton mot de passe'] },
  'ugc-08': {
    hook: () => 'Mon pote a perdu son compte Roblox.',
    problem: () => 'Il a donné son mot de passe pour des « Robux pas chers ».',
    solution: () => 'Tu peux acheter des Robux sans que personne n\'entre dans ton compte. Juste ton nom d\'utilisateur.',
    cta: ($) => site($) },
  'ugc-09': {
    hook: () => 'De quoi un vendeur de Robux a vraiment besoin ?',
    problem: () => 'Pas de ton mot de passe. Pas de ton code e-mail.',
    solution: ($) => `Chez ForgeMarket : ton ${$.field(R1)}. C'est tout.`,
    cta: ($) => `Mille Robux, ${$.p(R1)}. ${site($)}` },
  'ugc-10': {
    hook: () => 'Ma mère m\'a demandé : « Tu dois donner ton mot de passe ? »',
    problem: () => 'Sur beaucoup de ces sites, oui. C\'est pour ça qu\'elle n\'avait pas confiance.',
    solution: ($) => `Pas ici. Tu remplis seulement ton ${$.field(R1)}.`,
    cta: ($) => `Montre-lui : ${site($)}` },
  'ugc-11': {
    hook: () => 'J\'ai payé mes Robux trop cher. Par ma faute.',
    problem: ($) => `J'achetais toujours mille Robux pour ${$.p(R1)}.`,
    solution: ($) => `Dix mille, c'est ${$.p(R10)}. Soit ${$.per(R10)} les mille au lieu de ${$.per(R1)}.`,
    cta: ($) => `Fais le calcul : ${site($)}` },
  'ugc-12': {
    hook: () => 'Sors ta calculatrice deux secondes.',
    problem: ($) => `Mille Robux : ${$.p(R1)}. Ça paraît correct, non ?`,
    solution: ($) => `Avec ${$.size(R22)} Robux, tu paies ${$.per(R22)} les mille. Plus gros pack, prix plus bas les mille.`,
    cta: ($) => site($) },
  'ugc-13': {
    hook: () => 'Acheter quelques Robux chaque semaine ? Blague qui coûte cher.',
    problem: ($) => `Dix fois mille Robux : ${$.m(10 * $.c(R1))}.`,
    solution: ($) => `Dix mille d'un coup : ${$.p(R10)}. Ça fait ${$.m(10 * $.c(R1) - $.c(R10))} de moins.`,
    cta: ($) => site($) },
  'ugc-14': {
    hook: () => 'Maintenant j\'attends avant d\'acheter des Robux. Exprès.',
    problem: () => 'Chaque petit achat me coûtait plus cher les mille.',
    solution: ($) => `${$.size(R45)} Robux pour ${$.p(R45)}, c'est ${$.per(R45)} les mille. Mille à l'unité, c'est ${$.p(R1)}.`,
    cta: ($) => `Regarde : ${site($)}` },
  'ugc-15': {
    hook: () => 'Personne ne regarde le prix des mille Robux.',
    problem: () => 'Tu regardes le total et tu cliques.',
    solution: ($) => `Chez ForgeMarket, ça va de ${$.per(R1)} à ${$.per(R22)} les mille, selon le pack.`,
    cta: ($) => site($) },
  'ugc-16': {
    hook: () => 'Ça m\'a coûté trop cher en V-Bucks pendant des années.',
    problem: ($) => `J'achetais toujours le plus petit pack. Mille pour ${$.p(V1)}.`,
    solution: ($) => `Le pack de ${$.size(V13)} coûte ${$.p(V13)}. Soit ${$.per(V13)} les mille.`,
    cta: ($) => `Fais le calcul sur ${site($)}` },
  'ugc-17': {
    hook: ($) => `${$.per(V1)} ou ${$.per(V13)}. Les mêmes mille V-Bucks.`,
    problem: () => 'La seule différence, c\'est combien tu en prends d\'un coup.',
    solution: ($) => `Sur ForgeMarket : mille V-Bucks ${$.p(V1)}, ${$.size(V13)} pour ${$.p(V13)}.`,
    cta: ($) => site($) },
  'ugc-18': {
    hook: () => 'Racheter des V-Bucks à chaque saison ?',
    problem: () => 'Toujours un petit pack, toujours le prix le plus haut les mille.',
    solution: ($) => `${$.size(V5)} V-Bucks pour ${$.p(V5)}, ou ${$.size(V13)} pour ${$.p(V13)}. Calcule les mille.`,
    cta: ($) => site($) },
  'ugc-19': {
    hook: () => 'Je croyais qu\'on ne pouvait acheter des V-Bucks que dans le jeu.',
    problem: () => 'Là-dedans, tu ne vois jamais combien coûtent mille.',
    solution: ($) => `Sur ForgeMarket, tu reçois un code V-Bucks par e-mail. À utiliser sur ${$.site('fortnite.com/vbuckscard')}.`,
    cta: ($) => site($) },
  'ugc-20': {
    hook: () => 'Vingt euros d\'argent de poche. Combien de V-Bucks ?',
    problem: () => 'Avec les petits packs, tu en as le moins.',
    solution: ($) => `${$.size(V28)} V-Bucks coûtent ${$.p(V28)}. Mille à l'unité, c'est ${$.p(V1)}.`,
    cta: ($) => `Vois ce qui te va : ${site($)}` },
  'ugc-21': {
    hook: () => 'J\'ai pas envie d\'encore un compte.',
    problem: () => 'Des mots de passe partout, des newsletters, des e-mails à confirmer.',
    solution: () => 'Chez ForgeMarket, tu paies en tant qu\'invité.',
    cta: ($) => site($) },
  'ugc-22': {
    hook: () => 'Je veux juste des Robux. Pas de profil.',
    problem: () => 'Chaque site veut que tu t\'inscrives d\'abord.',
    solution: ($) => `Pas ici. Tu paies en invité, et tu suis ta commande sur ${$.site('forgemarket.nl/track')}.`,
    cta: ($) => site($) },
  'ugc-23': {
    hook: () => 'Le mot de passe de ce site-là ? Perdu.',
    problem: () => 'C\'est pour ça que je ne crée plus de compte partout.',
    solution: () => 'ForgeMarket : paiement en invité.',
    cta: ($) => site($) },
  'ugc-24': {
    hook: () => 'J\'ai acheté un truc une fois, et maintenant je reçois des mails tous les jours.',
    problem: () => 'Compte créé, case oubliée.',
    solution: () => 'Chez ForgeMarket, tu peux payer en tant qu\'invité.',
    cta: ($) => site($) },
  'ugc-25': {
    hook: () => 'Sans compte, impossible de suivre sa commande. C\'est ce que je croyais.',
    problem: () => 'Je ne voulais pas de compte, mais je voulais savoir où était ma commande.',
    solution: ($) => `Sur ${$.site('forgemarket.nl/track')}, tu la suis avec ton numéro de commande.`,
    cta: ($) => site($) },
  'ugc-26': {
    hook: () => 'Ma plus grande peur quand j\'achète des codes en ligne ?',
    problem: () => 'Payer, et ne rien recevoir.',
    solution: () => 'Chez ForgeMarket, c\'est écrit noir sur blanc : pas livré, remboursé.',
    cta: ($) => `Lis-le toi-même : ${$.site('forgemarket.nl/refunds')}` },
  'ugc-27': {
    hook: () => 'Avant de commander quelque part, je lis ça d\'abord.',
    problem: () => 'La politique de remboursement. C\'est souvent là qu\'est le piège.',
    solution: ($) => `Chez ForgeMarket : pas livré, remboursé. C'est sur ${$.site('forgemarket.nl/refunds')}.`,
    cta: () => 'Lis-la et décide toi-même.' },
  'ugc-28': {
    hook: () => '« Elle est où ma commande ? » Fini de deviner.',
    problem: () => 'Certaines boutiques ne donnent plus de nouvelles après le paiement.',
    solution: ($) => `Sur ${$.site('forgemarket.nl/track')}, tu vois le statut de ta commande.`,
    cta: ($) => site($) },
  'ugc-29': {
    hook: () => 'Je fais toujours une capture de la politique de remboursement.',
    problem: () => 'On ne sait jamais quand on en aura besoin.',
    solution: () => 'Celle de ForgeMarket est courte : pas livré, remboursé.',
    cta: ($) => $.site('forgemarket.nl/refunds') },
  'ugc-30': {
    hook: () => 'J\'ai toujours des questions avant de commander.',
    problem: () => 'Dans beaucoup de boutiques, impossible de trouver un humain.',
    solution: () => 'ForgeMarket a un Discord où tu peux simplement demander.',
    cta: ($) => $.site('forgemarket.nl/discord') },
  'ugc-31': {
    hook: () => 'Mon fils voulait des Robux. Je ne voulais pas donner son mot de passe.',
    problem: () => 'C\'est exactement ce que demandent beaucoup de sites.',
    solution: ($) => `Chez ForgeMarket, seulement le ${$.field(R1)}, et ${fa($)} doit être activée.`,
    cta: ($) => site($) },
  'ugc-32': {
    hook: () => 'Ma fille voulait du crédit Steam. Je ne veux pas ma carte sur son compte.',
    problem: () => 'Sinon elle peut continuer à acheter avec.',
    solution: () => 'Un code Steam Wallet arrive par e-mail. Elle l\'utilise, ta carte reste chez toi.',
    cta: ($) => site($) },
  'ugc-33': {
    hook: () => 'Qu\'est-ce qu\'on offre à un gamer qui a déjà tout ?',
    problem: () => 'On ne sait jamais quel jeu ni quel objet.',
    solution: () => 'Du crédit. Des V-Bucks, des Robux ou un code Steam. Il choisit lui-même.',
    cta: ($) => site($) },
  'ugc-34': {
    hook: () => 'Mon fils dépense son argent de poche en petits packs de Robux.',
    problem: ($) => `Mille Robux pour ${$.p(R1)}, encore et encore.`,
    solution: ($) => `Économiser ensemble pour dix mille : ${$.p(R10)}. Soit ${$.per(R10)} les mille.`,
    cta: ($) => `Faites le calcul ensemble : ${site($)}` },
  'ugc-35': {
    hook: () => 'Mon neveu veut du crédit de jeu. Mais pour quel jeu ?',
    problem: () => 'Il joue à Fortnite et à des jeux Steam. Je n\'y comprends rien.',
    solution: () => 'Un code Steam ou V-Bucks arrive par e-mail. Tu n\'as qu\'à le lui donner.',
    cta: ($) => site($) },
  'ugc-36': {
    hook: () => 'J\'ai mis des V-Bucks sur le mauvais compte.',
    problem: () => 'Connecté sur le compte de mon petit frère. Perdu.',
    solution: ($) => `Sur ${$.site('fortnite.com/vbuckscard')}, vérifie d'abord qui est connecté. Ensuite le code.`,
    cta: ($) => `Codes V-Bucks sur ${site($)}`,
    checklist: () => ['Le bon compte ?', 'Ensuite utiliser', 'Code dans ton e-mail'] },
  'ugc-37': {
    hook: () => 'Fais ça avant d\'utiliser un code.',
    problem: () => 'Un code utilisé ne revient pas.',
    solution: () => 'Regarde sur quel compte tu es connecté. Ton code arrive par e-mail, tu choisis quand.',
    cta: ($) => site($) },
  'ugc-38': {
    hook: () => 'Du crédit Steam sur le mauvais compte ? Dommage.',
    problem: () => 'Tu ne peux plus déplacer ce solde après.',
    solution: () => 'Connecte-toi d\'abord au bon compte Steam, puis utilise ton code.',
    cta: ($) => `Codes Steam Wallet sur ${site($)}`,
    checklist: () => ['Le bon compte Steam', 'Ensuite le code', 'Code dans ton e-mail'] },
  'ugc-39': {
    hook: () => 'Une lettre fausse dans ton pseudo. Tu ne veux pas ça.',
    problem: () => 'La livraison cherche alors le mauvais compte.',
    solution: ($) => `Copie ton ${$.field(R1)} directement depuis ton profil quand tu commandes.`,
    cta: ($) => site($) },
  'ugc-40': {
    hook: () => 'Ne partage jamais ton code cadeau dans un groupe.',
    problem: () => 'Le premier qui l\'utilise le garde.',
    solution: () => 'Ton code arrive seulement dans ton propre e-mail. Garde-le là jusqu\'à ce que tu l\'utilises.',
    cta: ($) => site($) },
  'ugc-41': {
    hook: () => 'Ce skin-là. Et juste pas assez de VP.',
    problem: () => 'Dans le jeu, tu ne vois pas combien coûtent mille.',
    solution: ($) => `Mille VP pour ${$.p('VAL-1000')}. ${$.size('VAL-2050')} VP pour ${$.p('VAL-2050')}.`,
    cta: ($) => site($) },
  'ugc-42': {
    hook: () => 'Racheter Nitro tous les mois ?',
    problem: ($) => `Douze mois un par un, ça fait ${$.m(12 * $.c('NITRO-1M'))}.`,
    solution: ($) => `Un mois coûte ${$.p('NITRO-1M')}. Un an, ${$.p('NITRO-1Y')}.`,
    cta: ($) => `Fais le calcul : ${site($)}` },
  'ugc-43': {
    hook: () => 'Acheter des Minecoins par petits bouts ?',
    problem: () => 'Tu paies alors le plus cher par coin.',
    solution: ($) => `${$.size('MC-1720')} Minecoins : ${$.p('MC-1720')}. ${$.size('MC-3500')} : ${$.p('MC-3500')}.`,
    cta: ($) => site($) },
  'ugc-44': {
    hook: () => 'J\'achetais toujours cinq cents gemmes à la fois.',
    problem: ($) => `${$.p('COC-500')} à chaque fois. Ça s'additionne.`,
    solution: ($) => `${$.size('COC-2500')} gemmes coûtent ${$.p('COC-2500')}. Cinq fois cinq cents, c'est ${$.m(5 * $.c('COC-500'))}.`,
    cta: ($) => site($) },
  'ugc-45': {
    hook: () => 'Ultimate Team vide ton porte-monnaie.',
    problem: () => 'Surtout quand tu prends toujours des petits packs de Points.',
    solution: ($) => `${$.size('EAFC-1600')} FC Points : ${$.p('EAFC-1600')}. ${$.size('EAFC-12000')} : ${$.p('EAFC-12000')}. Calcule les mille.`,
    cta: ($) => site($) },
  'ugc-46': {
    hook: () => '« Acheter des codes en ligne, c\'est toujours une arnaque. » Je l\'entends souvent.',
    problem: () => 'Alors je regarde d\'abord une chose.',
    solution: () => 'Ce qui se passe si rien n\'arrive. Chez ForgeMarket : pas livré, remboursé.',
    cta: ($) => $.site('forgemarket.nl/refunds') },
  'ugc-47': {
    hook: () => 'Pas besoin de compte pour commander.',
    problem: () => 'Beaucoup pensent que si, et abandonnent.',
    solution: () => 'Chez ForgeMarket, tu paies en tant qu\'invité.',
    cta: ($) => site($) },
  'ugc-48': {
    hook: () => '« Un gros pack, c\'est de l\'argent jeté. » Pas toujours.',
    problem: () => 'Rapporté aux mille, les petits packs coûtent même plus.',
    solution: ($) => `V-Bucks : ${$.per(V1)} les mille dans le plus petit pack, ${$.per(V13)} dans le plus grand.`,
    cta: ($) => site($) },
  'ugc-49': {
    hook: () => 'Ma checklist avant d\'acheter du crédit de jeu.',
    problem: () => 'Mot de passe ? Compte obligatoire ? Et si rien n\'arrive ?',
    solution: () => 'ForgeMarket : pas de mot de passe, paiement en invité, pas livré veut dire remboursé.',
    cta: ($) => site($),
    checklist: () => ['Pas de mot de passe', 'Paiement en invité', 'Pas livré ? Remboursé'] },
  'ugc-50': {
    hook: () => '« Tu achètes tes Robux où ? » Réponse honnête.',
    problem: () => 'Quelque part où on ne me demande jamais mon mot de passe.',
    solution: ($) => `Sur ForgeMarket, juste mon nom d'utilisateur. Mille Robux, ${$.p(R1)}.`,
    cta: () => 'Lien en bio.' },
};
