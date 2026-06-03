import { Routes, Route } from 'react-router-dom';
import SiteLayout from './layouts/SiteLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import AccountLayout from './layouts/AccountLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

import Home from './pages/Home.jsx';
import Shop from './pages/Shop.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import Discord from './pages/Discord.jsx';
import Track from './pages/Track.jsx';
import Login from './pages/Login.jsx';
import AuthCallback from './pages/AuthCallback.jsx';

import Dashboard from './pages/account/Dashboard.jsx';
import Orders from './pages/account/Orders.jsx';
import OrderDetail from './pages/account/OrderDetail.jsx';
import Downloads from './pages/account/Downloads.jsx';
import Tickets from './pages/account/Tickets.jsx';
import TicketDetail from './pages/account/TicketDetail.jsx';
import Billing from './pages/account/Billing.jsx';
import Notifications from './pages/account/Notifications.jsx';
import Settings from './pages/account/Settings.jsx';

import AdminAnalytics from './pages/admin/Analytics.jsx';
import AdminOrders from './pages/admin/Orders.jsx';
import AdminOrderDetail from './pages/admin/OrderDetail.jsx';
import AdminProducts from './pages/admin/Products.jsx';
import AdminSuppliers from './pages/admin/Suppliers.jsx';
import AdminFulfillment from './pages/admin/Fulfillment.jsx';
import AdminEmails from './pages/admin/Emails.jsx';
import AdminSupport from './pages/admin/Support.jsx';
import AdminSecurity from './pages/admin/Security.jsx';

import About from './pages/info/About.jsx';
import Contact from './pages/info/Contact.jsx';
import Faq from './pages/info/Faq.jsx';
import Legal from './pages/info/Legal.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <Routes>
      {/* Public + storefront */}
      <Route element={<SiteLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/discord" element={<Discord />} />
        <Route path="/track" element={<Track />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Route>

      {/* Customer dashboard */}
      <Route element={<ProtectedRoute><AccountLayout /></ProtectedRoute>}>
        <Route path="/account" element={<Dashboard />} />
        <Route path="/account/orders" element={<Orders />} />
        <Route path="/account/orders/:id" element={<OrderDetail />} />
        <Route path="/account/downloads" element={<Downloads />} />
        <Route path="/account/tickets" element={<Tickets />} />
        <Route path="/account/tickets/:id" element={<TicketDetail />} />
        <Route path="/account/billing" element={<Billing />} />
        <Route path="/account/notifications" element={<Notifications />} />
        <Route path="/account/settings" element={<Settings />} />
      </Route>

      {/* Admin */}
      <Route element={<ProtectedRoute staff><AdminLayout /></ProtectedRoute>}>
        <Route path="/admin" element={<AdminAnalytics />} />
        <Route path="/admin/orders" element={<AdminOrders />} />
        <Route path="/admin/orders/:id" element={<AdminOrderDetail />} />
        <Route path="/admin/products" element={<AdminProducts />} />
        <Route path="/admin/suppliers" element={<AdminSuppliers />} />
        <Route path="/admin/fulfillment" element={<AdminFulfillment />} />
        <Route path="/admin/emails" element={<AdminEmails />} />
        <Route path="/admin/support" element={<AdminSupport />} />
        <Route path="/admin/security" element={<AdminSecurity />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
