/* UNTangle v3 (Opus) mockup runtime: icons, segmented control, sheet physics, FLIP, toast. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = matchMedia("(prefers-reduced-motion: reduce)");
const PHONE = matchMedia("(max-width: 759px)");
const FINE = matchMedia("(hover: hover) and (pointer: fine)");
const Q = new URLSearchParams(location.search);
const EASE = { out: "cubic-bezier(.23,1,.32,1)", inOut: "cubic-bezier(.77,0,.175,1)", sheet: "cubic-bezier(.32,.72,0,1)" };
const reduced = () => RM.matches;

const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevR: '<path d="M9.5 6l6 6-6 6"/>', chevL: '<path d="M14.5 6l-6 6 6 6"/>', chevD: '<path d="M6 9.5l6 6 6-6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  walk: '<circle cx="13.2" cy="4.6" r="1.7" fill="currentColor" stroke="none"/><path d="M10 21l2.3-6.4M15 21l-2-5.2-1.7-3.1.9-4 2.8 2.6 2.7 1.1M11.2 9.3L8.4 11l-1 3.4"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  ext: '<path d="M13.5 5H19v5.5M19 5l-8 8M17 14v4.2a.8.8 0 0 1-.8.8H5.8a.8.8 0 0 1-.8-.8V7.8c0-.44.36-.8.8-.8H10"/>',
  courses: '<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9"/><circle cx="18" cy="17.5" r="1.6"/>',
  week: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8.5 3v3M15.5 3v3M7.5 13h3v4h-3zM13.5 13h3"/>',
  day: '<circle cx="6" cy="18.5" r="2"/><path d="M7.8 17.5c5.5-1 1.4-8.6 7.4-9.5"/><path d="M17.5 3.5a3.5 3.5 0 0 1 3.5 3.5c0 2.6-3.5 6-3.5 6S14 9.6 14 7a3.5 3.5 0 0 1 3.5-3.5z"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  undo: '<path d="M9 14.5L4 9.5l5-5M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="currentColor" stroke="none"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  cube: '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5"/>',
  file: '<path d="M7 3.5h6.8L18.5 8v11.3a1.2 1.2 0 0 1-1.2 1.2H7a1.2 1.2 0 0 1-1.2-1.2V4.7A1.2 1.2 0 0 1 7 3.5z"/><path d="M13.5 3.5V8.3h5"/>',
  alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c1.4-3.6 4-5.3 7-5.3s5.6 1.7 7 5.3"/>',
  trayin: '<path d="M12 3.5v9.5M8 9.5l4 4 4-4"/><path d="M4 14.5v3.3a2.2 2.2 0 0 0 2.2 2.2h11.6a2.2 2.2 0 0 0 2.2-2.2v-3.3"/>',
  window: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M3.5 9h17"/><circle cx="6.5" cy="7" r=".6" fill="currentColor"/><circle cx="8.6" cy="7" r=".6" fill="currentColor"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17.5l4.5-4.5 3.5 3.5 2.5-2.5 3.5 3.5"/>',
  hash: '<path d="M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15M4 15h15"/>',
  share: '<path d="M12 15V4M8 7.5L12 3.5l4 4M6 11v7.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V11"/>',
  sliders: '<path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  dup: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 15.5V6A1.5 1.5 0 0 1 7 4.5h8.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  pencil: '<path d="M15.5 5.5l3 3L9 18H6v-3z"/>',
  compare: '<rect x="4" y="5" width="7" height="14" rx="1.6"/><rect x="13" y="5" width="7" height="14" rx="1.6"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.4 2.4 2.4 13.6 0 16M12 4c-2.4 2.4-2.4 13.6 0 16"/>',
};
const STATUS = {
  done: '<circle cx="12" cy="12" r="8.5" fill="#4f654f"/><path d="M8.2 12.3l2.6 2.6 5-5.2" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  covered: '<circle cx="12" cy="12" r="7.75" fill="none" stroke="#6b806b" stroke-width="1.5" stroke-dasharray="2.6 2.2"/><path d="M8.4 12.3l2.5 2.5 4.8-5" stroke="#4f654f" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  taking: '<circle cx="12" cy="12" r="7.75" fill="none" stroke="#00a855" stroke-width="2"/><path d="M12 4.25a7.75 7.75 0 0 1 0 15.5z" fill="#00a855"/>',
  planned: '<circle cx="12" cy="12" r="8.5" fill="#00512b"/><circle cx="12" cy="12" r="3" fill="#fff"/>',
  available: '<circle cx="12" cy="12" r="7.75" fill="none" stroke="#6b806b" stroke-width="1.5"/>',
  locked: '<rect x="7.2" y="11" width="9.6" height="7.2" rx="1.6" fill="#9fb09f"/><path d="M9.4 11V9.2a2.6 2.6 0 0 1 5.2 0V11" stroke="#9fb09f" stroke-width="1.6" fill="none"/>',
  check: '<circle cx="12" cy="12" r="7.75" fill="#fbf3df" stroke="#8a6100" stroke-width="1.5"/><path d="M12 8v4.6" stroke="#8a6100" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="15.6" r="1.1" fill="#8a6100"/>',
};
(function sprite() {
  const s = Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("") +
    Object.entries(STATUS).map(([k, v]) => `<symbol id="s-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("");
  document.body.insertAdjacentHTML("afterbegin", `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${s}</svg>`);
})();
const icon = (n, c = "") => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const sg = (s, label) => `<svg class="sg" role="img" aria-label="${label || s}"><use href="#s-${s}"/></svg>`;
function hydrateIcons(root = document) {
  $$("[data-i]", root).forEach((el) => { if (!el.querySelector(":scope > svg.i")) el.insertAdjacentHTML("afterbegin", icon(el.dataset.i, el.dataset.is || "")); });
}

/* Segmented control: equal segments, one pill moved by transform. */
function initSeg(el, onChange) {
  if (!el.querySelector(".pill")) el.insertAdjacentHTML("afterbegin", '<span class="pill" aria-hidden="true"></span>');
  const pill = el.querySelector(".pill");
  const btns = $$(":scope > button", el);
  const place = (instant) => {
    const i = Math.max(0, btns.findIndex((b) => b.getAttribute("aria-pressed") === "true"));
    const w = btns[0].offsetWidth;
    if (instant) pill.style.transition = "none";
    pill.style.width = w + "px";
    pill.style.transform = `translateX(${btns[i].offsetLeft - 3}px)`;
    if (instant) requestAnimationFrame(() => (pill.style.transition = ""));
  };
  btns.forEach((b, i) => b.addEventListener("click", (e) => {
    btns.forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    place(e.detail === 0); onChange && onChange(b.dataset.v ?? i, b, e.detail === 0); // detail 0 = keyboard
  }));
  place(true);
  new ResizeObserver(() => place(true)).observe(el);
  return { set(v) { const b = btns.find((x) => x.dataset.v === String(v)); if (b) { btns.forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); place(false); } } };
}

