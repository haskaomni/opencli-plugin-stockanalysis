import { cli, Strategy } from '/usr/lib/node_modules/@jackwener/opencli/dist/registry-api.js';

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const BASE_URL = 'https://stockanalysis.com';

function headers() {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  };
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function absoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const resp = await fetch(url, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`StockAnalysis request failed: HTTP ${resp.status} for ${url}`);
  }
  return resp.text();
}

function extractBracketed(source, key, opener = '[', closer = ']') {
  const keyIndex = source.indexOf(key);
  if (keyIndex === -1) return null;
  const start = source.indexOf(opener, keyIndex + key.length);
  if (start === -1) return null;

  let depth = 0;
  let quote = null;
  let escape = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return null;
}

function extractRows(html) {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  return Array.from(tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi), (m) => m[1]);
}

function extractCells(rowHtml) {
  return Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi), (m) => m[1]);
}

function parseLink(cellHtml) {
  const link = cellHtml.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  return {
    href: absoluteUrl(link?.[1] || ''),
    text: stripHtml(link?.[2] || cellHtml),
  };
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeTicker(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function compactNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);

  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];

  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = abs / size;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${sign}${scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')}${suffix}`;
    }
  }

  return `${num}`;
}

async function symbolLookup(query) {
  const html = await fetchText(`${BASE_URL}/symbol-lookup/?q=${encodeURIComponent(query)}`);
  const rows = extractRows(html);
  return rows.map((rowHtml) => {
    const cells = extractCells(rowHtml);
    const link = parseLink(cells[0] || '');
    return {
      symbol: link.text,
      name: stripHtml(cells[1] || ''),
      type: stripHtml(cells[2] || ''),
      price: stripHtml(cells[3] || ''),
      marketCap: stripHtml(cells[4] || ''),
      url: link.href,
    };
  }).filter((item) => item.symbol || item.name);
}

function scoreLookupResult(item, query) {
  const q = normalizeSearch(query);
  const symbol = normalizeSearch(item.symbol);
  const name = normalizeSearch(item.name);
  let score = 0;
  if (symbol === q) score += 100;
  if (symbol.startsWith(q)) score += 40;
  if (name.startsWith(q)) score += 25;
  if (name.includes(q)) score += 10;
  return score;
}

async function searchCommand(args) {
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));
  const items = await symbolLookup(args.query);
  return items
    .map((item) => ({ ...item, score: scoreLookupResult(item, args.query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...item }) => item);
}

async function quoteCommand(args) {
  const query = String(args.symbol || '').trim().toUpperCase();
  const candidates = await symbolLookup(query);
  const wanted = normalizeTicker(query);
  const ranked = candidates.map((item) => {
    const normalizedSymbol = normalizeTicker(item.symbol);
    const plainSymbol = normalizeTicker(item.symbol.split(':').pop() || item.symbol);
    let score = 0;
    if (normalizedSymbol === wanted || plainSymbol === wanted) score += 100;
    if (normalizedSymbol.endsWith(wanted) || plainSymbol.endsWith(wanted)) score += 50;
    if (item.type === 'Stock') score += 20;
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  const pick = ranked.find((item) => item.url);
  if (!pick) throw new Error(`No StockAnalysis result found for ${query}`);

  const detailHtml = await fetchText(pick.url);
  const capture = (re) => detailHtml.match(re)?.[1] || null;

  return [{
    symbol: pick.symbol,
    name: pick.name,
    type: pick.type,
    price: pick.price,
    marketCap: capture(/marketCap:"([^"]+)"/) || pick.marketCap,
    peRatio: capture(/peRatio:"([^"]+)"/),
    eps: capture(/eps:"([^"]+)"/),
    revenue: capture(/revenue:"([^"]+)"/),
    analystTarget: capture(/analystTarget:\{target:"([^"]+)"/),
    analystUpside: capture(/analystTarget:\{target:"[^"]+",change:"([^"]+)"/),
    url: pick.url,
  }];
}

async function marketTableCommand(path, shape, limitArg) {
  const limit = Math.max(1, Math.min(Number(limitArg) || 10, 50));
  const html = await fetchText(`${BASE_URL}${path}`);
  return extractRows(html).slice(0, limit).map((rowHtml, index) => {
    const cells = extractCells(rowHtml);
    const offset = /^\d+$/.test(stripHtml(cells[0] || '')) ? 1 : 0;
    const symbolLink = parseLink(cells[offset] || '');
    const item = {
      rank: index + 1,
      symbol: symbolLink.text,
      name: stripHtml(cells[offset + 1] || ''),
      url: symbolLink.href,
    };
    for (const [field, relativeIndex] of Object.entries(shape)) {
      item[field] = stripHtml(cells[offset + relativeIndex] || '');
    }
    return item;
  });
}

