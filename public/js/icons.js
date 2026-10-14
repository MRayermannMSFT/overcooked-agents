/**
 * Original, hand-authored 24×24 icons. Each icon is a list of [pathData, fill, stroke, strokeWidth].
 * Used both as inline SVG in the HUD and drawn onto canvases for 3D textures (crate lids, signs).
 */
const I = {
  book: [
    ['M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21z', '#d9443a'],
    ['M6.5 18.5H19V21H6.5a1.25 1.25 0 0 1 0-2.5z', '#fff7e6'],
    ['M8 6.5h8.5v9.5H8z', '#fff7e6'],
    ['M9.5 9h5.5M9.5 11.5h5.5M9.5 14h3.5', null, '#c9a76f', 1.2],
  ],
  nori: [
    ['M4 6.5 17.5 4 20 17.5 6.5 20z', '#22402d'],
    ['M6.6 9.2l11.2-2.1M7.3 12.9l11.2-2.1M8 16.6l11.2-2.1', null, '#3f7350', 1.1],
  ],
  fish: [
    ['M2.5 12c2.8-4.8 9.6-6.2 13.8-2.2L21 6.5v11l-4.7-3.3C12.1 18.2 5.3 16.8 2.5 12z', '#ff8a65'],
    ['M6 12.8c3 1.6 6.6 1.6 9.6-.4', null, '#ffd0bf', 1.3],
    ['M7 10.4a1.1 1.1 0 1 0 .01 0z', '#2b2b2b'],
  ],
  parcel: [
    ['M3 8 12 4l9 4v9l-9 4-9-4z', '#c99258'],
    ['M3 8l9 4 9-4M12 12v9', null, '#8a5c2f', 1.2],
    ['M7.5 6 16.5 10', null, '#efdcb3', 2],
  ],
  sack: [
    ['M8 7.5C6 9 4.5 12 5 15.5 5.6 19.5 9 21 12 21s6.4-1.5 7-5.5c.5-3.5-1-6.5-3-8z', '#ead9b2'],
    ['M8 7.5 7 4.5c2-1 8-1 10 0l-1 3z', '#d9c492'],
    ['M7.6 7.6h8.8', null, '#8b6a38', 1.6],
    ['M9 14.5h6M10 17h4', null, '#c4ab78', 1.1],
  ],
  knife: [
    ['M3.5 13.5 15 3.2l3.2 3.2-10.4 10.4z', '#d5dde2'],
    ['M15 3.2 18.2 6.4l-1.4 1.4-3.2-3.2z', '#aeb9c0'],
    ['M2.4 14.6l3.5 3.5-2.2 2.2-3.5-3.5z', '#6d4c41'],
    ['M12.5 15.5h8v4.8h-8z', '#ff8a65'],
    ['M13.8 17.9h5.4', null, '#ffd3c2', 1.2],
  ],
  rice: [
    ['M3 12.5h18c0 4.8-4 8-9 8s-9-3.2-9-8z', '#4f7cf0'],
    ['M4 12.5c.4-3.6 4-5.8 8-5.8s7.6 2.2 8 5.8z', '#fffdf5'],
    ['M3 12.5h18', null, '#3a5fc4', 1],
    ['M9 2.5c-1.2 1.2 1.2 2.1 0 3.4M14.5 2.5c-1.2 1.2 1.2 2.1 0 3.4', null, '#b0bec5', 1.3],
  ],
  tempura: [
    ['M4.5 18.5c-2.4-6.1 2.7-12.6 10-12.6 3 0 4.8 1.7 4.1 3.8-.9 2.8-5.8 2.3-7.7 5.2-1.2 1.9-2.3 4.4-6.4 3.6z', '#f6b73c'],
    ['M18.6 5.6 22 3.2l-.8 4z', '#ff7043'],
    ['M8 12.5h.01M11 9.5h.01M7.4 16h.01M14 8.5h.01', null, '#c47f13', 1.8],
  ],
  plate: [
    ['M2 14.5a10 5 0 1 0 20 0 10 5 0 1 0-20 0z', '#ffffff'],
    ['M5.5 14.5a6.5 3 0 1 0 13 0 6.5 3 0 1 0-13 0z', null, '#cfd8dc', 1.2],
    ['M18.5 2.5l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z', '#4fc3f7'],
    ['M6 6.5a1.4 1.4 0 1 0 .01 0zM10 4.5a1 1 0 1 0 .01 0z', '#81d4fa'],
  ],
  sushi: [
    ['M1.5 15.5a10.5 4.5 0 1 0 21 0 10.5 4.5 0 1 0-21 0z', '#ffffff'],
    ['M4.5 12.8a3.3 3.3 0 1 0 6.6 0 3.3 3.3 0 1 0-6.6 0z', '#22402d'],
    ['M5.9 12.8a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 1 0-3.8 0z', '#fffdf5'],
    ['M7.1 12.8a.7.7 0 1 0 1.4 0 .7.7 0 1 0-1.4 0z', '#ff7a59'],
    ['M12.9 12.8a3.3 3.3 0 1 0 6.6 0 3.3 3.3 0 1 0-6.6 0z', '#22402d'],
    ['M14.3 12.8a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 1 0-3.8 0z', '#fffdf5'],
    ['M15.5 12.8a.7.7 0 1 0 1.4 0 .7.7 0 1 0-1.4 0z', '#ffb74d'],
  ],
  cloche: [
    ['M4 16.5a8 8 0 0 1 16 0z', '#cfd8dc'],
    ['M7 13a5 5 0 0 1 3-3.4', null, '#ffffff', 1.4],
    ['M2 16.5h20v2.2H2z', '#90a4ae'],
    ['M10.8 6.2h2.4v2.2h-2.4z', '#90a4ae'],
  ],
  bowl: [
    ['M3 11.5h18c-.8 5.6-4.6 8.8-9 8.8S3.8 17.1 3 11.5z', '#b0bec5'],
    ['M3 11.5h18', null, '#78909c', 1.2],
    ['M16.5 2.5 12.2 11', null, '#8d6e63', 1.6],
    ['M11 8.5c-1.6.8-1.4 3 .4 3.2 1.8.2 2.6-1.8 1.6-3', null, '#90a4ae', 1.1],
  ],
  bin: [
    ['M6 8h12l-1.2 13H7.2z', '#78909c'],
    ['M4.5 5.6h15v2.6h-15z', '#546e7a'],
    ['M10 3.5h4v2.1h-4z', '#546e7a'],
    ['M9.5 11v7.5M12 11v7.5M14.5 11v7.5', null, '#4b5d66', 1.1],
  ],
  bell: [
    ['M5 17a7 7 0 0 1 14 0z', '#fbc02d'],
    ['M8 14.2a4.5 4.5 0 0 1 2.4-3.4', null, '#fff3c4', 1.3],
    ['M3 17h18v2.6H3z', '#8d6e63'],
    ['M11 7.6h2v2.4h-2z', '#f9a825'],
  ],
  // dishes shown on order tickets
  soup: [
    ['M3 11h18c0 5-4 9-9 9s-9-4-9-9z', '#c0392b'],
    ['M4 11h16', null, '#8e2a1f', 1.2],
    ['M5 11c2-1.4 12-1.4 14 0', '#e6b35a'],
    ['M9 5c-1 1 1 2 0 3.2M14 5c-1 1 1 2 0 3.2', null, '#b0bec5', 1.3],
  ],
  maki: [
    ['M2.5 12a9.5 9.5 0 1 0 19 0 9.5 9.5 0 1 0-19 0z', '#22402d'],
    ['M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0z', '#fffdf5'],
    ['M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0z', '#ff7a59'],
    ['M10.4 10.8h1.4v1.4h-1.4z', '#9ccc65'],
  ],
  bento: [
    ['M2.5 5.5h19v14h-19z', '#2b2b2b'],
    ['M4 7h7.5v11H4z', '#fffdf5'],
    ['M13 7h7v5h-7z', '#f6b73c'],
    ['M13 13.5h7V18h-7z', '#ff8a65'],
    ['M5.5 9.5h4.5v3H5.5z', '#22402d'],
  ],
  omakase: [
    ['M1.5 16a10.5 4.2 0 1 0 21 0 10.5 4.2 0 1 0-21 0z', '#2b2b2b'],
    ['M4 14.8c0-2 1.5-3.4 3.8-3.4s3.8 1.4 3.8 3.4z', '#fffdf5'],
    ['M3.6 13.2c1.2-1.5 7.2-1.5 8.4 0l-.8 1.2H4.4z', '#ff8a65'],
    ['M12.4 14.8c0-2 1.5-3.4 3.8-3.4s3.8 1.4 3.8 3.4z', '#fffdf5'],
    ['M12 13.2c1.2-1.5 7.2-1.5 8.4 0l-.8 1.2h-6.8z', '#f6b73c'],
    ['M10.2 6.5l1.8-3 1.8 3-1.8 1.4z', '#e53935'],
  ],
  mystery: [
    ['M2 15a10 5 0 1 0 20 0 10 5 0 1 0-20 0z', '#ffffff'],
    ['M9.3 7.6a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2.9-1.2 1.8', null, '#90a4ae', 1.8],
    ['M12 14h.01', null, '#90a4ae', 2.4],
  ],
  // HUD bits
  coin: [
    ['M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0z', '#f6b400'],
    ['M4.6 12a7.4 7.4 0 1 0 14.8 0 7.4 7.4 0 1 0-14.8 0z', '#ffd54f'],
    ['M12 7.2l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z', '#f6b400'],
  ],
  fire: [
    ['M12 2c.9 4 5.4 5.4 5.4 10.6a5.4 5.4 0 0 1-10.8 0c0-3 1.9-4.2 2-6.4 1.2 1 1.4 2.2 1.9 3.2.4-3 .4-5.4 1.5-7.4z', '#ff6d3a'],
    ['M12 10.4c1 2.1 3 2.8 3 5.1a3 3 0 0 1-6 0c0-2 2-3 3-5.1z', '#ffd54f'],
  ],
  hat: [
    ['M6 11.5a3.8 3.8 0 0 1 2.6-6.6 4 4 0 0 1 6.8 0 3.8 3.8 0 0 1 2.6 6.6V15H6z', '#ffffff'],
    ['M6 15h12v4.2H6z', '#e3e8ec'],
  ],
  check: [['M4 12.5l5 5L20 6.5', null, '#2e7d32', 3]],
  cross: [['M6 6l12 12M18 6 6 18', null, '#c62828', 3]],
};

