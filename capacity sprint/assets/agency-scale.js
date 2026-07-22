(() => {
  "use strict";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(Math.max(Number(value) || min, min), max);
  const roundTo = (value, unit) => Math.round(value / unit) * unit;

  const formatCompactINR = (value) => {
    const absolute = Math.abs(value);
    if (absolute >= 10000000) {
      const crores = value / 10000000;
      return `₹${crores.toFixed(crores >= 10 ? 0 : 1).replace(/\.0$/, "")}Cr`;
    }
    if (absolute >= 100000) {
      const lakhs = value / 100000;
      return `₹${lakhs.toFixed(lakhs >= 10 ? 1 : 2).replace(/\.0+$/, "")}L`;
    }
    return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value)}`;
  };

  const calculator = $("#revenue-calculator");
  if (calculator) {
    const fields = {
      retainer: $("#scale-retainer"),
      clients: $("#scale-clients"),
      margin: $("#scale-margin"),
      fill: $("#scale-fill"),
      hours: $("#scale-hours")
    };

    const outputs = {
      revenueRange: $("#scale-revenue-range"),
      revenueMidpoint: $("#scale-revenue-midpoint"),
      contribution: $("#scale-contribution"),
      delay: $("#scale-delay"),
      delayEcho: $("#scale-delay-echo"),
      releasedHours: $("#scale-released-hours"),
      hours: $("#scale-hours-output"),
      priceRevenue: $("#scale-price-revenue"),
      priceContribution: $("#scale-price-contribution")
    };

    const calculate = () => {
      const monthlyRetainer = clamp(fields.retainer.value, 25000, 1000000);
      const clientUnits = clamp(fields.clients.value, 1, 20);
      const margin = clamp(fields.margin.value, 10, 80) / 100;
      const fillProbability = clamp(fields.fill.value, 10, 100) / 100;
      const founderHours = clamp(fields.hours.value, 0, 40);

      const grossRevenue = monthlyRetainer * clientUnits * 12 * fillProbability;
      const lowRevenue = roundTo(grossRevenue * 0.8, 100000);
      const highRevenue = roundTo(grossRevenue * 1.1, 100000);
      const revenueMidpoint = roundTo(grossRevenue, 100000);
      const contribution = roundTo(grossRevenue * margin, 50000);
      const ninetyDayDelay = roundTo(revenueMidpoint / 4, 50000);
      const releasedHours = Math.round(Math.min(founderHours, 10) * 52);

      outputs.revenueRange.textContent = `${formatCompactINR(lowRevenue)}–${formatCompactINR(highRevenue)}`;
      outputs.revenueMidpoint.textContent = formatCompactINR(revenueMidpoint);
      outputs.contribution.textContent = formatCompactINR(contribution);
      outputs.delay.textContent = formatCompactINR(ninetyDayDelay);
      outputs.delayEcho.textContent = formatCompactINR(ninetyDayDelay);
      outputs.releasedHours.textContent = `${new Intl.NumberFormat("en-IN").format(releasedHours)} hrs`;
      outputs.hours.textContent = `${founderHours} hrs`;
      outputs.priceRevenue.textContent = formatCompactINR(revenueMidpoint);
      outputs.priceContribution.textContent = formatCompactINR(contribution);
    };

    Object.values(fields).forEach((field) => field.addEventListener("input", calculate));
    calculator.addEventListener("submit", (event) => event.preventDefault());
    calculate();
  }

  const revealElements = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });

    revealElements.forEach((element) => revealObserver.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  }

  const header = $("[data-header]");
  if (header) {
    let lastScroll = window.scrollY;
    let ticking = false;
    const updateHeader = () => {
      const currentScroll = window.scrollY;
      header.classList.toggle("is-hidden", currentScroll > lastScroll && currentScroll > 180);
      lastScroll = currentScroll;
      ticking = false;
    };
    window.addEventListener("scroll", () => {
      if (ticking) return;
      window.requestAnimationFrame(updateHeader);
      ticking = true;
    }, { passive: true });
  }

  window.dataLayer = window.dataLayer || [];
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-track]");
    if (!link) return;
    window.dataLayer.push({ event: "vb_cta_click", page_variant: "revenue_scale", cta_location: link.dataset.track });
  }, { capture: true });

  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
