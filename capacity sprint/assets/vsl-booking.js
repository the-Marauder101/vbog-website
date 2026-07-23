(() => {
  const body = document.body;
  const header = document.querySelector('[data-vsl-header]');
  const year = document.querySelector('[data-current-year]');
  const revealItems = document.querySelectorAll('.reveal');

  if (year) year.textContent = String(new Date().getFullYear());

  const updateHeader = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 18);
  };

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  if (!('IntersectionObserver' in window)) return;

  body.classList.add('js-ready');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: '0px 0px -8% 0px',
    threshold: 0.08
  });

  revealItems.forEach((item) => observer.observe(item));
})();
