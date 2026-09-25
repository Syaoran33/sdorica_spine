/**
 * The workbench: roster on the left, the two locked panes in the middle, the atlas sheet on the right.
 *
 * One rAF loop drives both stages against one fixed 60 Hz clock, so the two formats are always showing
 * the same frame index. Camera (zoom/pan) is shared so a difference on screen is a difference in the data.
 */

import { loadRuntime } from './runtime.js';
import { Stage, FRAME_HZ } from './stage.js';
import { buildRoster } from './roster.js';
import { parseAtlas, drawSheet, regionAt } from './atlas.js';

const $ = (id) => document.getElementById(id);
const loading = $('loading');
const dpr = window.devicePixelRatio || 1;
const url = new URL(location.href);
const params = url.searchParams;
const startup = { anim: params.get('anim'), frame: Number(params.get('f') || 0) };

// The one file that changes when the staging scripts are re-run, so it is never read from cache.
const manifest = await (await fetch('data/manifest.json', { cache: 'no-store' })).json();
const bySkin = new Map(manifest.skins.map((s) => [s.id, s]));
const [spine37, spine42] = await Promise.all([
  loadRuntime('vendor/spine-webgl-3.7.js'), loadRuntime('vendor/spine-webgl-4.2.js'),
]);

const panes = new Map();
for (const node of document.querySelectorAll('.pane')) {
  panes.set(node.dataset.side, {
    side: node.dataset.side,
    frame: node.querySelector('.frame'),
    canvas: node.querySelector('canvas'),
    facts: node.querySelector('.facts'),
    stage: null,
  });
}

const app = {
  skin: null, anim: null, frame: 0, frames: 1, playing: false, speed: 1, loop: true,
  dirty: true, hot: null, page: null, image: null,
};

const live = () => [...panes.values()].filter((pane) => pane.stage);
const px = (pane) => [pane.frame.clientWidth, pane.frame.clientHeight];

function invalidate() { app.dirty = true; }

// --------------------------------------------------------------------- the clock

/** Advance both stages by ``n`` fixed steps, wrapping together so the panes never drift apart. */
function advance(n) {
  const list = live();
  for (let step = 0; step < n; step++) {
    app.frame = app.loop && app.frame + 1 > app.frames ? 0 : app.frame + 1;
    if (app.frame === 0) {
      // Replaying from zero is what keeps looped playback frame-exact in both runtimes at once.
      for (const pane of list) pane.stage.reach(0);
    } else {
      for (const pane of list) pane.stage.tick();
    }
  }
  invalidate();
}

function seek(frame) {
  app.frame = Math.max(0, Math.min(app.frames, frame));
  for (const pane of live()) pane.stage.reach(app.frame);
  invalidate();
}

let last = 0;
let accumulator = 0;
function play(now) {
  requestAnimationFrame(play);
  const delta = Math.min(now - last, 250);
  last = now;
  if (app.playing) {
    accumulator += delta * app.speed;
    const budget = Math.floor(accumulator / (1000 / FRAME_HZ));
    accumulator -= budget * (1000 / FRAME_HZ);
    if (budget) advance(budget);
  }
  if (app.dirty) {
    for (const pane of live()) pane.stage.draw(...px(pane));
    paint();
    app.dirty = false;
  }
}

function paint() {
  $('frame').value = String(app.frame);
  $('scrub').value = String(app.frame);
  $('seconds').textContent = (app.frame / FRAME_HZ).toFixed(3);
  $('total').textContent = String(app.frames);
  pushUrl();
}

/**
 * The frame lives in the URL so a comparison is shareable, but ``replaceState`` is throttled -
 * rewriting history 60 times a second is exactly what browsers push back on.
 */
let urlAt = 0;
function pushUrl() {
  const now = Date.now();
  if (now - urlAt < 500) return;
  urlAt = now;
  history.replaceState(null, '',
    `${location.pathname}?skin=${encodeURIComponent(app.skin)}&anim=${encodeURIComponent(app.anim)}&f=${app.frame}`);
}

function setPlaying(on) {
  app.playing = on;
  accumulator = 0;
  $('play').textContent = on ? '⏸ 暂停' : '▶ 播放';
  $('play').classList.toggle('on', on);
}

// --------------------------------------------------------------------- loading

