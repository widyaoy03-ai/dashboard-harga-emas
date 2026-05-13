type ElementNode = {
  type: "element";
  tagName: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  openTag: string;
  closeTag: string;
};

type TextNode = {
  type: "text";
  text: string;
};

type HtmlNode = ElementNode | TextNode;

export type HtmlSelection = {
  html: string;
  text: string;
  tagName: string;
  cells: string[];
};

type SelectorStep = {
  combinator: "descendant" | "child";
  selector: SimpleSelector;
};

type SimpleSelector = {
  tagName?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; value?: string }>;
};

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:tr|p|div|li|h[1-6]|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function parseAttrs(rawAttrs: string) {
  const attrs: Record<string, string> = {};
  const attrRegex = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of rawAttrs.matchAll(attrRegex)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function parseHtml(html: string): ElementNode {
  const root: ElementNode = { type: "element", tagName: "#root", attrs: {}, children: [], openTag: "", closeTag: "" };
  const stack: ElementNode[] = [root];
  const tagRegex = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  let lastIndex = 0;

  for (const match of html.matchAll(tagRegex)) {
    const index = match.index ?? 0;
    const text = html.slice(lastIndex, index);
    if (text) stack.at(-1)?.children.push({ type: "text", text });

    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const rawAttrs = match[2] ?? "";
    const isClosing = fullTag.startsWith("</");
    const isSelfClosing = fullTag.endsWith("/>") || voidTags.has(tagName);

    if (isClosing) {
      for (let cursor = stack.length - 1; cursor > 0; cursor -= 1) {
        if (stack[cursor].tagName === tagName) {
          stack[cursor].closeTag = fullTag;
          stack.length = cursor;
          break;
        }
      }
    } else {
      const node: ElementNode = {
        type: "element",
        tagName,
        attrs: parseAttrs(rawAttrs),
        children: [],
        openTag: fullTag,
        closeTag: ""
      };
      stack.at(-1)?.children.push(node);
      if (!isSelfClosing) stack.push(node);
    }

    lastIndex = index + fullTag.length;
  }

  const trailing = html.slice(lastIndex);
  if (trailing) stack.at(-1)?.children.push({ type: "text", text: trailing });
  return root;
}

function serialize(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  return `${node.openTag}${node.children.map(serialize).join("")}${node.closeTag}`;
}

function nodeText(node: HtmlNode): string {
  if (node.type === "text") return decodeHtmlEntities(node.text);
  return decodeHtmlEntities(node.children.map(nodeText).join(" "));
}

function childrenElements(node: ElementNode) {
  return node.children.filter((child): child is ElementNode => child.type === "element");
}

function descendants(node: ElementNode): ElementNode[] {
  return childrenElements(node).flatMap((child) => [child, ...descendants(child)]);
}

function parseSimpleSelector(token: string): SimpleSelector {
  if (!token || token === ">") throw new Error("Selector CSS tidak valid.");

  const attrs: SimpleSelector["attrs"] = [];
  let rest = token.replace(/\[([^\]=\s]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g, (_match, name, doubleValue, singleValue, rawValue) => {
    attrs.push({ name: String(name).toLowerCase(), value: doubleValue ?? singleValue ?? rawValue?.trim() });
    return "";
  });

  const tagMatch = rest.match(/^[a-zA-Z][\w-]*/);
  const tagName = tagMatch?.[0].toLowerCase();
  if (tagMatch) rest = rest.slice(tagMatch[0].length);

  const idMatch = rest.match(/#([\w-]+)/);
  const id = idMatch?.[1];
  rest = rest.replace(/#[\w-]+/g, "");

  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  rest = rest.replace(/\.[\w-]+/g, "");

  if (rest.trim()) throw new Error(`Selector CSS belum didukung: ${token}`);
  return { tagName, id, classes, attrs };
}

function parseSelector(selector: string): SelectorStep[] {
  const normalized = selector.trim().replace(/\s*>\s*/g, " > ");
  if (!normalized) throw new Error("Selector CSS wajib diisi.");

  const parts = normalized.split(/\s+/).filter(Boolean);
  const steps: SelectorStep[] = [];
  let combinator: SelectorStep["combinator"] = "descendant";
  for (const part of parts) {
    if (part === ">") {
      combinator = "child";
      continue;
    }
    steps.push({ combinator, selector: parseSimpleSelector(part) });
    combinator = "descendant";
  }
  return steps;
}

function matchesSelector(node: ElementNode, selector: SimpleSelector) {
  if (selector.tagName && node.tagName !== selector.tagName) return false;
  if (selector.id && node.attrs.id !== selector.id) return false;
  const classes = (node.attrs.class ?? "").split(/\s+/);
  if (selector.classes.some((className) => !classes.includes(className))) return false;
  return selector.attrs.every((attr) => {
    if (!(attr.name in node.attrs)) return false;
    return attr.value === undefined || node.attrs[attr.name] === attr.value;
  });
}

function cellsFromRow(node: ElementNode) {
  const cellNodes = descendants(node).filter((child) => child.tagName === "td" || child.tagName === "th");
  return cellNodes.map((cell) => nodeText(cell)).filter(Boolean);
}

export function queryHtmlSelections(html: string, selector: string): HtmlSelection[] {
  const root = parseHtml(html.replace(/<!--[\s\S]*?-->/g, " "));
  const steps = parseSelector(selector);
  let current: ElementNode[] = [root];

  for (const step of steps) {
    current = current.flatMap((node) => {
      const pool = step.combinator === "child" ? childrenElements(node) : descendants(node);
      return pool.filter((candidate) => matchesSelector(candidate, step.selector));
    });
  }

  return current.map((node) => ({
    html: serialize(node),
    text: nodeText(node),
    tagName: node.tagName,
    cells: cellsFromRow(node)
  }));
}

export function queryHtmlRows(html: string, selector: string) {
  const selected = queryHtmlSelections(html, selector);
  const rowSelections = selected.flatMap((selection) => {
    if (selection.tagName === "tr") return [selection];
    return queryHtmlSelections(selection.html, "tr");
  });
  return rowSelections.filter((row) => row.cells.length);
}
