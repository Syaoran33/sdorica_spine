/**
 * One rendered skeleton: WebGL context, atlas, animation state, camera.
 *
 * The two panes of the workbench are two `Stage`s built from two different runtimes over the same four
 * files on disk. Everything that could make them disagree for reasons unrelated to the format - the
 * device pixel ratio, the world-unit scale, the frame clock, the animation time - is pinned here to a
 * value the app hands in, so a visible difference means a real difference.
 */

import { api } from './runtime.js';

/** Fixed clock. Both stages receive the same dt sequence, so they can never drift apart. */
export const FRAME_HZ = 60;

const files = new Map();

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

/**
 * ``*.json.gz`` as text. ``DecompressionStream`` rather than ``Content-Encoding`` so the site is a plain
 * directory: any static file server, no nginx config, ``python -m http.server`` included.
 */
export async function gzippedJson(url) {
  if (!files.has(url)) {
    const buffer = await (await fetchOk(url)).arrayBuffer();
    const text = await new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    files.set(url, text);
    if (files.size > 4) files.delete(files.keys().next().value);
  }
  return files.get(url);
}

/** An atlas lists one page image per blank-line-separated block, before that block's ``key: value`` lines. */
function pageNames(atlasText) {
  const names = [];
  let expect = true;
  for (const line of atlasText.split('\n')) {
    const text = line.trim();
    if (!text) expect = true;
    else if (expect && !text.includes(':')) { names.push(text); expect = false; }
  }
  return names;
}

function image(url) {
  return new Promise((done, fail) => {
    const node = new Image();
    node.onload = () => done(node);
    node.onerror = () => fail(new Error(`image failed: ${url}`));
    node.src = url;
  });
}

export class Stage {
  constructor(canvas, spine, version, dpr) {
    this.canvas = canvas;
    this.version = version;
    this.A = api(spine, version);
    // 3.7 is a WebGL1 build, 4.2 a WebGL2 one; they live on separate canvases and never share a context.
    const context = version === '3.7' ? 'webgl' : 'webgl2';
    this.gl = canvas.getContext(context, {
      alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true,
    });
    // twoColorTint would ask for a dark-tint channel that 3.2 skeletons do not carry.
    this.scene = new this.A.SceneRenderer(canvas, this.gl, false);
    this.physics = version === '3.7' ? undefined : spine.Physics.update;
    this.dpr = dpr;
    this.unitsPerCssPx = 1;
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;
    this.skeleton = null;
    this.animationName = null;
    this.loop = true;
    this.time = 0;
    this.frame = 0;
    this.skinName = 'default';
    this.debug = false;
    this.background = [0.4, 0.4, 0.4, 1];
  }

  async load(entry, format) {
    // Both bundles free their page textures this way, so browsing 300 skins does not pile up 300 atlas pages.
    if (this.atlas) this.atlas.dispose();
    const dir = `spinedata/${entry.dir}/`;
    const atlasText = await (await fetchOk(dir + entry.atlas)).text();
    const pages = pageNames(atlasText);
    const images = await Promise.all(pages.map((page) => image(dir + page)));
    const atlas = this.buildAtlas(atlasText, pages, images);
    const json = await gzippedJson(dir + entry[format].file);

    const A = this.A;
    this.atlas = atlas;
    this.images = images;
    this.data = new A.SkeletonJson(new A.AttachmentLoader(atlas)).readSkeletonData(json);
    this.skeleton = new A.Skeleton(this.data);
    this.stateData = new A.AnimationStateData(this.data);
    this.state = new A.AnimationState(this.stateData);
    this.animations = this.data.animations.map((a) => ({ name: a.name, duration: a.duration }));
    this.skins = this.data.skins.map((s) => s.name);
    this.setSkin('default');
    this.skeleton.setToSetupPose();
    this.pose();
    this.setup = this.bounds();
    return this;
  }

  buildAtlas(atlasText, pages, images) {
    const A = this.A;
    if (this.version === '3.7') {
      // 3.7 wants a synchronous loader and calls setFilters itself.
      return new A.Atlas(atlasText, (name) => new A.GLTexture(this.gl, images[pages.indexOf(name)]));
    }
    const atlas = new A.Atlas(atlasText);
    atlas.pages.forEach((page, i) => page.setTexture(new A.GLTexture(this.gl, images[i])));
    return atlas;
  }

  /**
   * World-space AABB of the current pose. Same idea in both versions, different accessor: 4.2 added
   * ``getBoundsRect`` and kept ``getBounds(offset, size)`` as the low-level form that writes the extent
   * into ``size.x`` / ``size.y`` rather than into a rect.
   *
   * Both builds seed the scan at ``min = +Infinity`` / ``max = -Infinity`` and never touch it when nothing
   * is visible, so an empty pose gives ``x = Infinity``, ``width = -Infinity`` rather than a zero box. A
   * point at the origin is what the callers actually want, and it keeps the union in ``measure`` out of
   * ``Infinity + -Infinity = NaN``.
   */
  bounds() {
    const box = this.version === '3.7' ? (() => {
      const offset = new this.A.Vector2();
      const size = new this.A.Vector2();
      this.skeleton.getBounds(offset, size);
      return { x: offset.x, y: offset.y, width: size.x, height: size.y };
    })() : (() => {
      const rect = this.skeleton.getBoundsRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })();
    return Number.isFinite(box.width) && Number.isFinite(box.height)
      ? box : { x: 0, y: 0, width: 0, height: 0 };
  }

