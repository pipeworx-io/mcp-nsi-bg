interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Bulgarian National Statistical Institute (НСИ / NSI) — Open Data API.
 *
 * Keyless. Source of data is NSI's Open Data portal at www.nsi.bg/opendata/.
 *
 * Discovery note: the documented host `infostat.nsi.bg/infostat/api/v1.0` is a
 * dead end — every path under it edge-redirects (Cloudflare 301) to a marketing
 * page regardless of method, path, or User-Agent, and the Infostat web app
 * itself is server-rendered HTML with no JSON surface. The real keyless JSON API
 * that NSI exposes is the Open Data portal, which serves datasets as
 * JSON-stat 2.0 (https://json-stat.org/) plus CSV field/code-list metadata.
 *
 * Verified endpoints (all GET, keyless):
 *   - Index page  : https://www.nsi.bg/opendata/?l={en|bg}   (HTML table of datasets)
 *   - Dataset JSON: https://www.nsi.bg/opendata/getopendata_json.php?l={en|bg}&id={id}
 *                   -> JSON-stat 2.0 dataset object
 *   - Field meta  : https://www.nsi.bg/opendata/getfields.php?l={en|bg}&id={id}  (CSV)
 *
 * There is no machine-readable catalog endpoint, so list_datasets parses the
 * index HTML to extract {id, name} pairs (~131 datasets at time of writing).
 * Dataset labels are English when l=en; underlying category labels may still be
 * Bulgarian in places.
 */


const BASE = 'https://www.nsi.bg/opendata';
const UA = 'pipeworx-mcp-nsi-bg/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'list_datasets',
    description:
      "List NSI Bulgaria open-data datasets with their numeric id and English (or Bulgarian) name. " +
      "Each dataset id can be passed to get_dataset for the actual figures. " +
      "Use the optional `filter` to substring-match dataset names (case-insensitive), e.g. 'population', 'export', 'inflation'.",
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Case-insensitive substring to match against dataset names.' },
        lang: { type: 'string', enum: ['en', 'bg'], description: 'Language of dataset names. Default en.' },
      },
    },
  },
  {
    name: 'get_dataset',
    description:
      "Fetch a single NSI Bulgaria dataset by numeric id as a JSON-stat 2.0 object " +
      "(dimensions, categories, and the flat `value` array). Get ids from list_datasets. " +
      "Example ids: 107 (children in kindergartens by municipality), 242 (aggregate replacement ratio).",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Numeric dataset id, e.g. "107".' },
        lang: { type: 'string', enum: ['en', 'bg'], description: 'Label language. Default en.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_fields',
    description:
      "Fetch the field/dimension metadata for an NSI dataset (its column codes plus Bulgarian and English names) " +
      "as parsed CSV rows. Useful for interpreting the dimension codes in a get_dataset response.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Numeric dataset id, e.g. "107".' },
        lang: { type: 'string', enum: ['en', 'bg'], description: 'Label language. Default en.' },
      },
      required: ['id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_datasets': {
      const lang = langOf(args);
      const filter = (args.filter as string | undefined)?.trim().toLowerCase();
      const html = await nsiText(`/?l=${lang}`);
      let datasets = parseIndex(html, lang);
      if (filter) datasets = datasets.filter((d) => d.name.toLowerCase().includes(filter));
      return { count: datasets.length, lang, datasets };
    }
    case 'get_dataset': {
      const id = reqId(args);
      const lang = langOf(args);
      const text = await nsiText(`/getopendata_json.php?l=${lang}&id=${id}`);
      if (!text.trim()) throw new Error(`NSI: dataset id "${id}" returned no data (unknown or empty id).`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`NSI: dataset id "${id}" did not return JSON-stat: ${text.slice(0, 200)}`);
      }
    }
    case 'get_fields': {
      const id = reqId(args);
      const lang = langOf(args);
      const csv = await nsiText(`/getfields.php?l=${lang}&id=${id}`);
      if (!csv.trim()) throw new Error(`NSI: dataset id "${id}" returned no field metadata (unknown or empty id).`);
      return { id, lang, fields: parseCsv(csv) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function nsiText(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NSI: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.text();
}

/** Parse the open-data index HTML table into {id, name} dataset entries. */
function parseIndex(html: string, lang: string): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const idMatch = row.match(new RegExp(`getopendata_json\\.php\\?l=${lang}&id=(\\d+)`));
    const nameMatch = row.match(/<b>([\s\S]*?)<\/b>/);
    if (idMatch && nameMatch) {
      const id = idMatch[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const name = nameMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      out.push({ id, name });
    }
  }
  return out;
}

/** Minimal RFC-ish CSV parser (handles quoted fields with commas). */
function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj: Record<string, string> = {};
    header.forEach((h, i) => (obj[h] = cells[i] ?? ''));
    return obj;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function langOf(args: Record<string, unknown>): 'en' | 'bg' {
  return args.lang === 'bg' ? 'bg' : 'en';
}

function reqId(args: Record<string, unknown>): string {
  const v = args.id;
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string' || !/^\d+$/.test(s.trim())) {
    throw new Error('Required argument "id" must be a numeric dataset id like "107". Get ids from list_datasets.');
  }
  return s.trim();
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
