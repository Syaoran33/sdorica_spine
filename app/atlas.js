/**
 * The `.atlas` text as data, so the inspector can draw region boxes without going through a runtime -
 * the two runtimes disagree about how to expose a region, but the file format is one of the few things
 * they both read identically.
 */

export function parseAtlas(text) {
  const pages = [];
  let page = null;
  let region = null;
  let expectPage = true;

  for (const raw of text.split('\n')) {
    if (!raw.trim()) { expectPage = true; continue; }
    const line = raw.trim();
    // Page fields are top-level too (``size: 918,918``), so a colon is what tells a field from a region.
    const field = line.includes(':') ? line.slice(0, line.indexOf(':')).trim() : null;
    const value = field ? line.slice(field.length + 1).trim() : line;
    const pair = () => value.split(',').map(Number);
    if (field && (raw[0] === ' ' || raw[0] === '\t')) {
      if (!region) continue;
      if (field === 'xy') [region.x, region.y] = pair();
      else if (field === 'bounds') [region.x, region.y, region.width, region.height] = pair();
      else if (field === 'size') [region.width, region.height] = pair();
      else if (field === 'rotate') region.rotate = value !== 'false';
      continue;
    }
    if (field) {
      if (field === 'size') [page.width, page.height] = pair();
      continue;
    }
    if (expectPage) {
      page = { name: line, regions: [] };
      pages.push(page);
      expectPage = false;
      region = null;
    } else {
      region = { name: line, rotate: false, x: 0, y: 0, width: 0, height: 0 };
      page.regions.push(region);
    }
  }
  return pages;
}

/** Draw one page with its region boxes; ``hot`` is the region under the cursor or selected. */
export function drawSheet(canvas, image, page, hot) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const scale = cssWidth / page.width;
  const cssHeight = page.height * scale;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.drawImage(image, 0, 0, page.width, page.height);
  ctx.lineWidth = 1 / scale;
  for (const region of page.regions) {
    const on = region === hot || region.name === hot?.name;
    ctx.strokeStyle = on ? '#63c2f5' : 'rgba(216, 221, 230, .35)';
    ctx.strokeRect(region.x + .5, region.y + .5, region.width - 1, region.height - 1);
    if (on) {
      ctx.fillStyle = 'rgba(99, 194, 245, .18)';
      ctx.fillRect(region.x, region.y, region.width, region.height);
    }
  }
}

/** Which region of the page a CSS-pixel point on the sheet falls in; same scale rule as drawSheet. */
export function regionAt(canvas, page, x, y) {
  const scale = canvas.clientWidth / page.width;
  const px = x / scale;
  const py = y / scale;
  return page.regions.find((r) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height);
}
