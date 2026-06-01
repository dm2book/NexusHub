# 🚀 NexusHub Deploy Guide

## Optie 1: GitHub + Vercel (Automatisch - Aanbevolen)

### Stap 1: Push naar GitHub
```bash
git init
git add .
git commit -m "NexusHub - Gaming Webshop"
git branch -M main
git remote add origin https://github.com/JOUW-USERNAME/gamehub.git
git push -u origin main
```

### Stap 2: Vercel Setup
1. Ga naar [vercel.com](https://vercel.com) en log in
2. Click "Add New..." → "Project"
3. Import je GitHub repository "gamehub"
4. Framework: Vite (automatisch gedetecteerd)
5. Click "Deploy"

✅ Klaar! Je site is nu live op een Vercel subdomein.

---

## Optie 2: Handmatig Deployen (Snel)

### Stap 1: Download het project
De `dist` folder bevat je gecompileerde website.

### Stap 2: Ga naar Vercel
1. Ga naar [vercel.com](https://vercel.com)
2. Log in of maak account
3. Click "Add New..." → "Project"
4. Scroll naar beneden en click "Import Third-Party Git Repository..."
5. Of direct uploaden met "Or drop a folder here"

### Stap 3: Upload de bestanden
- Sleep de hele project folder naar Vercel
- Vercel detecteert automatisch dat het een Vite project is

✅ Klaar!

---

## Optie 3: Via Terminal (Met Vercel CLI)

```bash
# Installeer Vercel CLI
npm i -g vercel

# Log in
vercel login

# Deploy
vercel

# Voor productie
vercel --prod
```

---

## Je site is klaar voor deployment!

### Check wat er gebouwd is:
```
dist/
├── index.html
└── assets/
    ├── index-Cydel2-0.css (32 KB)
    └── index-DH5817Wq.js (300 KB)
```

### Alle pagina's werken:
- ✅ Home (/)
- ✅ Shop (/shop)
- ✅ Product detail (/product/:id)
- ✅ Winkelwagen (/cart)
- ✅ Checkout (/checkout)
- ✅ Account (/account)
- ✅ Discord (/discord)
- ✅ FAQ (/faq)
- ✅ Contact (/contact)
- ✅ Over Ons (/about)
- ✅ Algemene Voorwaarden (/terms)
- ✅ Privacybeleid (/privacy)