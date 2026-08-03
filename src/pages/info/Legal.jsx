import LegalDoc from '../../components/LegalDoc.jsx';
import { usePageMeta } from '../../lib/useMeta.js';
import { useI18n } from '../../lib/i18n.jsx';
import { LEGAL_DOCS } from '../../content/legal.js';

/**
 * Terms, privacy and cookies — one component, three documents.
 *
 * The content lives in src/content/legal.js as prose per language rather than as
 * translation keys. Legal text only means what it means as a whole; splitting a
 * paragraph across two hundred t() keys makes it possible to update one language
 * and silently leave the other stale, in the one place on the site where that
 * genuinely matters.
 */
export default function Legal({ kind = 'terms' }) {
  const { lang } = useI18n();
  const doc = LEGAL_DOCS[kind] || LEGAL_DOCS.terms;
  const d = lang === 'nl' ? doc.nl : doc.en;
  usePageMeta(d.title, d.meta);
  return <LegalDoc doc={doc} />;
}
