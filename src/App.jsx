import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import StoreLayout from './layouts/StoreLayout.jsx';
// Split out of the main bundle. Every visitor who came to buy Robux was
// downloading the admin console's shell and the account dashboard's shell
// before the shop could render — neither of which they will ever open.
const AdminLayout = lazy(() => import('./layouts/AdminLayout.jsx'));
const AccountLayout = lazy(() => import('./layouts/AccountLayout.jsx'));
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { PageLoader } from './components/ui.jsx';
import { usePageViews } from './lib/usePageViews.js';
import { useAdAttribution } from './lib/useAdAttribution.js';
import RouteProgress from './components/RouteProgress.jsx';

/* Eager: the launch banner, and nothing else with a page in it.
   Shop, ProductDetail and Login used to be eager too, on the reasoning that
   they are first-paint storefront pages. They are — but only ever one of them
   at a time, and bundling all four meant somebody landing on the homepage
   downloaded the catalogue page, the product page and the sign-in form before
   the homepage could render. Measured: 64 KB of compressed JavaScript in one
   entry chunk, arriving at 1420 ms on Slow 4G with everything waiting on it.

   The homepage went the same way for the same reason in reverse: it was the
   one page kept eager, which meant /login, /cart and /discord each parsed and
   compiled fifty kilobytes of homepage they would never render.

   Split, each of them costs a round trip to discover — which is why
   scripts/prerender.mjs announces the right chunk in each route's HTML, and
   server/src/routes/seo.js does the same for product pages. The chunk is then
   already in flight before the main bundle has finished parsing, and the split
   costs nothing on the page that needs it. */
