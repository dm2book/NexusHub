# NexusHub Gaming Webshop - Complete Specification

## 1. Concept & Vision

NexusHub is een premium digitale gaming webshop die digitale producten verkoopt zoals Robux, Discord Nitro, gift cards en in-game currency. De webshop combineert een donker, futuristisch gaming design met naadloze Discord-community integratie. Het gevoel is dat van een high-end gaming platform - sleek, betrouwbaar, en gemeenschapsgericht.

## 2. Design Language

### Aesthetic Direction
Cyberpunk-gaming aesthetic met diepe donkere achtergronden en neon glow-effecten. Denk aan Riot Games ontmoet Discord - professionele gaming sfeer met community warmth.

### Color Palette
- **Primary Background**: #0a0a0f (deep space black)
- **Secondary Background**: #12121a (elevated surface)
- **Tertiary Background**: #1a1a2e (cards/containers)
- **Primary Accent**: #6366f1 (indigo/purple)
- **Secondary Accent**: #8b5cf6 (violet)
- **Gradient Start**: #6366f1
- **Gradient End**: #a855f7
- **Success**: #10b981
- **Warning**: #f59e0b
- **Error**: #ef4444
- **Text Primary**: #ffffff
- **Text Secondary**: #94a3b8
- **Text Muted**: #64748b

### Typography
- **Headings**: 'Orbitron', sans-serif (futuristic gaming feel)
- **Body**: 'Inter', sans-serif (clean readability)
- **Accents/Labels**: 'Rajdhani', sans-serif (tech/gaming labels)

### Spatial System
- Base unit: 4px
- Section padding: 80px vertical, responsive
- Card padding: 24px
- Gap between elements: 16px-24px
- Border radius: 8px (cards), 12px (buttons), 16px (large containers)

### Motion Philosophy
- Entrance animations: fade-up with 400ms ease-out, staggered 100ms
- Hover states: scale 1.02, glow intensifies, 200ms transition
- Page transitions: smooth crossfade 300ms
- Micro-interactions: pulse on important CTAs, shimmer on loading states

### Visual Assets
- Icons: Lucide React (consistent, clean)
- Images: Unsplash gaming imagery + custom SVG illustrations
- Decorative: Gradient orbs, grid patterns, subtle noise texture, glow effects

## 3. Layout & Structure

### Navigation (Fixed)
- Logo left
- Main nav center (Home, Shop, Discord, FAQ, Contact)
- Right: Search, Cart (with count badge), Account

### Page Structure
- **Home**: Hero (full viewport) → Popular Products → Features → Reviews → Discord CTA → Trust Badges → Footer
- **Shop**: Category filters sidebar + Product grid (responsive)
- **Product**: Image gallery → Details → Purchase options → Related products
- **Cart**: Item list → Summary → Checkout CTA
- **Checkout**: Multi-step (Info → Payment → Confirmation)
- **Account**: Dashboard tabs (Orders, Settings, Downloads)
- **Discord**: Server info → Channel structure → Roles → Join CTA
- **Info Pages**: FAQ, About, Terms, Privacy - centered content with sidebar navigation

### Responsive Strategy
- Desktop: Full layout with sidebars
- Tablet: Collapsed navigation, 2-column grids
- Mobile: Hamburger menu, single column, sticky bottom CTAs

## 4. Features & Interactions

### Core Features
- **Product Browsing**: Filter by category, sort by price/name/popularity
- **Cart Management**: Add/remove items, quantity adjustment, persistent storage
- **Checkout Flow**: Form validation, order summary, confirmation
- **Account System**: Login/register, order history, saved preferences
- **Discord Integration**: Embedded server preview, join button, role info

### Interaction Details
- **Add to Cart**: Button animates, cart icon pulses, toast notification appears
- **Product Hover**: Card lifts with shadow, quick-view overlay appears
- **Category Filter**: Smooth grid reorganization, active filter highlighted
- **Form Validation**: Real-time feedback, inline error messages
- **Loading States**: Skeleton screens with shimmer animation

### Edge Cases
- Empty cart: Illustrated empty state with CTA to shop
- Out of stock: Greyed card with "Notify Me" option
- Search no results: Friendly message with suggestions

## 5. Component Inventory

### Navigation
- States: default, scrolled (elevated), mobile-open
- Sticky with backdrop blur on scroll

### Product Card
- States: default, hover (lift + glow), out-of-stock (greyed), loading (skeleton)
- Badge for featured/new/popular items

### Button Variants
- Primary: Gradient background, glow hover
- Secondary: Outlined, fill on hover
- Ghost: Transparent, subtle hover background
- Sizes: sm, md, lg

### Input Fields
- States: default, focused (glow border), error (red border + message), disabled
- Floating labels with animation

### Toast Notifications
- Types: success (green), error (red), info (blue), warning (yellow)
- Auto-dismiss after 4 seconds with progress bar

### Modal
- Centered with backdrop blur
- Smooth scale-in animation
- Close on backdrop click or X button

## 6. Technical Approach

### Stack
- React 18 with Vite
- React Router for navigation
- Tailwind CSS for styling
- Lucide React for icons
- Local storage for cart persistence

### Architecture
- Pages: /, /shop, /product/:id, /cart, /checkout, /account, /discord, /faq, /contact, /about, /terms, /privacy
- Components organized by feature
- Context for cart state management
- Mock data for products and content

### Product Data Structure
```json
{
  "id": "string",
  "name": "string",
  "category": "robux|discord-nitro|playstation|xbox|steam|v-bucks",
  "description": "string",
  "price": number,
  "originalPrice": number | null,
  "image": "string",
  "inStock": boolean,
  "featured": boolean,
  "options": [{ "label": "string", "value": "string", "priceModifier": number }]
}
```

### Discord Server Data
- Server name, icon, member count, description
- Channel categories with channels
- Role hierarchy with colors and descriptions
- Features: tickets, verification, reviews, partners

## 7. Pages Content

### Home Page Sections
1. Hero: "Your Gaming Universe Awaits" + animated background + CTA
2. Popular Products: Grid of 8 featured products
3. Features: 4 cards (Instant Delivery, Secure Payments, 24/7 Support, Best Prices)
4. Reviews: 3 customer testimonials with ratings
5. Discord CTA: Join banner with server preview
6. Trust Section: Payment icons, security badges

### Shop Categories
- Robux (1000, 2000, 5000, 10000 options)
- Discord Nitro (Monthly, Yearly, Basic, Full)
- PlayStation Gift Cards (€10, €25, €50, €100)
- Xbox Gift Cards (€10, €25, €50, €100)
- Steam Gift Cards (€10, €25, €50, €100)
- Fortnite V-Bucks (1000, 2800, 5000, 13500)

### Discord Server Structure
**📢 INFORMATION**
- welcome
- rules
- announcements
- faq

**🛒 SHOP**
- products
- robux
- nitro
- giftcards
- orders

**💬 COMMUNITY**
- general
- gaming
- screenshots
- media

**⭐ REVIEWS**
- customer-reviews
- vouches

**🎫 SUPPORT**
- create-ticket
- support-chat

**🤝 PARTNERS**
- partnerships

**👑 STAFF**
- staff-chat
- staff-announcements

### Roles & Permissions
- 👑 Owner (Full control)
- Admin (Management access)
- Moderator (Community oversight)
- Support (Ticket handling)
- Seller (Product access)
- Customer (Base tier)
- VIP (Premium features)
- Partner (Collab access)