export const STATION_ICON = {
  plan: 'book', read: 'nori', search: 'fish', research: 'parcel', install: 'sack', code: 'knife',
  build: 'rice', test: 'tempura', lint: 'plate', commit: 'sushi', ship: 'cloche', shell: 'bowl',
  trash: 'bin', ask: 'bell',
};

export function iconSvg(name, size = 24, extraClass = '') {
  const parts = I[name] || I.mystery;
  const body = parts
    .map(([d, fill, stroke, w]) =>
      `<path d="${d}" fill="${fill || 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${w || 1}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`)
    .join('');
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

export function stationIconSvg(stationId, size = 24) {
  return iconSvg(STATION_ICON[stationId] || 'mystery', size, `st-${stationId}`);
}

/** Draw an icon onto a 2D canvas context at (x, y) with the given size. */
export function drawIcon(ctx, name, x, y, size) {
  const parts = I[name] || I.mystery;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [d, fill, stroke, w] of parts) {
    const p = new Path2D(d);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(p);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = w || 1;
      ctx.stroke(p);
    }
  }
  ctx.restore();
}

/** The dish on an order ticket "levels up" as the order moves through the SDLC. */
export function dishFor(stations = []) {
  const has = (s) => stations.includes(s);
  if (has('ship')) return { icon: 'omakase', name: 'Omakase Set' };
  if (has('commit')) return { icon: 'bento', name: 'Bento Box' };
  if (has('test')) return { icon: 'tempura', name: 'Tempura Roll' };
  if (has('build')) return { icon: 'maki', name: 'Maki Roll' };
  if (has('code')) return { icon: 'knife', name: 'Sashimi' };
  if (stations.length) return { icon: 'soup', name: 'Miso Soup' };
  return { icon: 'mystery', name: 'New Order' };
}
