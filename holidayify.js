/*!
 * Holidayify engine — theme app extension build
 * Same visual behavior as the standalone demo, plus:
 *   - configurable buffer (start N days before the holiday)
 *   - configurable revert hour (auto-off the morning after)
 *   - activePacks filter (respects merchant's plan/selection)
 *   - overlap handling: when two holiday windows are active at once,
 *     the one ending soonest wins (most urgent/imminent takes priority)
 */
(function (window, document) {
  "use strict";

  const PACKS = {
    halloween: {
      label: "Halloween",
      end: { month: 10, day: 31 },
      vars: { "--hf-accent": "#FF7A1A", "--hf-accent-2": "#3D1C56", "--hf-bg-tint": "#1B1023", "--hf-text-on-accent": "#0E0712" },
      bannerText: "🎃 Happy Halloween!",
      decoration: "bats",
    },
    christmas: {
      label: "Christmas",
      end: { month: 12, day: 26 },
      vars: { "--hf-accent": "#B3182B", "--hf-accent-2": "#1C4A34", "--hf-bg-tint": "#0E2B1F", "--hf-text-on-accent": "#FBF6EC" },
      bannerText: "🎄 Happy Holidays!",
      decoration: "snow",
    },
    bfcm: {
      label: "Black Friday / Cyber Monday",
      end: { month: 11, day: 30 },
      vars: { "--hf-accent": "#F5C400", "--hf-accent-2": "#0A0A0A", "--hf-bg-tint": "#000000", "--hf-text-on-accent": "#0A0A0A" },
      bannerText: "🛍️ Happy Black Friday weekend!",
      // Black bar with gold type and a gold hairline, plus one shine sweep
      // when it appears. Overrides the default accent-coloured banner.
      bannerStyle: "background:#0A0A0A;color:#F5C400;letter-spacing:.06em;border-bottom:2px solid #F5C400;",
      bannerShine: true,
      // The CTA button inverts the banner; bannerStyle replaced the accent
      // background, so the inverse has to be spelled out too.
      ctaStyle: "background:#F5C400;color:#0A0A0A;",
      decoration: "confetti",
    },
    valentines: {
      label: "Valentine's Day",
      end: { month: 2, day: 14 },
      vars: { "--hf-accent": "#D6336C", "--hf-accent-2": "#F7C6D9", "--hf-bg-tint": "#3A0D1E", "--hf-text-on-accent": "#FFF5F8" },
      bannerText: "💝 Happy Valentine's Day!",
      decoration: "hearts",
    },
  };

  // Given "ends on Dec 26" and a buffer of 7 days, the active window is
  // Dec 19 -> Dec 26 inclusive, then reverts at `revertHour` on Dec 27.
  function isActive(pack, now, bufferDays, revertHour) {
    const year = now.getFullYear();
    const end = new Date(year, pack.end.month - 1, pack.end.day, revertHour, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - bufferDays);
    const revertAt = new Date(end);
    revertAt.setDate(revertAt.getDate() + 1); // morning after, at revertHour
    return now >= start && now < revertAt;
  }

  function activePackKey(activePacks, bufferDays, revertHour, date) {
    const now = date || new Date();
    const candidates = [];

    for (const key of activePacks) {
      const pack = PACKS[key];
      if (pack && isActive(pack, now, bufferDays, revertHour)) {
        // Track this pack's actual end date so we can compare urgency
        // across overlapping windows (e.g. BFCM buffer running into
        // Christmas buffer in late November).
        const year = now.getFullYear();
        const endsAt = new Date(year, pack.end.month - 1, pack.end.day);
        candidates.push({ key, endsAt });
      }
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].key;

    // Multiple holidays active at once: the one ending soonest wins.
    // Rationale: if BFCM and Christmas windows overlap, Black Friday is
    // the more time-sensitive, imminent event — it shouldn't get quietly
    // buried by a holiday that's still weeks away.
    candidates.sort((a, b) => a.endsAt - b.endsAt);
    return candidates[0].key;
  }

  function applyVars(vars) { const r = document.documentElement; Object.keys(vars).forEach(k => r.style.setProperty(k, vars[k])); }
  function clearVars(vars) { const r = document.documentElement; Object.keys(vars).forEach(k => r.style.removeProperty(k)); }

  // Phones get a compact banner: smaller type and padding and, with a CTA, at
  // most two lines: the message (cut to one line) and a row with the
  // countdown/deadline, code and button. A button on its own sits beside
  // the message instead, for a single line.
  const COMPACT_QUERY = "(max-width: 480px)";
  function isCompact() {
    try { return window.matchMedia(COMPACT_QUERY).matches; } catch (e) { return false; }
  }

  let bannerArgs = null;
  function injectBanner(text, pack, cta, rebuilding) {
    removeBanner();
    bannerArgs = [text, pack, cta];
    const compact = isCompact();
    const bar = document.createElement("div");
    bar.id = "hf-banner";
    const layout = !cta ? ""
      : compact ? "display:flex;flex-direction:column;align-items:center;gap:4px;"
      : "display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 12px;line-height:1.4;";
    const sizing = compact ? "padding:6px 12px;font-size:13px;line-height:1.3;" : "";
    bar.setAttribute("style", "position:relative;overflow:hidden;width:100%;box-sizing:border-box;padding:10px 16px;text-align:center;font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;background:var(--hf-accent);color:var(--hf-text-on-accent);z-index:2147483000;" + layout + sizing + (pack.bannerStyle || ""));
    const fit = cta ? buildCta(bar, text, pack, cta, compact) : (bar.textContent = text, null);
    document.body.prepend(bar);
    if (fit) fit();
    if (pack.bannerShine && !rebuilding) shineOnce(bar);
    watchForOverlays(bar);
    watchCompact();
  }
  // Rebuild when the screen crosses the phone breakpoint (rotation, resizing).
  let compactMql = null;
  function watchCompact() {
    if (compactMql || !window.matchMedia) return;
    compactMql = window.matchMedia(COMPACT_QUERY);
    const onChange = () => {
      if (bannerArgs && document.getElementById("hf-banner")) injectBanner(bannerArgs[0], bannerArgs[1], bannerArgs[2], true);
    };
    if (compactMql.addEventListener) compactMql.addEventListener("change", onChange);
    else if (compactMql.addListener) compactMql.addListener(onChange);
  }

  // Call to action: message, optional deadline/countdown, optional discount
  // code, optional button. `cta` comes pre-built from the app (see app/cta.js).
  // Every element starts from `all:initial` and sets its styles inline with
  // !important, so theme CSS for a/button/span (even !important rules) can't
  // restyle it. Nothing here touches the theme's own elements.
  const RESET = "all:initial;box-sizing:border-box;font:inherit;letter-spacing:inherit;color:inherit;";
  function styleImportant(el, cssText) {
    cssText.split(";").forEach((decl) => {
      const i = decl.indexOf(":");
      if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim(), "important");
    });
  }
  function make(tag, cssText) {
    const el = document.createElement(tag);
    styleImportant(el, RESET + cssText);
    return el;
  }
  // Single line, cut with "…" rather than wrapping (compact layout).
  const ONE_LINE = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;";
  let countdownTimer = null;
  function buildCta(bar, text, pack, cta, compact) {
    const msg = make("span", compact ? "display:block;max-width:100%;" + ONE_LINE : "");
    msg.textContent = text;
    const parts = [];

    let line = null, shortCountdown = false, chip = null, button = null;
    const stopCountdown = () => {
      if (line) line.remove();
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = null;
    };
    if (cta.deadline || cta.countdownTo) {
      // Gives way first when the compact row is tight (code and button shrink only in extreme cases).
      line = make("span", "font-weight:500;opacity:.92;" + (compact ? "flex:0 1000 auto;" + ONE_LINE : ""));
      const update = () => {
        const t = deadlineLine(cta.deadline, cta.countdownTo, compact);
        if (!t) { stopCountdown(); return; } // the cutoff has passed
        line.textContent = shortCountdown ? t.replace(/ left$/, "") : t;
      };
      update();
      if (line.textContent) {
        parts.push(line);
        if (cta.countdownTo) countdownTimer = setInterval(update, 30 * 1000);
      }
      line.update = update;
    }

    if (cta.code && cta.codeMode === "apply") {
      const note = make("span", "font-weight:500;opacity:.92;" + (compact ? "flex:0 0 auto;white-space:nowrap;" : ""));
      note.textContent = compact ? cta.code + " auto-applies" : "Code " + cta.code + " applies automatically";
      parts.push(note);
    } else if (cta.code) {
      const label = (compact ? "" : "Code ") + cta.code;
      chip = make("button", "display:inline-block;padding:" + (compact ? "2px 8px" : "3px 10px") + ";border:1px dashed currentColor;border-radius:999px;cursor:pointer;" + (compact ? "flex:none;" + ONE_LINE : ""));
      chip.type = "button";
      chip.setAttribute("aria-label", "Copy discount code " + cta.code);
      chip.setAttribute("aria-live", "polite");
      chip.textContent = label + " · Copy";
      chip.addEventListener("click", () => {
        onCtaClick();
        copyText(cta.code).then(
          () => { chip.textContent = label + " · Copied ✓"; setTimeout(() => { chip.textContent = label + " · Copy"; }, 2500); },
          () => { chip.textContent = label; } // can't copy: leave it readable
        );
      });
      addFocusRing(chip);
      parts.push(chip);
    }

    // Only same-site paths and http(s) links (the app already checks this).
    if (cta.href && /^(\/(?!\/)|https?:\/\/)/i.test(cta.href)) {
      button = make("a", "display:inline-block;padding:" + (compact ? "3px 12px" : "4px 14px") + ";border-radius:999px;font-weight:700;text-decoration:none;cursor:pointer;background:var(--hf-text-on-accent);color:var(--hf-accent);" + (compact ? "flex:none;" + ONE_LINE : "") + (pack.ctaStyle || ""));
      button.href = cta.href;
      button.textContent = cta.label;
      if (cta.external) {
        try { if (new URL(cta.href, location.href).hostname !== location.hostname) { button.target = "_blank"; button.rel = "noopener"; } } catch (e) { /* keep same tab */ }
      }
      button.addEventListener("click", (e) => {
        // A plain click on a link within the store waits (briefly) for the
        // cart marker, so it's on the cart before the next page loads.
        const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented && !cta.external;
        const marking = onCtaClick(!cta.external);
        if (!plain || !marking) return;
        e.preventDefault();
        const href = button.href;
        within(marking, MARKER_WAIT_MS).then(() => { window.location.href = href; });
      });
      addFocusRing(button);
      parts.push(button);
    }

    if (!compact) {
      bar.append(msg, ...parts);
      return;
    }
    const row = make("div", "display:flex;align-items:center;justify-content:center;gap:8px;max-width:100%;min-width:0;");
    if (parts.length === 1 && parts[0] === button) {
      // Button alone: share the message's line if the whole message fits.
      styleImportant(msg, "flex:0 1 auto;");
      row.append(msg, button);
      bar.append(row);
      // Runs once the banner is in the page, before it's painted.
      return () => {
        if (msg.scrollWidth <= msg.clientWidth) return;
        styleImportant(msg, "flex:none;");
        bar.insertBefore(msg, row);
      };
    }
    bar.append(msg);
    if (parts.length) { row.append(...parts); bar.append(row); }
    // A half-cut countdown ("2d 4…") is worse than none: drop " left", and
    // if it still doesn't fit, hide it. (A plain deadline line keeps its "…".)
    // The code and button don't shrink (a flex item squeezed by a fraction of a
    // pixel still gets a "…" at fractional zoom), unless they alone overflow.
    return () => {
      if (line && line.isConnected && cta.countdownTo) {
        const cut = () => line.scrollWidth > line.clientWidth + 1;
        if (cut()) {
          shortCountdown = true;
          line.update();
          if (cut()) stopCountdown();
        }
      }
      if (row.scrollWidth > row.clientWidth + 1) {
        [chip, button].forEach((el) => { if (el) styleImportant(el, "flex:0 1 auto;"); });
      }
    };
  }
  // Keyboard focus ring for the button and code chip. all:initial removes the
  // browser's, and a stylesheet can't beat our inline !important, so set it inline.
  function addFocusRing(el) {
    el.addEventListener("focus", () => {
      let visible = true;
      try { visible = el.matches(":focus-visible"); } catch (e) { /* old browser: always show */ }
      if (visible) styleImportant(el, "outline:2px solid currentColor;outline-offset:2px;");
    });
    el.addEventListener("blur", () => styleImportant(el, "outline:none;"));
  }
  // Clipboard API first; if it's missing or refuses (e.g. permissions), the
  // older execCommand route.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("style", "position:fixed;top:0;left:0;opacity:0;");
      document.body.appendChild(ta);
      ta.select();
      try { if (document.execCommand("copy")) resolve(); else reject(); } catch (e) { reject(e); } finally { ta.remove(); }
    });
  }
  // ms remaining -> "2d 4h", "3h 12m", "12m", "<1m".
  function formatCountdown(ms) {
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m > 0 ? m + "m" : "<1m";
  }
  // `compact` (phones): just the countdown when there is one.
  function deadlineLine(deadline, countdownTo, compact) {
    const end = countdownTo ? Date.parse(countdownTo) : NaN;
    if (isNaN(end)) return deadline || null;
    const left = end - Date.now();
    if (left <= 0) return null;
    if (compact) return formatCountdown(left) + " left";
    return deadline ? deadline + " · " + formatCountdown(left) + " left" : "Ends in " + formatCountdown(left);
  }
  // A single light sweep across the banner, then the highlight is removed.
  function shineOnce(bar) {
    if (prefersReducedMotion() || !bar.animate) return;
    const shine = document.createElement("span");
    shine.id = "hf-shine";
    shine.setAttribute("aria-hidden", "true");
    shine.setAttribute("style", "position:absolute;top:0;left:0;width:40%;height:100%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.28),transparent);transform:translateX(-100%);");
    bar.appendChild(shine);
    const anim = shine.animate(
      [{ transform: "translateX(-100%)" }, { transform: "translateX(260%)" }],
      { duration: 1400, delay: 500, easing: "ease-in-out" }
    );
    anim.onfinish = () => shine.remove();
  }
  function removeBanner() {
    stopWatchingOverlays();
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    const el = document.getElementById("hf-banner"); if (el) el.remove();
  }

  // Other apps (announcement bars, promo strips) often pin a fixed/absolute
  // bar to the top of the page without pushing content down, which covers
  // our banner. Find any such bar overlapping the banner and push the banner
  // below it. Bars are often injected late, so re-check on DOM changes and resize.
  let overlayObserver = null, overlayRaf = null;
  function isOurs(el) { return el.id === "hf-banner" || el.id === "hf-shine" || el.id === "hf-credit" || el.id === "hf-decoration"; }
  function pushBelowOverlays(bar) {
    bar.style.marginTop = "0px";
    const bannerTop = bar.getBoundingClientRect().top + window.scrollY; // document coords
    let bottom = 0;
    const els = document.body.querySelectorAll("*");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (isOurs(el)) continue;
      const cs = window.getComputedStyle(el);
      if ((cs.position !== "fixed" && cs.position !== "absolute") || cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.height > 200 || r.width < window.innerWidth * 0.5) continue; // bar-shaped only
      const top = cs.position === "fixed" ? r.top : r.top + window.scrollY;
      const bot = cs.position === "fixed" ? r.bottom : r.bottom + window.scrollY;
      if (top <= bannerTop + 1 && bot > bannerTop) bottom = Math.max(bottom, bot);
    }
    if (bottom > bannerTop) bar.style.marginTop = Math.ceil(bottom - bannerTop) + "px";
  }
  function watchForOverlays(bar) {
    stopWatchingOverlays();
    // Debounced: pages with carousels etc. mutate constantly, and scanning
    // the DOM is too costly to do every frame.
    const schedule = () => {
      if (overlayRaf) return;
      overlayRaf = setTimeout(() => { overlayRaf = null; if (bar.isConnected) pushBelowOverlays(bar); }, 250);
    };
    schedule();
    overlayObserver = new MutationObserver((muts) => {
      // Ignore our own animation/banner churn (incl. countdown and "Copied" text
      // inside the banner); react to other apps adding or restyling elements.
      if (muts.some((m) => !isOurs(m.target) && !bar.contains(m.target))) schedule();
    });
    overlayObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", schedule);
    watchForOverlays.schedule = schedule;
  }
  function stopWatchingOverlays() {
    if (overlayObserver) overlayObserver.disconnect();
    overlayObserver = null;
    if (overlayRaf) clearTimeout(overlayRaf);
    overlayRaf = null;
    if (watchForOverlays.schedule) window.removeEventListener("resize", watchForOverlays.schedule);
    watchForOverlays.schedule = null;
  }

  function injectCredit() {
    removeCredit();
    const badge = document.createElement("a");
    badge.id = "hf-credit";
    badge.href = "https://holidayify.app";
    badge.target = "_blank";
    badge.rel = "noopener";
    badge.textContent = "Themed by Holidayify";
    badge.setAttribute("style", "position:fixed;bottom:10px;right:10px;background:rgba(0,0,0,.65);color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:11px;padding:5px 9px;border-radius:999px;text-decoration:none;z-index:2147483000;opacity:.85;");
    document.body.appendChild(badge);
  }
  function removeCredit() { const el = document.getElementById("hf-credit"); if (el) el.remove(); }

  // Visitors who ask their OS to reduce motion get no ambient animation at all.
  function prefersReducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  // By default decorations play briefly when a visitor arrives, then fade
  // out and stop, so they never sit over products or text for long.
  // `keepDecorations` (an embed setting) restores the old non-stop loop.
  const DECORATION_SECONDS = 12;
  const FADE_SECONDS = 1.5;
  // Particles on screen at once, per effect. Kept low so they don't block content.
  const PARTICLE_COUNTS = { snow: 30, hearts: 14, bats: 12 };
  // Confetti is a one-off burst, so it scales with screen width: phones get
  // a small pop, wide desktops a fuller one.
  function particleCount(type, w) {
    if (type === "confetti") return Math.max(16, Math.min(40, Math.round(w / 30)));
    return PARTICLE_COUNTS[type] || 20;
  }

  // One full-screen canvas: fixed, so no layout shift, and click-through.
  let decorationFrame = null, decorationCanvas = null, decorationResize = null;
  function injectDecoration(type, keep) {
    removeDecoration();
    if (prefersReducedMotion()) return;
    const canvas = document.createElement("canvas");
    canvas.id = "hf-decoration";
    canvas.setAttribute("style", "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147482900;");
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    decorationCanvas = canvas;
    const ctx = canvas.getContext("2d");

    // Draw in CSS pixels, sharp on high-density screens.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    decorationResize = () => {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    decorationResize();
    window.addEventListener("resize", decorationResize);

    const particles = Array.from({ length: particleCount(type, W) }, (_, i) => makeParticle(type, W, H, i, keep));
    // Time only advances while the tab is visible (rAF pauses in background
    // tabs), so the visitor sees the full run when they actually look.
    let last = null, elapsed = 0;
    function tick(t) {
      const dt = last == null ? 0 : Math.min((t - last) / 1000, 0.05); // clamp after tab switches
      last = t;
      elapsed += dt;
      let alpha = 1;
      if (!keep && elapsed > DECORATION_SECONDS) {
        alpha = 1 - (elapsed - DECORATION_SECONDS) / FADE_SECONDS;
        if (alpha <= 0) { removeDecoration(); return; } // done: leave nothing behind
      }
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 0.9 * alpha;
      particles.forEach((p) => { p.update(dt, W, H); p.draw(ctx); });
      // One-shot effects (the confetti burst) end as soon as everything has left the screen.
      if (particles.every((p) => p.done)) { removeDecoration(); return; }
      decorationFrame = requestAnimationFrame(tick);
    }
    decorationFrame = requestAnimationFrame(tick);
  }
  function removeDecoration() {
    if (decorationFrame) cancelAnimationFrame(decorationFrame);
    if (decorationCanvas) decorationCanvas.remove();
    if (decorationResize) window.removeEventListener("resize", decorationResize);
    decorationFrame = null; decorationCanvas = null; decorationResize = null;
  }

  // Falling particles (snow, confetti, hearts). Speeds are per second, so
  // motion is the same on 60Hz and 120Hz screens.
  function makeParticle(type, w, h, i, keep) {
    if (type === "bats") return makeBat(w, h);
    if (type === "confetti") return makeConfetti(w, h, i % 2 ? 1 : -1, keep);
    const p = {
      x: Math.random() * w, y: Math.random() * h,
      vy: 30 + Math.random() * 60, vx: (Math.random() - 0.5) * 30,
      size: 6 + Math.random() * 6, rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 1.2,
    };
    p.update = function (dt, w, h) {
      this.y += this.vy * dt; this.x += this.vx * dt; this.rot += this.spin * dt;
      if (this.y > h + 20) { this.y = -20; this.x = Math.random() * w; }
    };
    p.draw = function (ctx) {
      ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
      if (type === "snow") { ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(0, 0, this.size / 4, 0, Math.PI * 2); ctx.fill(); }
      else if (type === "hearts") { ctx.fillStyle = "#F7C6D9"; drawHeart(ctx, this.size / 2); }
      ctx.restore();
    };
    return p;
  }
  function drawHeart(ctx, s) {
    ctx.beginPath(); ctx.moveTo(0, s*0.3);
    ctx.bezierCurveTo(0,0,-s,0,-s,s*0.3); ctx.bezierCurveTo(-s,s*0.7,0,s,0,s*1.3);
    ctx.bezierCurveTo(0,s,s,s*0.7,s,s*0.3); ctx.bezierCurveTo(s,0,0,0,0,s*0.3); ctx.fill();
  }

  // Confetti pops from the two top corners (party-popper style), spreads at
  // most ~40% of the way across so the middle of the page stays clear, then
  // flutters down and off the bottom. Pieces flip in 3D (front/back shades).
  // Without `keep` each piece is gone once it falls off screen, so the whole
  // burst lasts a few seconds; with `keep` pieces return as a light trickle.
  const CONFETTI_COLORS = [["#F5C400", "#B88F00"], ["#F5C400", "#B88F00"], ["#F5C400", "#B88F00"], ["#FFFFFF", "#CFCFCF"], ["#FFFFFF", "#CFCFCF"], ["#141414", "#3A3A3A"]];
  const CONFETTI_GRAVITY = 900, CONFETTI_DRAG_X = 2.5, CONFETTI_DRAG_Y = 4; // falls at ~225px/s
  function makeConfetti(w, h, side, keep) {
    const ribbon = Math.random() < 0.4;
    const reach = w * (0.06 + Math.random() * 0.34); // how far inward it travels
    return {
      x: side < 0 ? 0 : w, y: h * 0.08,
      vx: -side * reach * CONFETTI_DRAG_X, vy: -(80 + Math.random() * 320),
      w: ribbon ? 12 + Math.random() * 6 : 7 + Math.random() * 4,
      h: ribbon ? 3 : 4 + Math.random() * 2,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 6,
      flip: Math.random() * Math.PI * 2, flipRate: 4 + Math.random() * 6,
      sway: 20 + Math.random() * 30, swayRate: 2 + Math.random() * 2,
      colors: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      delay: Math.random() * 0.25, age: 0, done: false,
      update(dt, w, h) {
        if (this.done) return;
        this.age += dt;
        if (this.age < this.delay) return;
        this.vx *= Math.exp(-CONFETTI_DRAG_X * dt);
        this.vy = (this.vy + CONFETTI_GRAVITY * dt) * Math.exp(-CONFETTI_DRAG_Y * dt);
        this.x += (this.vx + Math.sin(this.age * this.swayRate) * this.sway) * dt;
        this.y += this.vy * dt;
        this.rot += this.spin * dt; this.flip += this.flipRate * dt;
        if (this.y > h + 30) {
          if (!keep) { this.done = true; return; }
          this.x = Math.random() * w; this.y = -20; this.vx = 0; this.vy = 0;
        }
      },
      draw(ctx) {
        if (this.done || this.age < this.delay) return;
        const face = Math.cos(this.flip);
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
        ctx.scale(1, Math.max(Math.abs(face), 0.15));
        ctx.fillStyle = face >= 0 ? this.colors[0] : this.colors[1];
        ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
        ctx.restore();
      },
    };
  }

  // Bats flutter across the screen (not straight down): steady sideways
  // flight, a bob in time with the wingbeat, and a 4-frame flap cycle.
  const BAT_FLAP = [-0.6, -0.15, 0.45, -0.15]; // wingtip lift per frame: up, mid, down, mid
  function makeBat(w, h) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return {
      x: Math.random() * w, y: h * (0.05 + Math.random() * 0.65),
      span: 16 + Math.random() * 12, // wingspan in px
      vx: dir * (40 + Math.random() * 40), vy: (Math.random() - 0.5) * 10,
      bob: 5 + Math.random() * 8, bobRate: 1.4 + Math.random() * 0.8,
      frameSeconds: 0.07 + Math.random() * 0.04, // flap speed
      age: Math.random() * 10,
      update(dt, w, h) {
        this.age += dt;
        this.x += this.vx * dt; this.y += this.vy * dt;
        const m = this.span;
        if (this.x > w + m) { this.x = -m; this.y = h * (0.05 + Math.random() * 0.65); }
        if (this.x < -m) { this.x = w + m; this.y = h * (0.05 + Math.random() * 0.65); }
        if (this.y < 0 || this.y > h * 0.8) this.vy = -this.vy;
      },
      draw(ctx) {
        const phase = this.age * this.bobRate * Math.PI * 2;
        const frame = Math.floor(this.age / this.frameSeconds) % BAT_FLAP.length;
        ctx.save();
        ctx.translate(this.x, this.y + Math.sin(phase) * this.bob);
        ctx.rotate(Math.cos(phase) * 0.12 * Math.sign(this.vx)); // tilt into the bob
        ctx.fillStyle = "#1C1026"; // dark purple-black
        drawBat(ctx, this.span, BAT_FLAP[frame]);
        ctx.restore();
      },
    };
  }

  // Bat silhouette centred on its body. `span` = wingspan in px; `lift` < 0
  // raises the wingtips, > 0 lowers them.
  function drawBat(ctx, span, lift) {
    const s = span, h = span / 2;
    // Wings: arched leading edge out to a pointed tip, then a scalloped
    // trailing edge (three "fingers") back to the hip.
    for (const side of [-1, 1]) {
      const tipY = lift * h * 0.7;
      ctx.beginPath();
      ctx.moveTo(side * s * 0.04, -s * 0.07);
      ctx.quadraticCurveTo(side * h * 0.45, tipY - s * 0.14, side * h, tipY);
      const f1x = h * 0.74, f1y = tipY * 0.6 + s * 0.11;
      const f2x = h * 0.44, f2y = tipY * 0.3 + s * 0.14;
      ctx.quadraticCurveTo(side * (h + f1x) / 2, (tipY + f1y) / 2 - s * 0.02, side * f1x, f1y);
      ctx.quadraticCurveTo(side * (f1x + f2x) / 2, (f1y + f2y) / 2 - s * 0.05, side * f2x, f2y);
      ctx.quadraticCurveTo(side * (f2x + s * 0.05) / 2, (f2y + s * 0.07) / 2 - s * 0.05, side * s * 0.05, s * 0.07);
      ctx.closePath();
      ctx.fill();
    }
    // Body, head, ears.
    ctx.beginPath();
    ctx.ellipse(0, s * 0.01, s * 0.065, s * 0.12, 0, 0, Math.PI * 2);
    ctx.arc(0, -s * 0.1, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.055, -s * 0.12); ctx.lineTo(-s * 0.045, -s * 0.2); ctx.lineTo(-s * 0.015, -s * 0.14);
    ctx.moveTo(s * 0.055, -s * 0.12); ctx.lineTo(s * 0.045, -s * 0.2); ctx.lineTo(s * 0.015, -s * 0.14);
    ctx.fill();
  }

  // --- Banner results (only when the merchant turned them on in the app) ---
  // `tracking` = { campaign, marker } for the holiday on screen, else null.
  // Views and clicks are sent as anonymous counts: no cookies, no storage,
  // no visitor ID. The _holidayify cart marker (lets the app credit an order
  // to a banner click) is set only when the shopper has consented to
  // analytics (Shopify's Customer Privacy API).
  let tracking = null;
  const MARKER_WAIT_MS = 800;

  function sendEvent(type) {
    if (!tracking || !currentPackKey) return;
    try {
      const url = "/apps/holidayify/event/" + encodeURIComponent(currentPackKey) + "/" + type;
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else fetch(url, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { /* counting must never break the page */ }
  }

  // Counts the click and, with consent, marks the cart. Returns the marker
  // promise (resolves when done or skipped), or null if there's no marker to set.
  function onCtaClick(withMarker = true) {
    sendEvent("click");
    if (!withMarker || !tracking || !tracking.marker) return null;
    return markCart(window, tracking.campaign);
  }

  // True only if the shopper has explicitly said yes to analytics in the
  // store's cookie banner (Shopify's Customer Privacy API) and nothing
  // overrides it. analyticsProcessingAllowed() alone isn't enough: it is also
  // true when the shopper made no choice in a region that doesn't require
  // one. No API, an error or a failed load all count as no.
  function analyticsAllowed(win) {
    return new Promise((resolve) => {
      const S = win.Shopify;
      const check = () => {
        try {
          const cp = S.customerPrivacy;
          const consent = typeof cp.currentVisitorConsent === "function" ? cp.currentVisitorConsent() : null;
          resolve(!!consent && consent.analytics === "yes" && cp.analyticsProcessingAllowed() === true);
        } catch (e) { resolve(false); }
      };
      if (S && S.customerPrivacy) return check();
      if (!S || typeof S.loadFeatures !== "function") return resolve(false);
      try {
        S.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], (err) => (err ? resolve(false) : check()));
      } catch (e) { resolve(false); }
    });
  }

  // Puts the campaign (e.g. "halloween-2026") on the cart as a hidden
  // attribute, only with consent. Resolves true if it was set.
  function markCart(win, campaign) {
    return analyticsAllowed(win).then((ok) => {
      if (!ok) return false;
      const root = (win.Shopify && win.Shopify.routes && win.Shopify.routes.root) || "/";
      return win.fetch(root + "cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: { _holidayify: campaign } }),
        keepalive: true,
      }).then((r) => r.ok, () => false);
    }, () => false);
  }

  function within(promise, ms) {
    return Promise.race([promise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
  }

  let currentPackKey = null;
  let pollTimer = null;

  function applyState(key, opts) {
    if (currentPackKey === key) return; // no-op if nothing changed
    if (currentPackKey) clearVars(PACKS[currentPackKey].vars);
    currentPackKey = key;

    if (!key) {
      tracking = null;
      removeBanner(); removeDecoration(); removeCredit();
      return;
    }
    const pack = PACKS[key];
    applyVars(pack.vars);
    // Nothing is counted in the theme editor: that's the merchant, not a shopper.
    const inEditor = !!(window.Shopify && window.Shopify.designMode);
    const campaign = !inEditor && opts.tracking && opts.tracking.campaigns && opts.tracking.campaigns[key];
    tracking = typeof campaign === "string" ? { campaign, marker: opts.tracking.marker === true } : null;
    // Merchant's own text for this holiday wins; otherwise the neutral default.
    const custom = opts.customBanners && opts.customBanners[key];
    const cta = opts.ctas && opts.ctas[key];
    if (opts.banner !== false) {
      injectBanner(typeof custom === "string" && custom.trim() ? custom : pack.bannerText, pack, cta || null);
      sendEvent("view");
    } else removeBanner();
    if (opts.decorations !== false) injectDecoration(pack.decoration, opts.keepDecorations === true); else removeDecoration();
    if (opts.credit !== false) injectCredit(); else removeCredit();
  }

  function init(options) {
    const opts = Object.assign(
      { activePacks: Object.keys(PACKS), bufferDays: 7, revertHour: 6, banner: true, decorations: true, credit: true, keepDecorations: false },
      options || {}
    );

    function evaluate() {
      const key = activePackKey(opts.activePacks, opts.bufferDays, opts.revertHour);
      applyState(key, opts);
    }

    evaluate();
    // Re-check hourly — cheap, and means the revert-at-revertHour behavior
    // actually fires without requiring a page reload.
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(evaluate, 60 * 60 * 1000);

    return { active: !!currentPackKey, theme: currentPackKey };
  }

  // `_tracking` is exposed for the app's unit tests (tests/storefront-consent.test.mjs).
  window.Holidayify = { init, packs: PACKS, _tracking: { analyticsAllowed, markCart } };
})(window, document);
