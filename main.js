// Pulse: DOM and drawing. Reads each track's meter once per frame and draws glowing rings and bars.

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');
let luna, session;
let releases = [];
const keep = (u) => releases.push(u);
const release = () => { for (const u of releases) u(); releases = []; };
const watched = new Set(); // track ids whose meters we observe

const shown = new Map(); // track id -> smoothed level
let playing = false;
let last = performance.now();
const t0 = last;
let W = 0, H = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const time = (now - t0) / 1000;

  const live = session ? AddOnLogic.voices(session) : [];
  let total = 0;
  const voices = live.map((v) => {
    const target = v.muted ? 0 : AddOnLogic.shape(v.level);
    const s = AddOnLogic.smooth(shown.get(v.id) ?? 0, target, dt);
    shown.set(v.id, s);
    total += s;
    return { ...v, s };
  });
  const energy = voices.length ? Math.min(1, total / Math.max(1, voices.length * 0.5)) : 0;

  // Background with soft trails.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(5,5,10,0.28)';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.44;
  const R = Math.min(W, H) * 0.36;
  ctx.globalCompositeOperation = 'lighter';

  // Core glow, coloured by whichever tracks are loudest.
  const wsum = voices.reduce((a, v) => a + v.s + 0.01, 0);
  const hueMix = voices.length ? voices.reduce((a, v) => a + v.hue * (v.s + 0.01), 0) / wsum : 220;
  const coreR = R * (0.18 + 0.22 * energy) + Math.sin(time * 1.3) * 3;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
  g.addColorStop(0, `hsla(${hueMix},90%,75%,${0.35 + 0.5 * energy})`);
  g.addColorStop(0.4, `hsla(${hueMix},90%,55%,${0.12 + 0.25 * energy})`);
  g.addColorStop(1, 'hsla(0,0%,0%,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, coreR * 2.4, 0, Math.PI * 2); ctx.fill();

  // One ring per track.
  const n = Math.max(1, voices.length);
  ctx.lineCap = 'round';
  voices.forEach((v, i) => {
    const base = R * (0.32 + 0.68 * (i + 1) / n);
    const r = base + v.s * R * 0.12;
    const alpha = 0.12 + v.s * 0.85;
    const spin = time * (0.15 + i * 0.03) * (i % 2 ? -1 : 1);
    const arc = Math.PI * 2 * (0.25 + 0.75 * v.s);
    ctx.shadowColor = `hsla(${v.hue},100%,60%,${alpha})`;
    ctx.shadowBlur = 8 + v.s * 30;
    ctx.strokeStyle = `hsla(${v.hue},95%,${55 + v.s * 20}%,${alpha})`;
    ctx.lineWidth = 1.5 + v.s * 7;
    ctx.beginPath(); ctx.arc(cx, cy, r, spin, spin + arc); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, spin + Math.PI, spin + Math.PI + arc * 0.5); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `hsla(${v.hue},60%,50%,0.06)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, base, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.shadowBlur = 0;

  // Glow bars along the bottom, with a faint reflection.
  const gap = 6;
  const bw = Math.max(4, Math.min(60, (W * 0.8 - gap * (n - 1)) / n));
  const startX = cx - (bw * n + gap * (n - 1)) / 2;
  const floor = H - 40, maxH = H * 0.16;
  voices.forEach((v, i) => {
    const x = startX + i * (bw + gap);
    const h = 2 + v.s * maxH;
    const grad = ctx.createLinearGradient(0, floor - h, 0, floor);
    grad.addColorStop(0, `hsla(${v.hue},100%,75%,${0.4 + v.s * 0.6})`);
    grad.addColorStop(1, `hsla(${v.hue},100%,45%,0.25)`);
    ctx.fillStyle = grad;
    ctx.shadowColor = `hsla(${v.hue},100%,60%,0.8)`;
    ctx.shadowBlur = 6 + v.s * 24;
    ctx.fillRect(x, floor - h, bw, h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `hsla(${v.hue},100%,60%,${0.08 + v.s * 0.15})`;
    ctx.fillRect(x, floor + 3, bw, h * 0.35);
  });

  // Track names under the bars while stopped.
  if (!playing && bw >= 30) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '10px -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    voices.forEach((v, i) => {
      ctx.fillStyle = `hsla(${v.hue},60%,70%,0.5)`;
      ctx.fillText(v.name.slice(0, 10), startX + i * (bw + gap) + bw / 2, floor + 22);
    });
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// LUNA can report the session changing several times in a row while a window opens, so a bind
// may start before the last one finished. Each bind takes a number; an older one stops as soon as
// a newer one starts, so it can never unsubscribe the meters the newer one is watching.
let bindGeneration = 0;

async function watchMeters(generation) {
  if (!session) return;
  for (const track of session.visibleTracks) {
    if (generation !== bindGeneration) return;
    if (watched.has(track.id)) continue;
    watched.add(track.id);
    await track.loadStrip();
    if (generation !== bindGeneration) return;
    // Observing a meter subscribes to it; the frame loop reads track.meter.max.
    if (track.meter) keep(track.meter.onChange(() => {}));
  }
}

async function bindSession() {
  const generation = ++bindGeneration;
  release();
  watched.clear();
  shown.clear();
  session = luna.sessions.current();
  if (!session) { $('status').textContent = 'no session open'; return; }
  await session.ready();
  if (generation !== bindGeneration) return;
  $('status').textContent = session.name.value ?? '';
  const t = session.transport;
  const paint = () => {
    playing = t.playing.value === true;
    document.body.classList.toggle('playing', playing);
  };
  paint();
  keep(t.playing.onChange(paint));
  keep(session.tracks.onChange(() => void watchMeters(generation)));
  await watchMeters(generation);
}

async function connect() {
  for (;;) {
    try { luna = await Luna.connect(); break; }
    catch (e) {
      $('status').textContent = e instanceof Luna.NotRunning ? 'waiting for LUNA...' : e.message;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  luna.status.onChange(() => { if (luna.status.value === 'disconnected') $('status').textContent = 'reconnecting...'; });
  await bindSession();
}

connect();
