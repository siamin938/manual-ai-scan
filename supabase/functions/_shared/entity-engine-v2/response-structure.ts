export type ResponseNodeKind =
  | "heading"
  | "table_row"
  | "list_item"
  | "paragraph";

export interface ResponseNode {
  id: string;
  kind: ResponseNodeKind;
  lineStart: number;
  lineEnd: number;
  raw: string;
  text: string;
  scopeText: string;
  parentId: string | null;
  headingLevel?: number;
  indent?: number;
  cells?: string[];
  criterionLabel?: string;
  criterionBody?: string;
}

const HEADING_RE = /^(\s*)(#{1,6})\s+(.+?)\s*$/u;
const LIST_RE = /^(\s*)[-*•▪◦]\s+(.+?)\s*$/u;
const ORDERED_LIST_RE = /^(\s*)(?:(?:\d{1,2}[.)])|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s+(.+?)\s*$/u;
const TABLE_SEPARATOR_CELL_RE = /^:?-{2,}:?$/u;

function normalizeInline(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripOuterInlineMarkdown(value: string): string {
  let text = normalizeInline(value);

  text = text.replace(
    /^(?:\*\*|__)(.+?)(?:\*\*|__)$/u,
    "$1",
  );

  text = text.replace(
    /^\[([^\]]+)\]\([^)]*\)$/u,
    "$1",
  );

  text = text.replace(
    /^[`*_~]+|[`*_~]+$/gu,
    "",
  );

  return normalizeInline(text);
}

function parseTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;

  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => stripOuterInlineMarkdown(cell.trim()));

  if (cells.length < 2) return null;

  const separator = cells.every((cell) => TABLE_SEPARATOR_CELL_RE.test(cell));
  if (separator) return [];

  return cells;
}

function splitCriterionBody(body: string): {
  label?: string;
  value?: string;
} {
  const normalized = normalizeInline(body);

  const bold = normalized.match(
    /^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:：]\s*(.+)$/u,
  );

  if (bold?.[1] && bold?.[2]) {
    return {
      label: stripOuterInlineMarkdown(bold[1]),
      value: stripOuterInlineMarkdown(bold[2]),
    };
  }

  const plain = normalized.match(/^(.{2,40}?)\s*[:：]\s*(.+)$/u);
  if (plain?.[1] && plain?.[2]) {
    return {
      label: stripOuterInlineMarkdown(plain[1]),
      value: stripOuterInlineMarkdown(plain[2]),
    };
  }

  return {};
}

function stripHeadingPrefix(value: string): string {
  let text = normalizeInline(value);

  text = text.replace(
    /^(?:추천\s*)?\d{1,2}\s*(?:순위|위)\s*[:：.)-]?\s*/u,
    "",
  );

  text = text.replace(
    /^\d{1,2}[.)]\s*/u,
    "",
  );

  text = text.replace(
    /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/u,
    "",
  );

  return stripOuterInlineMarkdown(text);
}

function leadingSpaces(value: string): number {
  const match = value.match(/^(\s*)/u);
  return match?.[1]?.replace(/\t/g, "    ").length ?? 0;
}

export function parseResponseStructure(text: string): ResponseNode[] {
  const lines = text.split(/\r?\n/u);
  const nodes: ResponseNode[] = [];
  const headingStack: Array<{ level: number; id: string }> = [];
  const listStack: Array<{ indent: number; id: string }> = [];

  const nearestHeading = (): string | null =>
    headingStack.length > 0 ? headingStack[headingStack.length - 1]!.id : null;

  const nearestListParent = (indent: number): string | null => {
    while (
      listStack.length > 0 &&
      listStack[listStack.length - 1]!.indent >= indent
    ) {
      listStack.pop();
    }

    return listStack.length > 0
      ? listStack[listStack.length - 1]!.id
      : nearestHeading();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const lineNo = index + 1;
    const heading = raw.match(HEADING_RE);

    if (heading) {
      const level = heading[2]!.length;
      const body = stripHeadingPrefix(heading[3]!);

      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1]!.level >= level
      ) {
        headingStack.pop();
      }

      const parentId = nearestHeading();
      const id = `heading:${lineNo}`;

      nodes.push({
        id,
        kind: "heading",
        lineStart: lineNo,
        lineEnd: lineNo,
        raw,
        text: body,
        scopeText: raw,
        parentId,
        headingLevel: level,
      });

      headingStack.push({ level, id });
      listStack.length = 0;
      continue;
    }

    const cells = parseTableCells(raw);
    if (cells !== null) {
      if (cells.length === 0) continue;

      nodes.push({
        id: `table:${lineNo}`,
        kind: "table_row",
        lineStart: lineNo,
        lineEnd: lineNo,
        raw,
        text: cells.join(" | "),
        scopeText: raw,
        parentId: nearestHeading(),
        cells,
      });

      listStack.length = 0;
      continue;
    }

    const unorderedList = raw.match(LIST_RE);
    const orderedList = raw.match(ORDERED_LIST_RE);
    const list = unorderedList ?? orderedList;
    if (list) {
      const indent = leadingSpaces(list[1] ?? "");
      const body = normalizeInline(list[2]!);
      const criterion = splitCriterionBody(body);
      const parentId = nearestListParent(indent);
      const id = `list:${lineNo}`;

      nodes.push({
        id,
        kind: "list_item",
        lineStart: lineNo,
        lineEnd: lineNo,
        raw,
        text: stripOuterInlineMarkdown(body),
        scopeText: raw,
        parentId,
        indent,
        ...(criterion.label ? { criterionLabel: criterion.label } : {}),
        ...(criterion.value ? { criterionBody: criterion.value } : {}),
      });

      listStack.push({ indent, id });
      continue;
    }

    nodes.push({
      id: `paragraph:${lineNo}`,
      kind: "paragraph",
      lineStart: lineNo,
      lineEnd: lineNo,
      raw,
      text: stripOuterInlineMarkdown(trimmed),
      scopeText: raw,
      parentId: nearestHeading(),
    });

    listStack.length = 0;
  }

  return nodes;
}