  /**
   * Put the camera on the pane. The viewport is expressed in CSS pixels times ``unitsPerCssPx``, never in
   * backing store pixels, so a higher device pixel ratio buys sharpness without changing the size on screen.
   */
  sync(dpr, cssWidth, cssHeight) {
    this.dpr = dpr;
    const backing = [Math.max(1, Math.round(cssWidth * dpr)), Math.max(1, Math.round(cssHeight * dpr))];
    if (this.canvas.width !== backing[0] || this.canvas.height !== backing[1]) {
      this.canvas.width = backing[0];
      this.canvas.height = backing[1];
    }
    this.gl.viewport(0, 0, backing[0], backing[1]);
    const camera = this.scene.camera;
    camera.viewportWidth = cssWidth * this.unitsPerCssPx / this.zoom;
    camera.viewportHeight = cssHeight * this.unitsPerCssPx / this.zoom;
    camera.position.x = this.pan.x;
    camera.position.y = this.pan.y;
    camera.update();
  }

  /** Whether the current pose would put any ink down - an attachment that is not fully transparent. */
  shown() {
    for (const slot of this.skeleton.drawOrder) {
      if (slot.attachment && slot.color.a > 0) return true;
    }
    return false;
  }

  /**
   * World AABB that covers the whole current animation, plus two frame indices that say where the art
   * actually is: ``first`` (the first sample with something visible) and ``best`` (the sample with the
   * most). Both are judged on ``shown``, not on the box - ``b0015s5/b0015s5_meat`` has geometry at
   * frame 0 behind an alpha of 0, which is just as blank a pane as having none.
   *
   * The setup pose is not a usable frame of reference on its own. A per-skill cut-in skeleton
   * (``b0037s5/s1``) has **no** setup attachment - every slot is null and the animation's own attachment
   * timelines bring the parts in a few frames later - so its setup bounds are a point at the origin, and
   * a camera fitted to that sits 500 world units away from anything that is ever drawn. Sampling is
   * incremental rather than ``reach``-based: exactness matters for what gets drawn, not for where the
   * camera goes. The pose is restored at the end.
   */
  measure(frames) {
    const at = this.frame;
    const loop = this.loop;
    const box = { ...this.setup };
    let first = null;
    let best = 0;
    let area = -1;
    const stride = Math.max(1, Math.ceil(frames / 24));
    const dt = stride / FRAME_HZ;
    this.setAnimation(this.animationName, true);
    this.pose();
    for (let frame = 0; frame <= frames; frame += stride) {
      const b = this.bounds();
      if (b.width > 0 || b.height > 0) {
        const right = Math.max(box.x + box.width, b.x + b.width);
        const top = Math.max(box.y + box.height, b.y + b.height);
        box.x = Math.min(box.x, b.x);
        box.y = Math.min(box.y, b.y);
        box.width = right - box.x;
        box.height = top - box.y;
        if (this.shown()) {
          if (first === null) first = frame;
          if (b.width * b.height > area) {
            area = b.width * b.height;
            best = frame;
          }
        }
      }
      this.state.update(dt);
      this.pose();
    }
    this.loop = loop;
    this.reach(at);
    return { ...box, first: first ?? 0, best };
  }

  /**
   * Put the measured box on the pane. A skeleton that is empty for its whole timeline has a zero-extent
   * box - some fx ones are - so the extent is floored at one world unit, which frames it at 1:1 instead
   * of dividing by zero.
   */
  fit(box, cssWidth, cssHeight, margin = 0.9) {
    const width = Math.max(box.width, 1);
    const height = Math.max(box.height, 1);
    this.unitsPerCssPx = Math.max(width / cssWidth, height / cssHeight) / margin;
    this.zoom = 1;
    this.pan = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /**
   * Animation to skeleton to world transforms. 4.2 made the physics mode a required argument of
   * ``updateWorldTransform`` (there is a physics-constraint layer that 3.2 has no equivalent of); these
   * skeletons carry no such constraint, so ``update`` is exactly the 3.7 behaviour.
   */
  pose() {
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform(this.physics);
  }

  setSkin(name) {
    const skin = name === null || name === undefined ? null : this.data.findSkin(name);
    if (this.version === '3.7') this.skeleton.skin = skin;
    else this.skeleton.setSkin(skin);
    this.skeleton.setSlotsToSetupPose();
    this.skinName = name ?? 'default';
  }

  setAnimation(name, loop = true) {
    this.animationName = name;
    this.loop = loop;
    this.time = 0;
    this.frame = 0;
    this.state.clearTracks();
    this.track = this.state.setAnimation(0, name, loop);
  }

  /**
   * Put the state at a frame index by replaying the fixed clock from zero without drawing. This is why
   * scrubbing needs no seek API: the runtime is only ever asked to advance by exactly 1/60 s.
   */
  reach(frame) {
    this.setAnimation(this.animationName, this.loop);
    const dt = 1 / FRAME_HZ;
    for (let i = 0; i < frame; i++) this.state.update(dt);
    this.frame = frame;
    this.time = frame * dt;
    this.pose();
  }

  tick() {
    const dt = 1 / FRAME_HZ;
    this.state.update(dt);
    this.frame += 1;
    this.time += dt;
    this.pose();
  }

  draw(cssWidth, cssHeight) {
    this.sync(this.dpr, cssWidth, cssHeight);
    const gl = this.gl;
    gl.clearColor(this.background[0], this.background[1], this.background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const scene = this.scene;
    scene.begin();
    scene.drawSkeleton(this.skeleton, false, -1, -1, null);
    if (this.debug) scene.drawSkeletonDebug(this.skeleton, false, null);
    scene.end();
  }

  /** RGBA of the drawn pixels, as one uint8 array - the parity check and the thumbnail both read this. */
  pixels() {
    const buffer = new Uint8Array(this.canvas.width * this.canvas.height * 4);
    this.gl.readPixels(0, 0, this.canvas.width, this.canvas.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, buffer);
    return buffer;
  }
}
