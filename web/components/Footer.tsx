import Link from 'next/link';
import { Zap, MessageCircle, ShieldCheck } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="relative border-t border-white/[0.06] mt-24 overflow-hidden">
      <div className="orb w-80 h-80 bg-primary/20 -bottom-40 left-1/3" />
      <div className="container-x relative py-14 grid gap-10 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}><Zap size={16} /></span>
            <span className="font-display">ForgeMarket</span>
          </div>
          <p className="text-slate-500 text-sm">The premium marketplace for digital gaming goods — delivered instantly, backed by a real community.</p>
          <div className="flex items-center gap-2 mt-4 text-sm text-emerald-300"><ShieldCheck size={16} /> Secure &amp; verified</div>
        </div>
        <FooterCol title="Shop" links={[['All products', '/shop'], ['Robux', '/shop?c=robux'], ['V-Bucks', '/shop?c=v-bucks'], ['Track order', '/shop']]} />
        <FooterCol title="Company" links={[['Why us', '/#trust'], ['Reviews', '/#reviews'], ['FAQ', '/#faq'], ['Community', '/#community']]} />
        <div>
          <h4 className="font-tech uppercase tracking-wider text-sm mb-4">Community</h4>
          <a href="https://discord.gg" target="_blank" rel="noreferrer" className="btn-discord text-sm"><MessageCircle size={16} /> Join Discord</a>
        </div>
      </div>
      <div className="container-x border-t border-white/[0.06] py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-500 text-sm">
        <span>© {new Date().getFullYear()} ForgeMarket. All rights reserved.</span>
        <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> All systems operational</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="font-tech uppercase tracking-wider text-sm mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {links.map(([label, href]) => <li key={label}><Link href={href} className="text-slate-400 hover:text-white text-sm transition">{label}</Link></li>)}
      </ul>
    </div>
  );
}
