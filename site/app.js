/* Awesome Testing Tools — channel guide.
 *
 * Data flows one way: readme.md -> scripts/parse-readme.mjs -> data/tools.json -> here.
 * All tool text comes from third-party PRs, so every node is built with
 * createElement/textContent — no innerHTML with data, ever.
 *
 * DOM entry points are deliberately narrow so a search/filter layer can be
 * added later: renderCards(tools) owns the grid, tuneTo(tool) owns the TV.
 */
(() => {
  'use strict';

  const TUNE_STATIC_MS = 420; // total channel-change effect
  const TUNE_SWAP_MS = 180; // content swaps under the static, mid-effect

  const tv = document.getElementById('tv');
  const screen = document.getElementById('tv-screen');
  const screenBody = document.getElementById('screen-body');
  const screenChannel = document.getElementById('screen-channel');
  const grid = document.getElementById('grid');
  const gridLabel = document.getElementById('grid-label');
  const filterBar = document.getElementById('filter-bar');
  const heroCountText = document.getElementById('hero-count-text');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const state = {
    tools: [],
    categories: [],
    filter: null, // category name, or null for all
    visible: [], // tools currently rendered in the grid; knobs cycle these
    current: null, // tool object or null (powered off / idle)
    cardById: new Map(),
  };

  let tuneTimer = 0;
  let settleTimer = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatChannel(channel) {
    return 'CH ' + String(channel).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ *
   * TV screen
   * ------------------------------------------------------------------ */

  function renderScreen(tool) {
    screenBody.replaceChildren();

    if (!tool) {
      tv.classList.add('is-off');
      screenChannel.textContent = 'CH --';
      const pattern = el('div', 'test-pattern');
      const bars = el('div', 'test-bars');
      for (let i = 0; i < 7; i++) bars.appendChild(el('span'));
      pattern.appendChild(bars);
      pattern.appendChild(el('p', 'test-title', 'OFF AIR'));
      pattern.appendChild(el('p', 'test-hint', 'Pick a tool below to tune in.'));
      screenBody.appendChild(pattern);
      return;
    }

    tv.classList.remove('is-off');
    screenChannel.textContent = formatChannel(tool.channel);

    const tuned = el('div', 'tuned');
    tuned.appendChild(el('h2', 'tuned-name', tool.name));

    const meta = el('div', 'tuned-meta');
    meta.appendChild(el('span', 'chip', tool.category));
    meta.appendChild(el('span', 'badge badge-' + tool.price, tool.price));
    tuned.appendChild(meta);

    tuned.appendChild(el('p', 'tuned-desc', tool.description));

    const actions = el('div', 'tuned-actions');
    const heart = el('span', 'tuned-heart', '♥');
    heart.setAttribute('aria-hidden', 'true');
    actions.appendChild(heart);
    const visit = el('a', 'visit-btn', 'Visit site →');
    visit.href = tool.url;
    visit.target = '_blank';
    visit.rel = 'noopener noreferrer';
    actions.appendChild(visit);
    tuned.appendChild(actions);

    screenBody.appendChild(tuned);
  }

  function setHash(id) {
    // replaceState avoids polluting history and avoids the native
    // scroll-to-anchor jump that location.hash assignment causes.
    const url = id ? '#' + id : location.pathname + location.search;
    history.replaceState(null, '', url);
  }

  function markOnAir(tool) {
    for (const [id, card] of state.cardById) {
      const onAir = !!tool && id === tool.id;
      card.setAttribute('aria-pressed', String(onAir));
      if (onAir) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    }
  }

  /** The single entry point that tunes the TV. tool=null powers it off. */
  function tuneTo(tool, { updateHash = true, scrollToTv = false } = {}) {
    if (tool === state.current) return;
    state.current = tool;
    markOnAir(tool);
    if (updateHash) setHash(tool ? tool.id : null);

    if (reducedMotion.matches) {
      renderScreen(tool);
    } else {
      clearTimeout(tuneTimer);
      clearTimeout(settleTimer);
      screen.classList.add('is-tuning');
      tuneTimer = setTimeout(() => renderScreen(tool), TUNE_SWAP_MS);
      settleTimer = setTimeout(() => screen.classList.remove('is-tuning'), TUNE_STATIC_MS);
    }

    if (scrollToTv) {
      const rect = tv.getBoundingClientRect();
      const visible = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!visible) {
        tv.scrollIntoView({
          behavior: reducedMotion.matches ? 'auto' : 'smooth',
          block: 'center',
        });
      }
    }
  }

  function step(delta) {
    const list = state.visible;
    if (!list.length) return;
    const index = state.current
      ? list.findIndex((t) => t.id === state.current.id)
      : -1;
    const next =
      index === -1
        ? delta > 0
          ? 0
          : list.length - 1
        : (index + delta + list.length) % list.length;
    tuneTo(list[next]);
  }

  /* ------------------------------------------------------------------ *
   * Card grid
   * ------------------------------------------------------------------ */

  /** The single entry point that renders the grid. */
  function renderCards(tools) {
    state.visible = tools;
    grid.replaceChildren();
    state.cardById.clear();

    for (const tool of tools) {
      const item = el('li');
      const card = el('button', 'card');
      card.type = 'button';
      card.id = 'card-' + tool.id;
      card.setAttribute('aria-pressed', 'false');

      card.appendChild(el('span', 'card-ch', formatChannel(tool.channel)));
      card.appendChild(el('span', 'card-name', tool.name));

      const meta = el('span', 'card-meta');
      meta.appendChild(el('span', 'chip', tool.category));
      meta.appendChild(el('span', 'badge badge-' + tool.price, tool.price));
      card.appendChild(meta);

      card.appendChild(el('p', 'card-desc', tool.description));
      card.appendChild(el('span', 'card-onair', '● ON AIR'));

      card.addEventListener('click', () => tuneTo(tool, { scrollToTv: true }));

      state.cardById.set(tool.id, card);
      item.appendChild(card);
      grid.appendChild(item);
    }

    // re-applies the on-air highlight after a filter re-render
    markOnAir(state.current);
  }

  /* ------------------------------------------------------------------ *
   * Category filter
   * ------------------------------------------------------------------ */

  function setFilter(category) {
    state.filter = category;
    renderFilters();
    renderCards(
      category ? state.tools.filter((t) => t.category === category) : state.tools
    );
    gridLabel.textContent = category || 'All channels';
  }

  function renderFilters() {
    filterBar.replaceChildren();

    const addChip = (label, count, value) => {
      const chip = el('button', 'filter-chip');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(value === state.filter));
      chip.appendChild(el('span', '', label));
      chip.appendChild(el('span', 'filter-count', String(count)));
      chip.addEventListener('click', () => {
        if (value !== state.filter) setFilter(value);
      });
      filterBar.appendChild(chip);
    };

    addChip('All', state.tools.length, null);
    for (const category of state.categories) {
      addChip(
        category,
        state.tools.filter((t) => t.category === category).length,
        category
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  function toolFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    return state.tools.find((t) => t.id === id) || null;
  }

  function wireControls() {
    document.getElementById('tv-prev').addEventListener('click', () => step(-1));
    document.getElementById('tv-next').addEventListener('click', () => step(1));
    document.getElementById('tv-power').addEventListener('click', () => tuneTo(null));

    tv.addEventListener('keydown', (event) => {
      if (event.target.closest('a')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'Escape') {
        tuneTo(null);
      }
    });

    window.addEventListener('hashchange', () => {
      const tool = toolFromHash();
      if (tool !== state.current) tuneTo(tool, { updateHash: false });
    });
  }

  function showError() {
    const message =
      'Transmission lost: could not load the tool list. ' +
      'Try reloading, or read the list directly in the readme on GitHub.';
    grid.replaceChildren();
    const error = el('li', 'grid-error', message);
    grid.appendChild(error);
    screenBody.replaceChildren(el('p', 'screen-error', 'NO SIGNAL'));
    heroCountText.textContent = 'no signal';
  }

  async function init() {
    renderScreen(null);
    wireControls();

    let data;
    try {
      const response = await fetch('data/tools.json');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      data = await response.json();
    } catch (error) {
      console.error('Failed to load tools.json:', error);
      showError();
      return;
    }

    state.tools = data.tools;
    state.categories = data.categories;
    heroCountText.textContent =
      data.tools.length + ' tools on air · ' + data.categories.length + ' categories';

    renderFilters();
    renderCards(state.tools);

    const fromHash = toolFromHash();
    if (fromHash) tuneTo(fromHash, { updateHash: false, scrollToTv: true });
  }

  init();
})();
