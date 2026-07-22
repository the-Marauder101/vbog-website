(() => {
  const calculator = document.querySelector('#refusal-calculator');
  const header = document.querySelector('[data-header]');
  const mobileSticky = document.querySelector('[data-mobile-sticky]');

  const fields = calculator ? {
    retainer: calculator.querySelector('#r3-retainer'),
    refusedUnits: calculator.querySelector('#r3-refused'),
    retentionMonths: calculator.querySelector('#r3-retention'),
    margin: calculator.querySelector('#r3-margin'),
    targetUnits: calculator.querySelector('#r3-target'),
    fillProbability: calculator.querySelector('#r3-fill'),
    founderHours: calculator.querySelector('#r3-founder-hours'),
    founderHourValue: calculator.querySelector('#r3-hour-value')
  } : null;

  const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
  const roundTo = (value, interval = 50000) => Math.round(value / interval) * interval;

  const formatMoney = (value) => {
    const absolute = Math.max(0, Number(value) || 0);
    if (absolute >= 10000000) {
      const crores = absolute / 10000000;
      return `₹${crores >= 10 ? Math.round(crores) : crores.toFixed(1).replace('.0', '')}Cr`;
    }
    if (absolute >= 100000) {
      const lakhs = absolute / 100000;
      return `₹${lakhs >= 100 ? Math.round(lakhs) : lakhs.toFixed(1).replace('.0', '')}L`;
    }
    if (absolute >= 1000) return `₹${Math.round(absolute / 1000)}K`;
    return `₹${Math.round(absolute)}`;
  };

  const setAll = (selector, value) => {
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = value;
    });
  };

  const calculate = () => {
    if (!fields) return;

    const retainer = clamp(fields.retainer.value, 25000, 1000000);
    const refusedUnits = clamp(fields.refusedUnits.value, 0, 20);
    const retentionMonths = clamp(fields.retentionMonths.value, 1, 24);
    const margin = clamp(fields.margin.value, 10, 80) / 100;
    const targetUnits = clamp(fields.targetUnits.value, 1, 15);
    const fillProbability = clamp(fields.fillProbability.value, 10, 100) / 100;
    const founderHours = clamp(fields.founderHours.value, 0, 40);
    const founderHourValue = clamp(fields.founderHourValue.value, 0, 50000);

    const refusedGross = roundTo(retainer * refusedUnits * retentionMonths);
    const refusedContribution = roundTo(refusedGross * margin);

    const capacityMonths = Math.min(retentionMonths, 12);
    const capacityMidpoint = roundTo(retainer * targetUnits * capacityMonths * fillProbability);
    const capacityLow = roundTo(capacityMidpoint * 0.85);
    const capacityHigh = roundTo(capacityMidpoint * 1.15);
    const capacityContribution = roundTo(capacityMidpoint * margin);

    const releasedHours = Math.round(founderHours * 48);
    const founderValue = roundTo(releasedHours * founderHourValue);

    const monthlyContribution = retainer * targetUnits * fillProbability * margin;
    const roundedMonthlyContribution = roundTo(monthlyContribution, 5000);
    const paybackMonths = monthlyContribution > 0 ? 400000 / monthlyContribution : 0;
    const paybackLabel = paybackMonths > 0 ? `${Math.min(paybackMonths, 99).toFixed(1).replace('.0', '')} months` : '—';

    setAll('[data-refused-gross]', formatMoney(refusedGross));
    setAll('[data-refused-contribution]', formatMoney(refusedContribution));
    setAll('[data-refused-units]', String(refusedUnits));
    setAll('[data-retainer-short]', formatMoney(retainer));
    setAll('[data-retention]', String(retentionMonths));
    setAll('[data-margin]', `${Math.round(margin * 100)}%`);
    setAll('[data-target]', String(targetUnits));
    setAll('[data-fill]', `${Math.round(fillProbability * 100)}%`);
    setAll('[data-capacity-months]', String(capacityMonths));
    setAll('[data-capacity-range]', `${formatMoney(capacityLow)}–${formatMoney(capacityHigh)}`);
    setAll('[data-capacity-midpoint]', formatMoney(capacityMidpoint));
    setAll('[data-capacity-contribution]', formatMoney(capacityContribution));
    setAll('[data-founder-hours]', String(founderHours));
    setAll('[data-released-hours]', `${releasedHours.toLocaleString('en-IN')} hrs`);
    setAll('[data-founder-value]', formatMoney(founderValue));
    setAll('[data-monthly-contribution]', formatMoney(roundedMonthlyContribution));
    setAll('[data-payback-months]', paybackLabel);
  };

  if (calculator) {
    calculator.addEventListener('submit', (event) => event.preventDefault());
    Object.values(fields).forEach((field) => {
      field.addEventListener('input', calculate);
      field.addEventListener('change', calculate);
    });
    calculate();
  }

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px' });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const onScroll = () => {
    const scrolled = window.scrollY > 24;
    if (header) header.classList.toggle('is-scrolled', scrolled);
    if (mobileSticky) mobileSticky.classList.toggle('is-visible', window.scrollY > 640);
  };

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  document.querySelectorAll('[data-track]').forEach((link) => {
    link.addEventListener('click', () => {
      const eventName = link.dataset.track || 'cta_click';
      const pageVariant = document.body.dataset.pageVariant || 'revenue_refusal';
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, { page_variant: pageVariant });
      }
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: eventName, page_variant: pageVariant });
      }
    });
  });

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
})();