/* Chips: aria-pressed toggles. */
function initChips(root, onChange) {
  $$(".chip[aria-pressed]", root).forEach((c) => {
    if (!c.querySelector("svg")) c.insertAdjacentHTML("afterbegin", icon("check"));
    c.addEventListener("click", () => { const on = c.getAttribute("aria-pressed") !== "true"; c.setAttribute("aria-pressed", on); onChange && onChange(c.dataset.v, on, c); });
  });
}

/* Critically damped by default; a little bounce only after a flick (Apple: damping 0.8-1, response 0.3-0.4). */
function spring(from, to, v0, { response = 0.34, damping = 1 } = {}, onUpdate, onDone) {
  const k = Math.pow((2 * Math.PI) / response, 2), c = (4 * Math.PI * damping) / response;
  let x = from, v = v0 * 1000, last = performance.now(), raf;
  const step = (now) => {
    let dt = Math.min(0.032, (now - last) / 1000); last = now;
    while (dt > 0) { const h = Math.min(dt, 1 / 240); const a = -k * (x - to) - c * v; v += a * h; x += v * h; dt -= h; }
    onUpdate(x);
    if (Math.abs(x - to) < 0.4 && Math.abs(v) < 8) { onUpdate(to); onDone && onDone(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
const project = (vPxPerMs, d = 0.995) => ((vPxPerMs * 1000) / 1000) * d / (1 - d);

/* Modal focus lifecycle: move focus in, make the rest inert, restore on close. */
const modalStack = [];
function modalOpen(el, focusEl) {
  const prev = document.activeElement;
  const others = [...document.body.children].filter((c) => c !== el && !c.contains(el) && !c.classList.contains("scrim") && !c.classList.contains("toast") && c.tagName !== "SCRIPT" && !c.inert);
  others.forEach((c) => (c.inert = true));
  modalStack.push({ el, prev, others });
  requestAnimationFrame(() => (focusEl || el.querySelector("input, button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"))?.focus({ preventScroll: true }));
}
function modalClose(el) {
  const i = modalStack.findIndex((m) => m.el === el); if (i < 0) return;
  const [m] = modalStack.splice(i, 1); m.others.forEach((c) => (c.inert = false));
  m.prev && document.contains(m.prev) && m.prev.focus({ preventScroll: true });
}

/* Contextual panel (desktop). Opens on a selection and is empty otherwise. A pointer open slides
   24px in from the right and fades while the page moves aside (220ms, --ease-out); the × button
   reverses it in 150ms. Opening from the keyboard and closing with Esc are instant: they repeat
   too often to animate. `trigger` may be a function, for pages that rebuild the control that opened
   the panel; it is resolved when focus goes back, after onClose has re-rendered. */
class Panel {
  constructor(el, { onClose } = {}) { this.el = el; this.onClose = onClose; this.trigger = null; el.inert = true; el.setAttribute("aria-hidden", "true"); }
  get isOpen() { return this.el.classList.contains("on"); }
  instantFrame(instant) {
    if (!instant) return;
    this.el.classList.add("instant"); document.body.classList.add("panel-instant");
    requestAnimationFrame(() => requestAnimationFrame(() => { this.el.classList.remove("instant"); document.body.classList.remove("panel-instant"); }));
  }
  open({ instant = false, trigger = document.activeElement, focus = false } = {}) {
    if (!this.isOpen) this.trigger = trigger;
    this.instantFrame(instant);
    document.body.classList.add("panel-open");
    this.el.classList.add("on"); this.el.inert = false; this.el.setAttribute("aria-hidden", "false");
    if (focus) requestAnimationFrame(() => this.el.querySelector("h2[tabindex], input, button")?.focus({ preventScroll: true }));
  }
  close(instant = false) {
    if (!this.isOpen) return;
    const hadFocus = this.el.contains(document.activeElement);
    this.instantFrame(instant);
    document.body.classList.remove("panel-open");
    this.el.classList.remove("on"); this.el.inert = true; this.el.setAttribute("aria-hidden", "true");
    this.onClose && this.onClose();
    const back = typeof this.trigger === "function" ? this.trigger() : this.trigger;
    if (hadFocus && back && document.contains(back)) back.focus({ preventScroll: true });
  }
}

/* Bottom sheet with detents, pointer capture, projected release, velocity handoff. */
class Sheet {
  constructor(el, { detents, modal = false, scrim = null, dismissible = false, onDetent, bottomInset = () => 0 }) {
    Object.assign(this, { el, detents, modal, scrim, dismissible, onDetent, bottomInset });
    this.body = el.querySelector(".sheet-body"); this.y = null; this.index = -1; this.cancel = null; el.inert = true;
    this.bindDrag();
    addEventListener("resize", () => { if (this.index >= 0) this.setY(this.yFor(this.index)); });
  }
  H() { return this.el.offsetHeight - 40; }
  yFor(i) { const h = typeof this.detents[i] === "function" ? this.detents[i]() : this.detents[i]; return this.H() - h - this.bottomInset(); }
  closedY() { return this.H() + 40; }
  setY(y) { this.y = y; this.el.style.transform = `translateY(${y}px)`; if (this.body) this.body.style.overflowY = this.index === this.detents.length - 1 ? "auto" : "hidden"; }
  animateTo(y, v = 0, flick = false, done, instant = false) {
    this.cancel && this.cancel();
    if (instant) { this.setY(y); done && done(); return; }
    if (reduced()) { this.el.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 140 }); this.setY(y); done && done(); return; }
    const from = this.y ?? this.closedY();
    this.cancel = spring(from, y, v, { response: 0.34, damping: flick ? 0.86 : 1 }, (x) => this.setY(x), done);
  }
  /* instant: no motion, for state a tab switch restores (tab switches never animate). */
  open(i = 0, { instant = false } = {}) {
    if (this.y === null) this.setY(this.closedY());
    const wasClosed = this.index < 0; this.index = i; this.animateTo(this.yFor(i), 0, false, null, instant); this.el.setAttribute("aria-hidden", "false"); this.el.inert = false;
    if (this.modal && wasClosed) { this.el.setAttribute("role", "dialog"); this.el.setAttribute("aria-modal", "true"); modalOpen(this.el); }
    if (this.scrim) this.scrim.classList.add("on");
    this.onDetent && this.onDetent(i);
  }
  snap(i, v = 0, flick = false) { this.index = i; this.animateTo(this.yFor(i), v, flick); this.onDetent && this.onDetent(i); }
  close(v = 0, { instant = false } = {}) {
    this.index = -1; if (this.scrim) this.scrim.classList.remove("on");
    if (this.modal) modalClose(this.el);
    this.animateTo(this.closedY(), v, false, () => { this.el.setAttribute("aria-hidden", "true"); this.el.inert = true; }, instant);
    this.onDetent && this.onDetent(-1);
  }
  bindDrag() {
    let startY = 0, startSheetY = 0, samples = [], dragging = false, id = null, fromBody = false;
    const down = (e) => {
      if (id !== null) return; // ignore a second finger
      fromBody = this.body && this.body.contains(e.target);
      if (fromBody && this.index === this.detents.length - 1 && this.body.scrollTop > 0) return;
      if (e.target.closest("button, a, input, [data-nodrag]") && !e.target.closest(".grabber")) return;
      id = e.pointerId; startY = e.clientY; startSheetY = this.y; samples = [{ y: e.clientY, t: e.timeStamp }]; dragging = false;
    };
    const move = (e) => {
      if (e.pointerId !== id) return;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 8) return; // hysteresis
        if (fromBody && this.index === this.detents.length - 1 && dy < 0) { id = null; return; }
        dragging = true; this.cancel && this.cancel(); this.el.setPointerCapture(id);
      }
      const top = this.yFor(this.detents.length - 1);
      let y = startSheetY + dy;
      if (y < top) y = top - rubber(top - y, innerHeight);
      this.setY(y); samples.push({ y: e.clientY, t: e.timeStamp }); if (samples.length > 6) samples.shift();
    };
    const up = (e) => {
      if (e.pointerId !== id) return; id = null;
      if (!dragging) return; dragging = false;
      const a = samples.find((s) => e.timeStamp - s.t <= 100) || samples[0], b = samples[samples.length - 1];
      const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
      const proj = this.y + project(v);
      const ys = this.detents.map((_, i) => this.yFor(i));
      let target = ys.reduce((best, y, i) => (Math.abs(y - proj) < Math.abs(ys[best] - proj) ? i : best), 0);
      const nearestNow = ys.reduce((best, y, i) => (Math.abs(y - this.y) < Math.abs(ys[best] - this.y) ? i : best), 0);
      if (v < -0.11 && target <= nearestNow && nearestNow < ys.length - 1 && ys[nearestNow] <= this.y + 1) target = Math.max(target, nearestNow + 1);
      if (v > 0.11 && target >= nearestNow && ys[nearestNow] >= this.y - 1) target = Math.min(target, nearestNow - 1);
      if (target < 0 || (this.dismissible && proj > this.yFor(0) + 80)) {
        if (this.dismissible) return this.close(v);
        target = 0;
      }
      this.snap(Math.max(0, Math.min(ys.length - 1, target)), v, Math.abs(v) > 0.5);
    };
    this.el.addEventListener("pointerdown", down);
    this.el.addEventListener("pointermove", move);
    this.el.addEventListener("pointerup", up);
    this.el.addEventListener("pointercancel", up);
  }
}

