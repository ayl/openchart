const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const script = source.split("<script>")[1].split("</script>")[0];

function environment(saved = null) {
  let document;
  const escape = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.attrs = {};
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.events = {};
      this.hidden = false;
      this._text = "";
      this.clientWidth = 900;
      this.clientHeight = 650;
      this.offsetWidth = 200;
      this.offsetHeight = 250;
      this.classList = {
        add: (...cs) =>
          (this.className = [
            ...new Set(this.className.split(" ").concat(cs)),
          ].join(" ")),
        remove: (...cs) =>
          (this.className = this.className
            .split(" ")
            .filter((c) => !cs.includes(c))
            .join(" ")),
        contains: (c) => this.className.split(" ").includes(c),
        toggle: (c, on) => {
          on = on ?? !this.classList.contains(c);
          on ? this.classList.add(c) : this.classList.remove(c);
          return on;
        },
      };
    }
    get className() {
      return this.attrs.class || "";
    }
    set className(v) {
      this.attrs.class = v;
    }
    /* Form controls reflect their value attribute until overridden, so
       selector matching and exportOptions() behave like a real browser. */
    get value() {
      return this._value !== undefined ? this._value : this.attrs.value || "";
    }
    set value(v) {
      this._value = v;
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    }
    set innerHTML(v) {
      this._html = v;
      this.children = [];
    }
    get innerHTML() {
      return this._html || this.children.map((c) => c.outerHTML).join("");
    }
    get outerHTML() {
      const attrs = Object.entries(this.attrs)
        .map(([k, v]) => ` ${k}="${escape(v)}"`)
        .join("");
      return `<${this.tagName.toLowerCase()}${attrs}>${escape(this._text)}${this.children.map((c) => c.outerHTML).join("")}</${this.tagName.toLowerCase()}>`;
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k.startsWith("data-"))
        this.dataset[
          k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        ] = String(v);
    }
    getAttribute(k) {
      return this.attrs[k] ?? null;
    }
    removeAttribute(k) {
      delete this.attrs[k];
    }
    appendChild(c) {
      if (c.parentNode) c.remove();
      c.parentNode = this;
      this.children.push(c);
      return c;
    }
    append(...cs) {
      cs.forEach((c) => this.appendChild(c));
    }
    insertBefore(c, ref) {
      if (!ref || ref.parentNode !== this) return this.appendChild(c);
      if (c.parentNode) c.remove();
      const i = this.children.indexOf(ref);
      this.children.splice(i, 0, c);
      c.parentNode = this;
      return c;
    }
    replaceChildren(...cs) {
      this.children.forEach((c) => (c.parentNode = null));
      this.children = [];
      this._text = "";
      this.append(...cs);
    }
    /* R01: faithful Node.contains so deferred inspector rebuilds and
       ancestry checks behave like a real DOM. */
    contains(el) {
      for (let n = el; n; n = n.parentNode) if (n === this) return true;
      return false;
    }
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter(
          (c) => c !== this,
        );
      this.parentNode = null;
    }
    get firstChild() {
      return this.children[0] || null;
    }
    get lastChild() {
      return this.children[this.children.length - 1] || null;
    }
    get nextSibling() {
      const p = this.parentNode;
      if (!p) return null;
      return p.children[p.children.indexOf(this) + 1] || null;
    }
    get previousSibling() {
      const p = this.parentNode;
      if (!p) return null;
      return p.children[p.children.indexOf(this) - 1] || null;
    }
    matches(selector) {
      return selector.split(",").some((s) => {
        s = s.trim();
        const attr = [
          ...s.matchAll(/\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g),
        ];
        if (
          attr.some(
            ([, k, v]) =>
              this.getAttribute(k) === null ||
              (v !== undefined && this.getAttribute(k) !== v),
          )
        )
          return false;
        s = s.replace(/\[[^\]]+\]/g, "");
        if (s.endsWith(":checked")) return !!this.checked;
        if (s.startsWith("#")) return this.attrs.id === s.slice(1);
        if (s.startsWith(".")) return this.classList.contains(s.slice(1));
        return !s || this.tagName === s.toUpperCase();
      });
    }
    querySelectorAll(s) {
      return this.children.flatMap((c) => [
        ...(c.matches(s) ? [c] : []),
        ...c.querySelectorAll(s),
      ]);
    }
    querySelector(s) {
      return this.querySelectorAll(s)[0] || null;
    }
    closest(s) {
      return this.matches(s) ? this : this.parentNode?.closest(s) || null;
    }
    addEventListener(k, fn) {
      (this.events[k] ??= []).push(fn);
    }
    removeEventListener(k, fn) {
      this.events[k] = (this.events[k] || []).filter((f) => f !== fn);
    }
    /* C01: real-DOM focus semantics - moving focus blurs the previous
       control, and a blurred input fires change when its value changed
       since focus. Session arming relies on these events. */
    focus() {
      const prev = document.activeElement;
      if (prev && prev !== this && typeof prev.blur === "function") prev.blur();
      document.activeElement = this;
      this.__ocFocusValue = this.value;
      (this.events.focus || []).forEach((f) => f({ target: this }));
    }
    select() {}
    blur() {
      if (
        this.__ocFocusValue !== undefined &&
        this.value !== this.__ocFocusValue &&
        ((this.events.change || []).length ||
          typeof this.onchange === "function")
      ) {
        const ev = { target: this, preventDefault() {}, stopPropagation() {} };
        (this.events.change || []).forEach((f) => f(ev));
        if (typeof this.onchange === "function") this.onchange(ev);
      }
      this.__ocFocusValue = undefined;
      document.activeElement = document.body;
      (this.events.blur || []).forEach((f) => f({ target: this }));
    }
    click() {
      this.onclick?.({ target: this });
    }
    /* V01: drive real control callbacks with synthetic events; selects bind
       through the onchange property, so honor it too. */
    fire(type, init = {}) {
      const ev = {
        target: this,
        preventDefault() {},
        stopPropagation() {},
        ...init,
      };
      (this.events[type] || []).forEach((f) => f(ev));
      if (type === "change" && typeof this.onchange === "function")
        this.onchange(ev);
    }
    showModal() {
      this.setAttribute("open", "");
    }
    close() {
      this.removeAttribute("open");
    }
    getBoundingClientRect() {
      return {
        left: 220,
        top: 102,
        width: 900,
        height: 650,
        right: 1120,
        bottom: 752,
      };
    }
    setPointerCapture() {}
    releasePointerCapture() {}
    getContext() {
      return {
        font: "13px Arial",
        measureText(s) {
          return {
            width:
              String(s).length *
              parseFloat(this.font.match(/([\d.]+)px/)?.[1] || 13) *
              0.55,
          };
        },
        drawImage() {},
      };
    }
  }
  document = {
    body: new Element("body"),
    events: {},
    createElement: (t) => new Element(t),
    createElementNS: (ns, t) => new Element(t),
    createTextNode: (t) => {
      const e = new Element("span");
      e.textContent = t;
      return e;
    },
    querySelector(s) {
      return this.body.querySelector(s);
    },
    querySelectorAll(s) {
      return this.body.querySelectorAll(s);
    },
    addEventListener(k, f) {
      (this.events[k] ??= []).push(f);
    },
  };
  // Only static controls are needed; generated SVG and inspector trees use the full adapter.
  for (const match of source
    .split("<script>")[0]
    .matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, tag, attrs] = match;
    if (tag === "style") continue;
    const e = new Element(tag);
    for (const a of attrs.matchAll(/([\w-]+)="([^"]*)"/g))
      e.setAttribute(a[1], a[2]);
    if (
      e.attrs.id ||
      e.attrs.name ||
      Object.keys(e.attrs).some((k) => k.startsWith("data-")) ||
      e.attrs.class?.includes("menu")
    )
      document.body.appendChild(e);
  }
  document.activeElement = document.body;
  const storage = new Map(saved ? [["openchart.doc.v1", saved]] : []),
    windowEvents = {};
  let writes = 0;
  /* V01: deterministic scheduling. The application sees a virtual clock
     (Date.now), a timer queue that only runs when the test advances time,
     and an animation-frame queue that only runs when the test paints a
     frame. Nothing is drained implicitly, so pending-frame and idle-timer
     behavior is observable. */
  const clock = { now: 1700000000000 };
  const timers = new Map();
  let timerSeq = 0;
  let frameSeq = 0;
  const frames = new Map();
  const drainTimers = () => {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= clock.now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due.length) break;
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        t.fn();
      }
    }
  };
  const context = vm.createContext({
    __OPENCHART_TEST__: true,
    document,
    console,
    crypto: require("node:crypto").webcrypto,
    structuredClone,
    TextEncoder,
    TextDecoder,
    CompressionStream,
    Response,
    Blob,
    URL,
    XMLSerializer: class {
      serializeToString(e) {
        return e.outerHTML;
      }
    },
    navigator: {
      platform: "MacIntel",
      clipboard: { writeText: async () => {} },
    },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => {
        writes++;
        storage.set(k, v);
      },
    },
    window: {
      innerWidth: 1400,
      innerHeight: 900,
      addEventListener: (k, f) => (windowEvents[k] ??= []).push(f),
    },
    confirm: () => true,
    Date: class extends Date {
      static now() {
        return clock.now;
      }
    },
    setTimeout: (fn, ms) => {
      const id = ++timerSeq;
      timers.set(id, { fn, at: clock.now + (ms || 0) });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => {
      const id = ++frameSeq;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  vm.runInContext(script, context);
  const run = (s) => vm.runInContext(s, context),
    json = (s) => JSON.parse(JSON.stringify(run(s)));
  run("render();refreshProps();");
  return {
    run,
    json,
    clock,
    advance(ms) {
      clock.now += ms;
      drainTimers();
    },
    /* Run exactly one animation frame: callbacks queued before this call
       run now; anything they schedule waits for the next frame. */
    frame() {
      const q = [...frames.values()];
      frames.clear();
      q.forEach((fn) => fn());
    },
    get pendingFrames() {
      return frames.size;
    },
    get pendingTimers() {
      return timers.size;
    },
    document,
    storage,
    windowEvent(type, init = {}) {
      const ev = {
        target: document.body,
        preventDefault() {},
        stopPropagation() {},
        ...init,
      };
      (windowEvents[type] || []).forEach((fn) => fn(ev));
    },
    get writes() {
      return writes;
    },
    key: (key, extra = {}) =>
      windowEvents.keydown[0]({
        key,
        code: key,
        preventDefault() {},
        target: document.body,
        ...extra,
      }),
  };
}
function setup(e) {
  e.run(
    "state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;const a=makeNode('rect',100,100),b=makeNode('rect',400,100);a.text='A';b.text='B';const edge=makeEdge(a.id,b.id);render();",
  );
}
function pointer(e, type, x, y, target = "#stage", extra = {}) {
  const el =
    typeof target === "string" ? e.document.querySelector(target) : target;
  const ev = {
    button: 0,
    pointerId: 1,
    clientX: x + 220,
    clientY: y + 102,
    target: el,
    preventDefault() {},
    ...extra,
  };
  e.run(
    `globalThis._pointerHandler=${type === "down" ? "onDown" : type === "move" ? "onMove" : "onUp"}`,
  );
  return e.run("_pointerHandler")(ev);
}

/* Segment/rectangle interior intersection with a boundary tolerance:
   contact within tol of the rect edge counts as a hit when the segment
   genuinely reaches the interior; fully outside segments never hit. */
function segRectIntersects(a, b, r, tol = 0.5) {
  const min = { x: r.x + tol, y: r.y + tol };
  const max = { x: r.x + r.w - tol, y: r.y + r.h - tol };
  const inside = (pt) =>
    pt.x > min.x && pt.x < max.x && pt.y > min.y && pt.y < max.y;
  if (inside(a) || inside(b)) return true;
  /* Liang-Barsky clip of the segment against the shrunk rect. */
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const checks = [
    [-dx, a.x - min.x],
    [dx, max.x - a.x],
    [-dy, a.y - min.y],
    [dy, max.y - a.y],
  ];
  for (const [den, num] of checks) {
    if (den === 0) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 < t1;
}
/* Every painted segment of the route must avoid every rectangle. */
function routeHitsRects(pts, rects, tol = 0.5) {
  for (let i = 1; i < pts.length; i++)
    for (const r of rects)
      if (segRectIntersects(pts[i - 1], pts[i], r, tol)) return true;
  return false;
}
module.exports = {
  environment,
  setup,
  pointer,
  segRectIntersects,
  routeHitsRects,
};