async function earningsCommand(args) {
  const requestedDate = String(args.date || '').trim();
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 100));
  const html = await fetchText(`${BASE_URL}/stocks/earnings-calendar/`);
  const daysSource = extractBracketed(html, 'days:');
  if (!daysSource) throw new Error('Could not locate earnings data block');

  const days = Function(`return (${daysSource});`)();
  const selectedDays = requestedDate ? days.filter((day) => day.date === requestedDate) : days.slice(0, 1);
  if (requestedDate && selectedDays.length === 0) {
    throw new Error(`No earnings data found for ${requestedDate}`);
  }

  const sessionMap = { bmo: 'before_open', amc: 'after_close' };

  return selectedDays
    .flatMap((day) =>
      (day.symbols || []).map((item) => ({
        date: day.date,
        day: day.day,
        session: sessionMap[item.t] || 'unspecified',
        symbol: item.s || '',
        name: item.n || '',
        epsEstimate: item.e == null ? null : `${item.e}`,
        epsGrowth: item.eg == null ? null : `${item.eg}%`,
        revenueEstimate: item.r == null ? null : `$${compactNumber(item.r)}`,
        revenueGrowth: item.rg == null ? null : `${item.rg}%`,
        marketCap: item.m == null ? null : `$${compactNumber(item.m)}`,
        url: item.s ? `${BASE_URL}/stocks/${String(item.s).toLowerCase().replace(/\./g, '-')}/` : null,
      }))
    )
    .slice(0, limit);
}

async function newsCommand(args) {
  const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));
  const html = await fetchText(`${BASE_URL}/news/`);
  const mainSource = extractBracketed(html, 'data:{data:');
  const otherSource = extractBracketed(html, 'other:');
  const main = mainSource ? Function(`return (${mainSource});`)() : [];
  const other = otherSource ? Function(`return (${otherSource});`)() : [];

  const items = [
    ...main.map((item) => ({
      source: item.source || '',
      type: item.type || 'Article',
      title: item.title || '',
      summary: item.text || '',
      time: item.time || null,
      ago: item.ago || null,
      url: item.url || null,
    })),
    ...other.map((item) => ({
      source: item.n || '',
      type: 'Headline',
      title: item.t || '',
      summary: null,
      time: null,
      ago: item.d || null,
      url: item.u || null,
    })),
  ].filter((item) => item.title);

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.url || ''}::${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

cli({
  site: 'stockanalysis',
  name: 'search',
  description: 'Search stocks, ETFs, and funds on StockAnalysis',
  domain: 'stockanalysis.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword, ticker, or company name' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results to return' },
  ],
  columns: ['symbol', 'name', 'type', 'price', 'marketCap', 'url'],
  func: async (_page, args) => searchCommand(args),
});

cli({
  site: 'stockanalysis',
  name: 'quote',
  description: 'Get a stock overview from StockAnalysis',
  domain: 'stockanalysis.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', required: true, positional: true, help: 'Ticker symbol, for example AAPL or MSFT' },
  ],
  columns: ['symbol', 'name', 'price', 'marketCap', 'peRatio', 'eps', 'revenue', 'analystTarget', 'analystUpside'],
  func: async (_page, args) => quoteCommand(args),
});

cli({
  site: 'stockanalysis',
  name: 'gainers',
  description: 'Get top gainers from StockAnalysis',
  domain: 'stockanalysis.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of rows to return' },
  ],
  columns: ['rank', 'symbol', 'name', 'price', 'change', 'volume', 'marketCap'],
  func: async (_page, args) =>
    marketTableCommand('/markets/gainers/', { change: 2, price: 3, volume: 4, marketCap: 5 }, args.limit),
});

cli({
  site: 'stockanalysis',
  name: 'losers',
  description: 'Get top losers from StockAnalysis',
  domain: 'stockanalysis.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of rows to return' },
  ],
  columns: ['rank', 'symbol', 'name', 'price', 'change', 'volume', 'marketCap'],
  func: async (_page, args) =>
    marketTableCommand('/markets/losers/', { change: 2, price: 3, volume: 4, marketCap: 5 }, args.limit),
});

cli({
  site: 'stockanalysis',
  name: 'active',
  description: 'Get most active stocks from StockAnalysis',
  domain: 'stockanalysis.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of rows to return' },
  ],
  columns: ['rank', 'symbol', 'name', 'volume', 'price', 'change', 'marketCap'],
  func: async (_page, args) =>
    marketTableCommand('/markets/active/', { volume: 2, price: 3, change: 4, marketCap: 5 }, args.limit),
});

cli({
  site: 'stockanalysis',
  name: 'earnings',
  description: 'Get earnings calendar data from StockAnalysis',
  domain: 'stockanalysis.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'date', help: 'Filter by date in YYYY-MM-DD format' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of rows to return' },
  ],
  columns: ['date', 'session', 'symbol', 'name', 'epsEstimate', 'revenueEstimate', 'marketCap'],
  func: async (_page, args) => earningsCommand(args),
});

cli({
  site: 'stockanalysis',
  name: 'news',
  description: 'Get market news from StockAnalysis',
  domain: 'stockanalysis.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of rows to return' },
  ],
  columns: ['source', 'type', 'title', 'ago', 'time'],
  func: async (_page, args) => newsCommand(args),
});
