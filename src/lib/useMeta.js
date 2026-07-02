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

/**
 * Inject a schema.org JSON-LD block (Product, Organization, …) for rich search
 * results. Pass null/undefined to render nothing; the tag is removed on unmount
 * so structured data never leaks onto the next page.
 */
export function useJsonLd(id, data) {
  const json = data ? JSON.stringify(data) : '';
  useEffect(() => {
    if (!json) return undefined;
    let tag = document.getElementById(`jsonld-${id}`);
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = `jsonld-${id}`;
      document.head.appendChild(tag);
    }
    tag.textContent = json;
    return () => tag.remove();
  }, [id, json]);
}
