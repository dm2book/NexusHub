import { Link } from 'react-router-dom';
import { Zap, ShieldCheck, Headphones, Globe, Rocket } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { useI18n } from '../../lib/i18n.jsx';

const VALUES = [
  { icon: Zap, key: 'speed', title: 'Speed', text: 'Automated fulfillment means most orders are delivered in seconds.' },
  { icon: ShieldCheck, key: 'trust', title: 'Trust', text: 'Fraud screening, audit logs and secure passwordless accounts.' },
  { icon: Headphones, key: 'care', title: 'Care', text: '24/7 support and a refund flow built into every order.' },
  { icon: Globe, key: 'scale', title: 'Scale', text: 'A multi-supplier engine that sources resiliently across providers.' },
];

export default function About() {
  const { t } = useI18n();
  return (
    <InfoShell eyebrow={t('about.eyebrow', 'About us')} title={t('about.title', 'Digital goods, done right')}
      subtitle={t('about.sub', 'ForgeMarket is a modern marketplace for digital goods — built on real fulfillment, security and support infrastructure.')} narrow={false}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
        {VALUES.map(({ icon: Icon, key, title, text }) => (
          <div key={title} className="card p-6">
            <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center mb-4"><Icon size={20} className="text-primary" /></div>
            <h3 className="text-white mb-1.5">{t(`about.${key}`, title)}</h3>
            <p className="text-slate-400 text-sm">{t(`about.${key}Sub`, text)}</p>
          </div>
        ))}
      </div>
      <div className="card p-8 text-center max-w-2xl mx-auto">
        <Rocket className="mx-auto text-indigo-300 mb-4" size={32} />
        <h2 className="text-2xl text-white">{t('about.ready', 'Ready to get started?')}</h2>
        <p className="text-slate-400 mt-2">{t('about.readySub', 'Browse the shop or join our community on Discord.')}</p>
        <div className="flex justify-center gap-3 mt-6">
          <Link to="/shop" className="btn-primary">{t('home.shopNow', 'Shop now')}</Link>
          <Link to="/discord" className="btn-ghost">{t('home.joinBtn', 'Join Discord')}</Link>
        </div>
      </div>
    </InfoShell>
  );
}
