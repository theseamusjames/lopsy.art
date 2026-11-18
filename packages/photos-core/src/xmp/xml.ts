/**
 * A minimal XML parser for the subset XMP uses: elements, attributes,
 * text, CDATA, comments and processing instructions, with namespaces
 * resolved to URIs. DOCTYPE (and so entity declarations) is refused, sizes
 * and depth are capped, and malformed input gives null, never an exception.
 */

export interface XmlName {
  /** Namespace URI; '' when none. */
  readonly uri: string;
  readonly local: string;
}

export interface XmlAttribute extends XmlName {
  readonly value: string;
}

export interface XmlElement {
  readonly name: XmlName;
  readonly attributes: readonly XmlAttribute[];
  readonly children: XmlElement[];
  /** The element's own text, concatenated (whitespace kept). */
  text: string;
}

export interface XmlLimits {
  readonly maxChars: number;
  readonly maxDepth: number;
  readonly maxElements: number;
  /** Attributes on one element; XMP packets use a few dozen. */
  readonly maxAttributes: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxChars: 4 * 1024 * 1024,
  maxDepth: 64,
  maxElements: 100_000,
  maxAttributes: 512,
};

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;
// A Map, not an object literal: `&constructor;` must not find Object.prototype's members.
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** Decodes the five predefined entities and character references; null on anything else. */
export function decodeEntities(text: string): string | null {
  if (!text.includes('&')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const amp = text.indexOf('&', i);
    if (amp < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, amp);
    const semi = text.indexOf(';', amp);
    if (semi < 0 || semi - amp > 12) return null;
    const ref = text.slice(amp + 1, semi);
    let decoded: string | undefined;
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      const code = /^[0-9a-fA-F]{1,6}$/.test(ref.slice(2)) ? parseInt(ref.slice(2), 16) : NaN;
      decoded = code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
    } else if (ref.startsWith('#')) {
      const code = /^\d{1,7}$/.test(ref.slice(1)) ? parseInt(ref.slice(1), 10) : NaN;
      decoded = code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
    } else {
      decoded = NAMED_ENTITIES.get(ref);
    }
    if (decoded === undefined) return null;
    out += decoded;
    i = semi + 1;
  }
  return out;
}

interface RawTag {
  readonly qname: string;
  readonly attributes: readonly { qname: string; value: string }[];
}

function parseTagBody(body: string, maxAttributes: number): RawTag | null {
  const m = /^([^\s/>]+)/.exec(body);
  if (!m?.[1] || !NAME.test(m[1])) return null;
  const qname = m[1];
  const attributes: { qname: string; value: string }[] = [];
  const seen = new Set<string>();
  const attr = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  let at = qname.length;
  for (;;) {
    attr.lastIndex = at;
    const a = attr.exec(body);
    if (!a) break;
    const name = a[1] ?? '';
    if (!NAME.test(name)) return null;
    const raw = a[2] ?? a[3] ?? '';
    const value = raw.includes('<') ? null : decodeEntities(raw);
    if (value === null) return null;
    if (seen.has(name) || seen.size >= maxAttributes) return null;
    seen.add(name);
    attributes.push({ qname: name, value });
    at = attr.lastIndex;
  }
  if (body.slice(at).trim() !== '') return null;
  return { qname, attributes };
}

/** The '>' closing a start tag, skipping quoted attribute values; -1 when none. */
function tagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let k = from; k < source.length; k++) {
    const c = source[k];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return k;
    } else if (c === '<') {
      return -1;
    }
  }
  return -1;
}

function split(qname: string): [string | null, string] {
  const colon = qname.indexOf(':');
  return colon < 0 ? [null, qname] : [qname.slice(0, colon), qname.slice(colon + 1)];
}

/** Parses a document; null when it is malformed, too large, or declares a DOCTYPE. */
export function parseXml(source: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlElement | null {
  if (source.length > limits.maxChars) return null;
  const stack: { element: XmlElement; qname: string; scope: Map<string, string> }[] = [];
  let root: XmlElement | null = null;
  let elements = 0;
  let i = 0;
  const lookup = (scope: Map<string, string>, prefix: string | null): string | null => {
    if (prefix === 'xml') return XML_NS;
    return scope.get(prefix ?? '') ?? (prefix === null ? '' : null);
  };
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const textEnd = lt < 0 ? source.length : lt;
    if (textEnd > i) {
      const raw = source.slice(i, textEnd);
      const top = stack[stack.length - 1];
      if (top) {
        const text = decodeEntities(raw);
        if (text === null) return null;
        top.element.text += text;
      } else if (raw.trim() !== '') {
        return null;
      }
    }
    if (lt < 0) break;
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      if (end < 0) return null;
      i = end + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      const top = stack[stack.length - 1];
      if (end < 0 || !top) return null;
      top.element.text += source.slice(lt + 9, end);
      i = end + 3;
    } else if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2);
      if (end < 0) return null;
      i = end + 2;
    } else if (source.startsWith('<!', lt)) {
      // DOCTYPE and anything else declarative: entity expansion is not supported, by design.
      return null;
    } else if (source.startsWith('</', lt)) {
      const end = source.indexOf('>', lt);
      if (end < 0) return null;
      const qname = source.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.qname !== qname) return null;
      i = end + 1;
    } else {
      const end = tagEnd(source, lt + 1);
      if (end < 0) return null;
      let body = source.slice(lt + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const tag = parseTagBody(body, limits.maxAttributes);
      if (!tag) return null;
      if (++elements > limits.maxElements || stack.length >= limits.maxDepth) return null;
      if (root && stack.length === 0) return null;
      const parentScope = stack[stack.length - 1]?.scope ?? new Map<string, string>();
      let scope = parentScope;
      for (const a of tag.attributes) {
        if (a.qname === 'xmlns' || a.qname.startsWith('xmlns:')) {
          if (scope === parentScope) scope = new Map(parentScope);
          scope.set(a.qname === 'xmlns' ? '' : a.qname.slice(6), a.value);
        }
      }
      const [prefix, local] = split(tag.qname);
      const uri = lookup(scope, prefix);
      if (uri === null) return null;
      const attributes: XmlAttribute[] = [];
      for (const a of tag.attributes) {
        if (a.qname === 'xmlns' || a.qname.startsWith('xmlns:')) {
          attributes.push({ uri: XMLNS_NS, local: a.qname === 'xmlns' ? '' : a.qname.slice(6), value: a.value });
          continue;
        }
        const [ap, al] = split(a.qname);
        // Unprefixed attributes have no namespace, whatever the default namespace is.
        const auri = ap === null ? '' : lookup(scope, ap);
        if (auri === null) return null;
        attributes.push({ uri: auri, local: al, value: a.value });
      }
      const element: XmlElement = { name: { uri, local }, attributes, children: [], text: '' };
      const parent = stack[stack.length - 1];
      if (parent) parent.element.children.push(element);
      else root = element;
      if (!selfClosing) stack.push({ element, qname: tag.qname, scope });
      i = end + 1;
    }
  }
  return stack.length === 0 ? root : null;
}

/** Every element in document order, depth-first. */
export function* walk(element: XmlElement): Generator<XmlElement> {
  const pending: XmlElement[] = [element];
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) break;
    yield next;
    for (let k = next.children.length - 1; k >= 0; k--) {
      const child = next.children[k];
      if (child) pending.push(child);
    }
  }
}

export function attribute(element: XmlElement, uri: string, local: string): string | null {
  return element.attributes.find((a) => a.uri === uri && a.local === local)?.value ?? null;
}

export const XML_NAMESPACE = XML_NS;
