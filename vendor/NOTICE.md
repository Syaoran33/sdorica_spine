# Vendored Spine runtimes — provenance and license

Two builds of the official Spine WebGL runtime, both unmodified except for the deletion of
the trailing `//# sourceMappingURL=` comment (we do not ship `.map` files, and the comment
makes devtools log a 404).

| File | Version | Where it came from | Bytes (after that one deletion) |
|---|---|---|---|
| `spine-webgl-3.7.js` | 3.7 | `raw.githubusercontent.com/EsotericSoftware/spine-runtimes/3.7/spine-ts/build/spine-webgl.js` | 368744 |
| `spine-webgl-4.2.js` | 4.2 | `cdn.jsdelivr.net/npm/@esotericsoftware/spine-webgl@4.2/dist/iife/spine-webgl.js` | 554504 |

Fetched 2026-09-25. No build step produced these; they are upstream's own prebuilt bundles.

## Why two versions

Every skeleton in this project is **Spine 3.2.01** binary, decoded to 3.2-structure JSON by
`pydorica/utils/skel2json.py`. A 3.8-or-newer JSON reader iterates `skins` as an **array**,
while 3.2 documents keep the **object** form, so the newest runtime that reads our JSON as-is
is **3.7**. The **4.2** side shows the same skeleton after the upconversion described in
`README.md`, which is what makes the two panes a comparison rather than a duplicate.

`app/runtime.js` loads both into one document. Each build declares its own `var spine`, so
they are evaluated inside `new Function(...)` and the returned namespace is kept locally —
there is no global `spine`, and the two never see each other.

## License

Both files are covered by `LICENSE.md` (Spine Runtimes License Agreement, last updated
2019-05-01, Copyright (c) 2013-2019 Esoteric Software LLC). In short: integrating them into a
product is permitted under Section 2 of the Spine Editor License Agreement, and **each user of
the resulting product must hold their own Spine Editor license**; redistribution in any form
must carry this license and copyright notice. That is why this directory, `LICENSE.md` and
this file travel with any copy of the preview.

Esoteric Software LLC is not affiliated with this repository, provides no support for it, and
does not sponsor it. The game data rendered here belongs to Draganest and is an offline
archival dump.