import LaunchBanner from './components/store/LaunchBanner.jsx';
const HomeStore = lazy(() => import('./pages/HomeStore.jsx'));
const Shop = lazy(() => import('./pages/Shop.jsx'));
const ProductDetail = lazy(() => import('./pages/ProductDetail.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));

// Lazy: everything else is split into its own chunk so customers never download
// the admin console / account / info code on first load.
const Cart = lazy(() => import('./pages/Cart.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const CheckoutSuccess = lazy(() => import('./pages/CheckoutSuccess.jsx'));
const Discord = lazy(() => import('./pages/Discord.jsx'));
const Track = lazy(() => import('./pages/Track.jsx'));
const AuthCallback = lazy(() => import('./pages/AuthCallback.jsx'));
const About = lazy(() => import('./pages/info/About.jsx'));
const Contact = lazy(() => import('./pages/info/Contact.jsx'));
const Faq = lazy(() => import('./pages/info/Faq.jsx'));
const PaymentMethods = lazy(() => import('./pages/info/PaymentMethods.jsx'));
const HowItWorks = lazy(() => import('./pages/info/HowItWorks.jsx'));
const Refunds = lazy(() => import('./pages/info/Refunds.jsx'));
const Reviews = lazy(() => import('./pages/info/Reviews.jsx'));
const Drops = lazy(() => import('./pages/info/Drops.jsx'));
const Legal = lazy(() => import('./pages/info/Legal.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const Wishlist = lazy(() => import('./pages/Wishlist.jsx'));
const Trust = lazy(() => import('./pages/Trust.jsx'));

const Dashboard = lazy(() => import('./pages/account/Dashboard.jsx'));
const Orders = lazy(() => import('./pages/account/Orders.jsx'));
const OrderDetail = lazy(() => import('./pages/account/OrderDetail.jsx'));
const Downloads = lazy(() => import('./pages/account/Downloads.jsx'));
const Tickets = lazy(() => import('./pages/account/Tickets.jsx'));
const TicketDetail = lazy(() => import('./pages/account/TicketDetail.jsx'));
const Billing = lazy(() => import('./pages/account/Billing.jsx'));
const Notifications = lazy(() => import('./pages/account/Notifications.jsx'));
const Settings = lazy(() => import('./pages/account/Settings.jsx'));
const Rewards = lazy(() => import('./pages/account/Rewards.jsx'));
const ForgeShop = lazy(() => import('./pages/account/ForgeShop.jsx'));
const WalletPage = lazy(() => import('./pages/account/Wallet.jsx'));
const Referrals = lazy(() => import('./pages/account/Referrals.jsx'));
const Profile = lazy(() => import('./pages/account/Profile.jsx'));

const AdminAnalytics = lazy(() => import('./pages/admin/Analytics.jsx'));
const AdminOrders = lazy(() => import('./pages/admin/Orders.jsx'));
const AdminOrderDetail = lazy(() => import('./pages/admin/OrderDetail.jsx'));
const AdminProducts = lazy(() => import('./pages/admin/Products.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/Users.jsx'));
const AdminPayments = lazy(() => import('./pages/admin/Payments.jsx'));
const AdminSuppliers = lazy(() => import('./pages/admin/Suppliers.jsx'));
const AdminMarket = lazy(() => import('./pages/admin/Market.jsx'));
const AdminFulfillment = lazy(() => import('./pages/admin/Fulfillment.jsx'));
const AdminEmails = lazy(() => import('./pages/admin/Emails.jsx'));
const AdminSupport = lazy(() => import('./pages/admin/Support.jsx'));
const AdminSecurity = lazy(() => import('./pages/admin/Security.jsx'));
const AdminSocialProof = lazy(() => import('./pages/admin/SocialProof.jsx'));
const AdminOperations = lazy(() => import('./pages/admin/Operations.jsx'));
const AdminMonetization = lazy(() => import('./pages/admin/Monetization.jsx'));
const AdminCategories = lazy(() => import('./pages/admin/Categories.jsx'));

export default function App() {
  usePageViews();      // anonymous, privacy-friendly visitor analytics
  useAdAttribution();  // which advert this visitor arrived from, if any
  return (
    <>
    {/* Above <Routes>, not inside a layout.
        The storefront home is deliberately self-contained and sits OUTSIDE
        StoreLayout, so a banner mounted there appears on every page except the
        one that matters most — which is exactly the mistake StoreLayout's own
        comment records about the previous banner. One mount here cannot drift
        away from the routes, and it renders nothing once the shop is open. */}
    <LaunchBanner />
    <RouteProgress />
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Storefront home — self-contained light theme (own nav + sidebar) */}
        <Route path="/" element={<HomeStore />} />

        {/* Public + storefront (light theme) */}
        <Route element={<StoreLayout />}>
          <Route path="/shop" element={<Shop />} />
          {/* Landing pages for what this shop is actually searched for. Each
              renders the same Shop already filtered, with its own heading,
              title, description and canonical — see src/content/seo.js. A
              query string (?category=robux) is crawlable but reads as a
              filtered view of one page rather than a page about Robux. */}
          <Route path="/robux" element={<Shop landingCategory="robux" landingTitle="Robux"
            landingSub="Robux voor je Roblox-account. Op voorraad gaat automatisch de deur uit; de rest zetten we met de hand voor je klaar." />} />
          <Route path="/v-bucks" element={<Shop landingCategory="v-bucks" landingTitle="V-Bucks"
            landingSub="V-Bucks voor Fortnite, betaald met iDEAL. Automatisch geleverd wanneer we voorraad hebben." />} />
          <Route path="/valorant-points" element={<Shop landingCategory="valorant" landingTitle="Valorant Points"
            landingSub="Valorant Points (VP) met iDEAL. Automatisch als het op voorraad staat, anders met de hand binnen een paar uur." />} />
          <Route path="/giftcards" element={<Shop landingCategory="giftcard" landingTitle="Giftcards"
            landingSub="Digitale giftcards voor Steam, PlayStation, Xbox en meer. De code komt per e-mail." />} />
          <Route path="/game-currency" element={<Shop landingCategory="" landingTitle="Game currency"
            landingSub="Alle game currency op één plek: Robux, V-Bucks, Valorant Points en meer." />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/discord" element={<Discord />} />
          <Route path="/track" element={<Track />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/payment-methods" element={<PaymentMethods />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/refunds" element={<Refunds />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/drops" element={<Drops />} />
          <Route path="/trust" element={<Trust />} />
          <Route path="/terms" element={<Legal kind="terms" />} />
          <Route path="/privacy" element={<Legal kind="privacy" />} />
          <Route path="/cookies" element={<Legal kind="cookies" />} />
          {/* Dutch-language aliases: these are the URLs people type and the ones
              a link in an email or a Discord message tends to use. */}
          <Route path="/voorwaarden" element={<Legal kind="terms" />} />
          <Route path="/privacybeleid" element={<Legal kind="privacy" />} />
          <Route path="/cookiebeleid" element={<Legal kind="cookies" />} />
          <Route path="/retourbeleid" element={<Refunds />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Route>

        {/* Customer dashboard */}
        <Route element={<ProtectedRoute><AccountLayout /></ProtectedRoute>}>
          <Route path="/account" element={<Dashboard />} />
          <Route path="/account/rewards" element={<Rewards />} />
          <Route path="/account/forge-shop" element={<ForgeShop />} />
          <Route path="/account/wallet" element={<WalletPage />} />
          <Route path="/account/referrals" element={<Referrals />} />
          <Route path="/account/orders" element={<Orders />} />
          <Route path="/account/orders/:id" element={<OrderDetail />} />
          <Route path="/account/downloads" element={<Downloads />} />
          <Route path="/account/tickets" element={<Tickets />} />
          <Route path="/account/tickets/:id" element={<TicketDetail />} />
          <Route path="/account/billing" element={<Billing />} />
          <Route path="/account/notifications" element={<Notifications />} />
          <Route path="/account/profile" element={<Profile />} />
          <Route path="/account/settings" element={<Profile />} />
        </Route>

        {/* Admin */}
        <Route element={<ProtectedRoute staff><AdminLayout /></ProtectedRoute>}>
          <Route path="/admin" element={<AdminAnalytics />} />
          <Route path="/admin/operations" element={<AdminOperations />} />
          <Route path="/admin/orders" element={<AdminOrders />} />
          <Route path="/admin/orders/:id" element={<AdminOrderDetail />} />
          <Route path="/admin/payments" element={<AdminPayments />} />
          <Route path="/admin/products" element={<AdminProducts />} />
          <Route path="/admin/categories" element={<AdminCategories />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/suppliers" element={<AdminSuppliers />} />
          <Route path="/admin/market" element={<AdminMarket />} />
          <Route path="/admin/fulfillment" element={<AdminFulfillment />} />
          <Route path="/admin/emails" element={<AdminEmails />} />
          <Route path="/admin/support" element={<AdminSupport />} />
          <Route path="/admin/social" element={<AdminSocialProof />} />
          <Route path="/admin/monetization" element={<AdminMonetization />} />
          <Route path="/admin/security" element={<AdminSecurity />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
    </>
  );
}
