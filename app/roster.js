/** Left pane: the 魂册. One row per roster character, its staged skins underneath, series headers between. */

/** ``hero_filter_series_*`` in the localization table - the game's own names for these groups. */
const SERIES = {1: '经典', 2: 'SP', 3: 'Collab', 4: 'MZ', 5: 'OS', 6: 'DR', 0: '未列系列'};

/** ``Heroes.black / gold / white``, in the game's own wording. */
const TIER = {black: '黑位', gold: '金位', white: '白位'};

export function buildRoster(list, manifest, onPick) {
  // Keyed by ``id`` (the staged directory), because a sub-directory skeleton usually reuses its parent's
  // file name: ``b0037s5`` and its ``s1`` cut-in are both ``b0037s5.json.gz``, one in each directory.
  const bySkin = new Map(manifest.skins.map((entry) => [entry.id, entry]));
  const nodes = [];

  const header = (series) => {
    const band = document.createElement('h3');
    band.className = 'group';
    band.textContent = SERIES[series] ?? `系列${series}`;
    list.append(band);
    return band;
  };

  const skinRow = (entry, search) => {
    const row = document.createElement('div');
    row.className = 'skin';
    row.dataset.skin = entry.id;
    row.dataset.search = [...search, entry.skin, entry.name].filter(Boolean).join(' ').toLowerCase();
    // A skin with a name of its own leads with it; the id it is addressed by stays readable on the right.
    row.innerHTML = `${entry.name || entry.id}<small>` +
      `${entry.name ? `${entry.id} · ` : ''}${entry.v42 ? '4.2 ' : ''}${entry.v32.animations.length} 动画 · ` +
      `${(entry.v32.frames / 1000).toFixed(1)}k 帧</small>`;
    row.onclick = () => onPick(entry.id);
    nodes.push(row);
    return row;
  };

  let band = null;
  let bandLabel = '';
  for (const character of manifest.characters) {
    if (band === null || band.dataset.series !== String(character.series)) {
      band = header(character.series);
      band.dataset.series = String(character.series);
      bandLabel = band.textContent;
    }
    // 碎牙 is two roster rows over one model; the label should not say it twice.
    const name = [...new Set(character.rows.map((row) => row.name))].join('/');
    const tier = TIER[character.rows[0].tier];
    const details = document.createElement('details');
    details.className = 'char';
    details.dataset.tier = character.rows[0].tier;
    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = tier ? `${character.model} · ${tier}` : character.model;
    summary.append(label, meta);
    details.append(summary);
    for (const id of character.skins) {
      const words = [id, name, bandLabel, tier, ...character.rows.map((r) => r.traditional)];
      details.append(skinRow(bySkin.get(id), words));
    }
    list.append(details);
  }

  // Whatever ``--everything`` landed that no roster row claims, so a full dump is still reachable.
  const claimed = new Set(manifest.characters.flatMap((c) => c.skins));
  const others = manifest.skins.filter((entry) => !claimed.has(entry.id));
  if (others.length) {
    band = header(0);
    band.dataset.series = 'other';
    band.textContent = `未入魂册 ${others.length}`;
    for (const entry of others) list.append(skinRow(entry, [entry.id, entry.base]));
  }

  return {
    highlight(selected) {
      for (const node of nodes) node.classList.toggle('sel', node.dataset.skin === selected);
      const row = nodes.find((node) => node.dataset.skin === selected);
      if (row) {
        row.closest('details')?.setAttribute('open', '');
        row.scrollIntoView({ block: 'nearest' });
      }
    },
    filter(query, tier) {
      const text = query.trim().toLowerCase();
      for (const node of nodes) {
        node.hidden = !!text && !node.dataset.search.includes(text);
      }
      // Bands are forward-ordered, so one pass decides rows and remembers whether each band kept anything.
      let band = null;
      const kept = new Set();
      for (const node of list.children) {
        if (node.classList.contains('group')) {
          band = node;
          node.hidden = true;
          continue;
        }
        const rows = [...node.querySelectorAll('.skin')];
        const matches = (rows.length ? rows : [node]).some((row) => !row.hidden);
        const byTier = tier === 'all' || node.dataset.tier === tier;
        node.hidden = !(matches && byTier);
        if (matches && byTier) {
          kept.add(band);
          if (text) node.open = true;
        }
      }
      for (const node of kept) node.hidden = false;
    },
  };
}