async function open(id) {
  const entry = bySkin.get(id);
  if (!entry) throw new Error(`manifest 里没有 ${id}`);
  app.skin = id;
  app.entry = entry;
  loading.hidden = false;
  loading.textContent = `载入 ${id}…`;

  for (const pane of panes.values()) {
    const made = entry[pane.side];
    pane.canvas.hidden = !made;
    if (!made) {
      // A dropped stage keeps its context on the canvas, so the pane just stops being drawn into.
      pane.stage = null;
      pane.facts.textContent = '';
      pane.frame.dataset.note = '这条骨架还没有 4.2 侧：用 dev/web_bridge.py 桥过来之后刷新。';
      pane.frame.classList.add('empty');
      continue;
    }
    pane.frame.classList.remove('empty');
    if (!pane.stage) {
      pane.stage = new Stage(pane.canvas, pane.side === 'v32' ? spine37 : spine42,
        pane.side === 'v32' ? '3.7' : '4.2', dpr);
    }
    await pane.stage.load(entry, pane.side);
    pane.facts.textContent = `${made.bones}骨 ${made.slots}槽 ${made.attachments}附件 ` +
      `${made.animations.length}动画 ${(made.bytes / 1024).toFixed(0)}KiB`;
  }

  const characters = manifest.characters.filter((c) => c.skins.includes(id));
  $('title').textContent = `${characters.map((c) => [...new Set(c.rows.map((r) => r.name))].join('/')).join(' ')} ` +
    `${entry.base} · ${entry.id}`;
  loading.textContent = `${id} 就绪`;
  setTimeout(() => { loading.hidden = true; }, 400);

  fill(entry);
  showSheet(entry);
  // The names are alphabetical, so the first is usually "Die1"; open on something that loops instead.
  const idle = entry.v32.animations.find(([name]) => /^(idle|def|ready|stand|normal|move)/i.test(name))?.[0];
  // The deep link names an animation of the skin it was copied from; applying it to the next skin the
  // user clicks would be wrong, so it is consumed once.
  const wanted = startup.anim && entry.v32.animations.some(([name]) => name === startup.anim)
    ? startup.anim : idle || entry.v32.animations[0][0];
  selectAnim(wanted);
  const landing = startup.frame;
  seek(landing);
  startup.anim = null;
  startup.frame = 0;
  // A cut-in skeleton is empty at frame 0 by its animation's own design (every attachment timeline starts
  // null and swaps the parts in a frame or thirty later), so rather than open on a black pane, open on the
  // fullest frame the measurement found. Skins that already show something at frame 0 are left there.
  const shown = fit();
  if (!landing && shown.first) seek(shown.best);
  roster.highlight(id);
}

function fill(entry) {
  const anim = $('anim');
  anim.replaceChildren(...entry.v32.animations.map(([name]) => {
    const option = document.createElement('option');
    option.value = option.textContent = name;
    return option;
  }));
  anim.onchange = () => selectAnim(anim.value);
}

function selectAnim(name) {
  const [, duration] = app.entry.v32.animations.find(([anim]) => anim === name);
  app.anim = name;
  app.frames = Math.max(1, Math.round(duration * FRAME_HZ));
  $('anim').value = name;
  $('scrub').max = String(app.frames);
  for (const pane of live()) pane.stage.setAnimation(name, app.loop);
  seek(0);
}

// --------------------------------------------------------------------- camera

/** Frame both panes on the whole animation and hand back the 3.2 side's measurement. */
function fit() {
  let seen = null;
  for (const pane of live()) {
    const box = pane.stage.measure(app.frames);
    pane.stage.fit(box, ...px(pane));
    if (pane.side === 'v32') seen = box;
  }
  invalidate();
  return seen;
}

function view(pane, zoom, pan) {
  const targets = $('sync').checked ? live() : [pane];
  for (const target of targets) {
    target.stage.zoom = zoom;
    target.stage.pan = pan;
  }
  invalidate();
}

for (const pane of panes.values()) {
  let drag = null;
  pane.canvas.onpointerdown = (event) => {
    if (!pane.stage) return; // the 4.2 pane has no stage until its side is bridged
    drag = { x: event.clientX, y: event.clientY, pan: { ...pane.stage.pan } };
    pane.canvas.setPointerCapture(event.pointerId);
  };
  pane.canvas.onpointermove = (event) => {
    if (!drag) return;
    const scale = pane.stage.unitsPerCssPx / pane.stage.zoom;
    view(pane, pane.stage.zoom, {
      x: drag.pan.x - (event.clientX - drag.x) * scale,
      y: drag.pan.y + (event.clientY - drag.y) * scale,
    });
  };
  pane.canvas.onpointerup = () => { drag = null; };
  pane.canvas.onwheel = (event) => {
    event.preventDefault();
    if (!pane.stage) return;
    const factor = Math.exp(-event.deltaY * 0.0015);
    view(pane, Math.min(24, Math.max(0.2, pane.stage.zoom * factor)), pane.stage.pan);
  };
  pane.canvas.ondblclick = () => {
    if (!pane.stage) return;
    pane.stage.fit(pane.stage.measure(app.frames), ...px(pane));
    invalidate();
  };
}