/* FLIP: measure, mutate, play transforms from old to new. */
function flip(getNodes, mutate, { duration = 300, easing = EASE.inOut, stagger = 0 } = {}) {
  const first = new Map(getNodes().map((n) => [n.dataset.key || n, n.getBoundingClientRect()]));
  mutate();
  if (reduced()) return;
  getNodes().forEach((n, i) => {
    const f = first.get(n.dataset.key || n); if (!f) return;
    const l = n.getBoundingClientRect(); const dx = f.left - l.left, dy = f.top - l.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration, easing, delay: i * stagger, fill: "backwards" });
  });
}

/* Swap content with a short opacity + blur crossfade (rare transitions only). */
function swap(el, render) {
  if (reduced()) { render(); el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 }); return; }
  const out = el.animate([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(2px)", transform: "translateY(-2px)" }], { duration: 110, easing: "ease-out" });
  out.onfinish = () => { render(); el.animate([{ opacity: 0, filter: "blur(2px)", transform: "translateY(4px)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 200, easing: EASE.out }); };
}

/* A toast with an action (Undo, Show) stays until the student uses it or dismisses it: a fixed
   window would take the recovery away from anyone slower to reach it. A plain notice leaves after 5s. */
let toastTimer;
function toast(msg, action, fn) {
  let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  const hide = () => { t.classList.remove("on"); t.inert = true; };
  t.inert = false;
  t.innerHTML = `<span>${msg}</span>${action ? `<button type="button" data-act>${action}</button><button type="button" class="toast-x" aria-label="Dismiss">${icon("close")}</button>` : ""}`;
  if (action) {
    t.querySelector("[data-act]").onclick = () => { hide(); fn && fn(); };
    t.querySelector(".toast-x").onclick = hide;
  }
  requestAnimationFrame(() => t.classList.add("on"));
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(hide, 5000);
}

hydrateIcons();
