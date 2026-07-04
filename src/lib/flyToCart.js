/**
 * "Fly to cart" — clones the product media and arcs it into the nav cart icon,
 * then pops the cart badge. Pure decoration: any failure is swallowed, and
 * reduced-motion users just get the badge pop.
 */
export function flyToCart(sourceEl) {
  try {
    const cart = document.querySelector('[data-cart-target]');
    if (!cart) return;
    const pop = () => {
      cart.classList.remove('fm-cart-pop');
      void cart.offsetWidth; // restart the animation if it's mid-flight
      cart.classList.add('fm-cart-pop');
    };
    if (!sourceEl || matchMedia('(prefers-reduced-motion: reduce)').matches) return pop();

    const s = sourceEl.getBoundingClientRect();
    const c = cart.getBoundingClientRect();
    if (!s.width || !c.width) return pop();

    const clone = sourceEl.cloneNode(true);
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${s.left}px`,
      top: `${s.top}px`,
      width: `${s.width}px`,
      height: `${s.height}px`,
      margin: '0',
      zIndex: '9999',
      pointerEvents: 'none',
      borderRadius: '14px',
      objectFit: 'contain',
      transition: 'transform .6s cubic-bezier(.35,.7,.25,1), opacity .6s ease',
      willChange: 'transform, opacity',
    });
    document.body.appendChild(clone);

    const dx = c.left + c.width / 2 - (s.left + s.width / 2);
    const dy = c.top + c.height / 2 - (s.top + s.height / 2);
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(.12) rotate(10deg)`;
      clone.style.opacity = '0.3';
    });
    setTimeout(() => { clone.remove(); pop(); }, 610);
  } catch { /* decorative only — never break add-to-cart */ }
}