new ResizeObserver(invalidate).observe($('panes'));

// --------------------------------------------------------------------- inspector

async function showSheet(entry) {
  const text = await (await fetch(`spinedata/${entry.dir}/${entry.atlas}`)).text();
  const page = parseAtlas(text)[0];
  const list = $('region-list');
  $('pagesize').textContent = `${page.width}×${page.height} · ${entry.regions} 区域`;
  app.page = page;
  app.image = panes.get('v32').stage.images[0];
  app.hot = app.pin = null;
  list.replaceChildren(...page.regions.map((region) => {
    const row = document.createElement('div');
    row.textContent = region.name;
    const span = document.createElement('span');
    span.textContent = `${region.width}×${region.height}${region.rotate ? ' ↻' : ''}`;
    row.append(span);
    row.onmouseenter = () => hover(region);
    row.onclick = () => pin(region);
    return row;
  }));
  redraw();
}

function hover(region) { app.hot = region; redraw(); }

function pin(region) {
  app.pin = app.pin && app.pin.name === region.name ? null : region;
  [...$('region-list').children].forEach((row) =>
    row.classList.toggle('sel', row.firstChild.textContent === app.pin?.name));
  redraw();
}

function redraw() {
  if (app.page) drawSheet($('sheet'), app.image, app.page, app.pin || app.hot);
}

$('sheet').onpointermove = (event) => hover(regionAt($('sheet'), app.page, event.offsetX, event.offsetY));
$('sheet').onpointerleave = () => hover(null);
$('sheet').onclick = () => app.hot && pin(app.hot);

// --------------------------------------------------------------------- controls

$('play').onclick = () => setPlaying(!app.playing);
$('back').onclick = () => { setPlaying(false); seek(app.frame - 1); };
$('forth').onclick = () => { setPlaying(false); seek(app.frame + 1); };
$('prev-anim').onclick = () => cycleAnim(-1);
$('next-anim').onclick = () => cycleAnim(1);
$('scrub').oninput = (event) => { setPlaying(false); seek(Number(event.target.value)); };
$('frame').onchange = (event) => { setPlaying(false); seek(Number(event.target.value)); };
$('speed').onchange = (event) => { app.speed = Number(event.target.value); };
$('loop').onchange = (event) => {
  app.loop = event.target.checked;
  for (const pane of live()) pane.stage.setAnimation(app.anim, app.loop);
  seek(app.frame);
};
$('debug').onchange = (event) => {
  for (const pane of live()) pane.stage.debug = event.target.checked;
  invalidate();
};
$('fit').onclick = fit;

function cycleAnim(step) {
  const names = app.entry.v32.animations.map(([name]) => name);
  selectAnim(names[(names.indexOf(app.anim) + step + names.length) % names.length]);
}

addEventListener('keydown', (event) => {
  if (event.target.matches('input, select')) return;
  const keys = {
    ' ': () => setPlaying(!app.playing),
    ArrowLeft: () => { setPlaying(false); seek(app.frame - 1); },
    ArrowRight: () => { setPlaying(false); seek(app.frame + 1); },
    b: () => cycleAnim(-1), f: () => cycleAnim(1),
    r: fit,
  };
  if (keys[event.key]) { event.preventDefault(); keys[event.key](); }
});

// --------------------------------------------------------------------- roster

const roster = buildRoster($('list'), manifest, open);
$('search').oninput = (event) => roster.filter(event.target.value, tier);
let tier = 'all';
for (const button of $('filters').children) {
  button.onclick = () => {
    tier = button.dataset.tier;
    for (const other of $('filters').children) other.classList.toggle('on', other === button);
    roster.filter($('search').value, tier);
  };
}

const first = params.get('skin') && bySkin.has(params.get('skin')) ? params.get('skin') : manifest.skins[0].id;
await open(first);
requestAnimationFrame(play);
