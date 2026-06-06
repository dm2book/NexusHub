import { useEffect } from 'react';

/**
 * Set the document title + meta description per page (lightweight SEO, no deps).
 * Restores nothing on unmount — the next page sets its own.
 */
export function usePageMeta(title, description) {
  useEffect(() => {
    if (title) document.title = `${title} · ForgeMarket`;
    if (description) {
      let tag = document.querySelector('meta[name="description"]');
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', 'description');
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', description);
    }
  }, [title, description]);
}
