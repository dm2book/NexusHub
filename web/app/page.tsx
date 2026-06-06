import Link from 'next/link';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { getProducts } from '../lib/api';
import Hero from '../components/Hero';
import TrustBar from '../components/TrustBar';
import Marketplace from '../components/Marketplace';
import Community from '../components/Community';
import Faq from '../components/Faq';
import { Stats, HowItWorks, Reviews } from '../components/Sections';

export default async function HomePage() {
  const products = await getProducts();
  return (
    <>
      <Hero />
      <TrustBar />
      <Stats />
      <Marketplace products={products} />
      <HowItWorks />
      <Reviews />
      <Community />
      <Faq />

      {/* Closing CTA */}
      <section className="container-x pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 p-10 sm:p-16 text-center">
          <div className="absolute inset-0 bg-grid opacity-30" />
          <div className="orb w-96 h-96 bg-secondary/30 -top-32 right-10" />
          <div className="relative">
            <h2 className="text-3xl sm:text-5xl">Ready to <span className="gradient-text">level up?</span></h2>
            <p className="text-slate-300 mt-4 max-w-xl mx-auto">Instant delivery, buyer protection and a community that has your back.</p>
            <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
              <Link href="/shop" className="btn-primary px-7 py-4 text-base">Shop now <ArrowRight size={18} /></Link>
              <a href="https://discord.gg" target="_blank" rel="noreferrer" className="btn-discord px-7 py-4 text-base"><MessageCircle size={18} /> Join Discord</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
