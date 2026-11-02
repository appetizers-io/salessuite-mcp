const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts the HTML/Markdown mix used in SalesSuite OpenAPI descriptions into compact Markdown
 * that is readable for a language model. Links to anchors inside the Swagger UI are reduced to their
 * text, because they are meaningless outside of it; external links keep their URL.
 */
export function toMarkdown(input: string | undefined): string {
  if (!input) return '';
  let s = input;

  // Swagger UI only: heading anchors and collapsible wrappers.
  s = s.replace(/<a class="oapi-heading-anchor"[^>]*>.*?<\/a>/g, '');
  s = s.replace(/<summary>.*?<\/summary>/gs, '');

  s = s.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gs, (_m, level: string, text: string) => `\n\n${'#'.repeat(Number(level))} ${text.trim()}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(p|ul|ol|div|details|pre|table|tr)>/gi, '\n');
  s = s.replace(/<(strong|b)>(.*?)<\/\1>/gs, '**$2**');
  s = s.replace(/<(em|i)>(.*?)<\/\1>/gs, '*$2*');
  s = s.replace(/<code>(.*?)<\/code>/gs, '`$1`');
  s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs, (_m, href: string, text: string) => link(text, href));
  s = s.replace(/<[^>]+>/g, '');

  // Markdown links that point into the Swagger UI.
  s = s.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_m, text: string, href: string) => link(text, href));

  s = decodeEntities(s);
  s = s.replace(/\s*↗/g, '');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function link(text: string, href: string): string {
  const label = text.replace(/\s*↗\s*/g, '').trim();
  if (!href || href.startsWith('#') || href.startsWith('?')) return label;
  return `${label} (${decodeEntities(href)})`;
}

/** Returns a deep copy of an OpenAPI document with every `summary`/`description` string converted by {@link toMarkdown}. */
export function cleanSpecDescriptions<T>(spec: T): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== 'object' || node === null) return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        (key === 'description' || key === 'summary') && typeof value === 'string' ? toMarkdown(value) : walk(value),
      ]),
    );
  };
  return walk(spec) as T;
}
