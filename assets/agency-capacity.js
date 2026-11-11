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

  const calculator = $("#capacity-calculator");
  if (calculator) {
    const fields = {
      avgRetainer: $("#avg-retainer"),
      clientUnits: $("#client-units"),
      margin: $("#margin"),
      fillProbability: $("#fill-probability"),
      founderHours: $("#founder-hours")
    };

    const outputs = {
      opportunityRange: $("#opportunity-range"),
      annualCapacity: $("#annual-capacity"),
      releasedHours: $("#released-hours"),
      founderHours: $("#founder-hours-output")
    };

    const calculate = () => {
      const averageRetainer = clamp(fields.avgRetainer.value, 25000, 1000000);
      const clientUnits = clamp(fields.clientUnits.value, 1, 20);
      const contributionMargin = clamp(fields.margin.value, 10, 80) / 100;
      const fillProbability = clamp(fields.fillProbability.value, 10, 100) / 100;
      const founderHours = clamp(fields.founderHours.value, 0, 40);

      const riskAdjustedContribution = averageRetainer * clientUnits * contributionMargin * 12 * fillProbability;
      const lowEstimate = roundTo(riskAdjustedContribution * 0.8, 50000);
      const highEstimate = roundTo(riskAdjustedContribution * 1.1, 50000);
      const midpoint = roundTo(riskAdjustedContribution, 50000);
      const releasableHours = Math.round(Math.min(founderHours, 10) * 52);

      outputs.opportunityRange.textContent = `${formatCompactINR(lowEstimate)}–${formatCompactINR(highEstimate)}`;
      outputs.annualCapacity.textContent = formatCompactINR(midpoint);
      outputs.releasedHours.textContent = `${new Intl.NumberFormat("en-IN").format(releasableHours)} hrs`;
      outputs.founderHours.textContent = `${founderHours} hrs`;
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
      const scrollingDown = currentScroll > lastScroll;
      header.classList.toggle("is-hidden", scrollingDown && currentScroll > 180);
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
    window.dataLayer.push({ event: "vb_cta_click", cta_location: link.dataset.track });
  }, { capture: true });

  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
