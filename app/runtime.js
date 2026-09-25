/**
 * Loads an upstream Spine WebGL build and hands back its namespace.
 *
 * Both bundles declare a top level `var spine`, which is exactly why a page normally gets to use only
 * one Spine version at a time. Inside `new Function(...)` that declaration is function scoped, so each
 * call yields an isolated namespace and the 3.7 and 4.2 runtimes can share one document - which is what
 * makes frame-locked comparison possible (one `requestAnimationFrame`, one clock, `dt` handed to both).
 * Neither bundle ever touches `window`.
 */
const cache = new Map();

export async function loadRuntime(url) {
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      const source = await (await fetch(url)).text();
      return new Function(`${source}\nreturn spine;`)();
    })());
  }
  return cache.get(url);
}

/** The two builds disagree about where the GL layer lives: 3.7 nests it, 4.2 flattens it. */
export function api(spine, version) {
  const gl = version === '3.7' ? spine.webgl : spine;
  return {
    SceneRenderer: gl.SceneRenderer,
    ResizeMode: gl.ResizeMode,
    GLTexture: gl.GLTexture,
    ShapeRenderer: gl.ShapeRenderer,
    Atlas: spine.TextureAtlas,
    SkeletonJson: spine.SkeletonJson,
    AttachmentLoader: spine.AtlasAttachmentLoader,
    Skeleton: spine.Skeleton,
    AnimationStateData: spine.AnimationStateData,
    AnimationState: spine.AnimationState,
    Color: spine.Color,
    Vector2: spine.Vector2,
    version,
  };
}
