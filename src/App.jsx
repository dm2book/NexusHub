import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import StoreLayout from './layouts/StoreLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import AccountLayout from './layouts/AccountLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { PageLoader } from './components/ui.jsx';
import { usePageViews } from './lib/usePageViews.js';

// Eager: first-paint storefront pages (small, instant).
import HomeStore from './pages/HomeStore.jsx';
import Shop from './pages/Shop.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Login from './pages/Login.jsx';

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
const AdminFulfillment = lazy(() => import('./pages/admin/Fulfillment.jsx'));
const AdminEmails = lazy(() => import('./pages/admin/Emails.jsx'));
const AdminSupport = lazy(() => import('./pages/admin/Support.jsx'));
const AdminSecurity = lazy(() => import('./pages/admin/Security.jsx'));
const AdminSocialProof = lazy(() => import('./pages/admin/SocialProof.jsx'));
const AdminOperations = lazy(() => import('./pages/admin/Operations.jsx'));

export default function App() {
  usePageViews();   // anonymous, privacy-friendly visitor analytics
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Storefront home — self-contained light theme (own nav + sidebar) */}
        <Route path="/" element={<HomeStore />} />

        {/* Public + storefront (light theme) */}
        <Route element={<StoreLayout />}>
          <Route path="/shop" element={<Shop />} />
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
          <Route path="/trust" element={<Trust />} />
          <Route path="/terms" element={<Legal kind="terms" />} />
          <Route path="/privacy" element={<Legal kind="privacy" />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Route>

        {/* Customer dashboard */}
        <Route element={<ProtectedRoute><AccountLayout /></ProtectedRoute>}>
          <Route path="/account" element={<Dashboard />} />
          <Route path="/account/rewards" element={<Rewards />} />
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
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/suppliers" element={<AdminSuppliers />} />
          <Route path="/admin/fulfillment" element={<AdminFulfillment />} />
          <Route path="/admin/emails" element={<AdminEmails />} />
          <Route path="/admin/support" element={<AdminSupport />} />
          <Route path="/admin/social" element={<AdminSocialProof />} />
          <Route path="/admin/security" element={<AdminSecurity />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
