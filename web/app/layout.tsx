import type { Metadata, Viewport } from 'next';
import './globals.css';
import SmoothScroll from '../components/SmoothScroll';
import Nav from '../components/Nav';
import Footer from '../components/Footer';

export const metadata: Metadata = {
  title: 'ForgeMarket — Premium Gaming Marketplace',
  description:
    'Buy game currency, top-ups and gift cards — delivered instantly, secured end-to-end, backed by a 120k+ gamer community. Robux, V-Bucks, Valorant, CoD, Genshin and more.',
  openGraph: {
    title: 'ForgeMarket — Level up, instantly.',
    description: 'The premium marketplace for game currency, top-ups and gift cards. Instant delivery, buyer-protected.',
    type: 'website',
    siteName: 'ForgeMarket',
  },
  twitter: { card: 'summary_large_image', title: 'ForgeMarket', description: 'Premium gaming marketplace — instant delivery.' },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#06060c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Orbitron:wght@500;600;700;800;900&family=Rajdhani:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SmoothScroll>
          <Nav />
          <main>{children}</main>
          <Footer />
        </SmoothScroll>
      </body>
    </html>
  );
}
