export const labelMarkets = ['Amazon', 'Flipkart', 'Meesho'] as const;
export type LabelMarket = typeof labelMarkets[number];

function capacitiesInLitres(text: string) {
  const sizes = text.matchAll(/\b(\d+(?:\.\d+)?)\s*-?\s*(ml|millilit(?:re|er)s?|l|lit(?:re|er)s?)\b/gi);
  return [...new Set([...sizes].map(([, value, unit]) => Number(value) / (/^m/i.test(unit) ? 1000 : 1)))];
}

function orderIds(text: string, market: LabelMarket) {
  const patterns = {
    Amazon: /\bOrder\s+(?:Number:\s*([0-9-]+)|Id:\s*(\d{3}-\d{7}-\d{7})\b)/gi,
    Flipkart: /\bOrder\s+Id:\s*(OD[\w-]+)\b/gi,
    Meesho: /\b(\d{12,}_\d+)\b/g,
  };
  return [...new Set([...text.matchAll(patterns[market])].map(match => match[1] || match[2]))];
}

export function isLabelSaleDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function readLabel(text: string, market: LabelMarket, products: string[]) {
  const content = text.replace(/\u00a0/g, ' ');
  let title = '';
  let quantities: string[] = [];
  const orders = orderIds(content, market);
  const order = orders.length === 1 ? orders[0] : '';
  if (market === 'Amazon') {
    const table = content.split(/Description\s+Unit/i)[1] || content.split(/Price\s+Qty\s+Net/i)[1] || '';
    title = table.split(/\bTOTAL\s*:/i)[0];
    quantities = [...title.matchAll(/₹\s*[\d,]+\.\d{2}\s+(\d+)\s+₹\s*[\d,]+\.\d{2}/g)].map(m => m[1]);
  } else if (market === 'Flipkart') {
    title = content.split(/Product\s+Description\s+Qty/i)[1]?.split(/Handling Fee|TOTAL QTY/i)[0] || '';
    if ([...title.matchAll(/HSN:\s*\d+/gi)].length === 1) {
      quantities = [...content.matchAll(/TOTAL QTY:\s*(\d+)/gi)].map(m => m[1]);
    }
  } else {
    title = content.split(/Description\s+HSN\s+Qty/i)[1]?.split(/Other Charges/i)[0] || '';
    quantities = [...title.matchAll(/\b\d{6,8}\s+(\d+)\s+Rs\./gi)].map(m => m[1]);
    if (!title.trim() && order) {
      const details = content.split(/SKU\s+Size\s+Qty\s+Color\s+Order\s+No\./i)[1]?.trimStart();
      const row = details?.match(/^(.+?)\s+(?:Free|One)\s+Size\s+(\d+)\s+[^\r\n]*?\s+(\d{12,}_\d+)\b/i);
      if (row?.[3] === order) {
        title = row[1];
        quantities = [row[2]];
      }
    }
  }
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
  const normalized = normalize(title);
  const sizes = capacitiesInLitres(title);
  const ricePot = /\b(?:rice pot|pasta (?:strainer )?pot)\b/.test(normalized);
  const candidates = products.map(product => ({
    product, name: normalize(product), sizes: capacitiesInLitres(product),
  })).filter(candidate => sizes.length === 0 || candidate.sizes.every(size => sizes.includes(size)));
  const matches = candidates.filter(({name, sizes: productSizes}) => {
    if ((' ' + normalized + ' ').includes(' ' + name + ' ')) return true;
    return ricePot && sizes.length === 1 && productSizes.length === 1 && /\brice pot\b/.test(name);
  });
  const labelTitle = title
    .replace(/^\s*(?:Gross\s+Amount|Discount|Taxable\s+Value|Taxes|Total|CESS|IGST|Tax\s+Rate)\b[^\n]*\n/gim, '')
    .split(/\bHSN\s*:|\b\d{6,8}\s+\d+\s+Rs\.|₹/i)[0]
    .replace(/\s+/g, ' ').trim()
    .replace(/^(?:Unit )?Price Qty Net Amount (?:(?:Tax|Rate|Type|Amount|Total) )*/i, '')
    .replace(/^Value IGST CESS Total /i, '')
    .replace(/^\d+ /, '').slice(0, 300);
  const quantity = Number(quantities[0]);
  const validQuantity = quantities.length === 1 && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 10000;
  let item = matches.length === 1 ? matches[0].product : '';
  if (matches.length === 0 && labelTitle) {
    const titleWords = new Set(normalize(labelTitle).split(' '));
    const ranked = candidates.filter(candidate => sizes.length === 0 || candidate.sizes.length > 0)
      .map(({product, name}) => {
        const words = [...new Set(name.split(' ').filter(word => /^[a-z]{3,}$/.test(word)))];
        return {product, score: words.filter(word => titleWords.has(word)).length};
      }).sort((a,b) => b.score - a.score);
    if (ranked[0]?.score >= 2 && ranked[0].score > (ranked[1]?.score ?? 0)) item = ranked[0].product;
  }
  return {order, quantity: validQuantity ? quantity : 0, title: labelTitle, item, confident: matches.length === 1};
}

type LabelText = {str?: string; hasEOL?: boolean; transform?: number[]};
type LabelViewport = {width: number; height: number; convertToViewportPoint(x: number, y: number): number[]};

export function readLabelPage(items: LabelText[], viewport: LabelViewport, products: string[], preferred?: LabelMarket) {
  const join = (parts: LabelText[]) => parts.map(part => (part.str || '') + (part.hasEOL ? '\n' : ' ')).join('');
  const read = (text: string, slot: number) => {
    const markets = labelMarkets.filter(market => orderIds(text, market).length > 0);
    const market = markets.length === 1 ? markets[0] : preferred;
    const match = market ? readLabel(text, market, products) : null;
    return {slot, market, match: markets.length > 1 ? null : match, orders: markets.flatMap(m => orderIds(text, m))};
  };
  const text = join(items);
  const whole = read(text, 0);
  if (!text.trim()) return [whole];

  const cells: LabelText[][] = [[], [], [], []];
  const halves: LabelText[][] = [[], []];
  for (const part of items) {
    if (!part.transform) continue;
    const [x, y] = viewport.convertToViewportPoint(part.transform[4], part.transform[5]);
    const column = x >= viewport.width / 2 ? 1 : 0;
    const row = y >= viewport.height / 2 ? 1 : 0;
    cells[row * 2 + column].push(part);
    halves[row].push(part);
  }
  // Split a sheet only when its regions show separate orders or complete rows.
  const eligible = [cells, halves].map(regions => {
    const slots = regions.map((parts, index) => read(join(parts), index + 1));
    const marked = slots.filter(slot => slot.orders.length);
    const complete = marked.filter(slot => slot.match?.order && slot.match.quantity).length;
    return {slots, marked, complete};
  }).filter(({marked, complete}) => complete >= 2 || (whole.orders.length >= 2 && marked.length >= 2))
    .sort((a, b) => b.complete - a.complete || b.marked.length - a.marked.length);
  return eligible[0]?.slots.filter(slot => slot.orders.length || slot.match?.title) ?? [whole];
}
