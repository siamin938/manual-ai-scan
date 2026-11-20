import { Fragment, useMemo, type ReactNode } from "react";
import { marked, type MarkedToken, type Token } from "marked";

function highlightName(text: string, pattern: RegExp | null) {
  if (!pattern) return text;
  return text.split(pattern).map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : part);
}

function publicLink(href: string) {
  try {
    const url = new URL(href);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

// Render the saved Markdown as React text and elements. HTML and embedded media
// from a model response stay inert. A link opens only when the reader selects it.
function renderTokens(tokens: readonly Token[], name: RegExp | null): ReactNode {
  const render = (item: Token): ReactNode => {
    const t = item as MarkedToken; // Core lexer only, no token extensions.
    switch (t.type) {
      case "space": case "def": return null;
      case "br": return <br/>;
      case "hr": return <hr/>;
      case "heading": return <h5>{renderTokens(t.tokens, name)}</h5>;
      case "paragraph": return <p>{renderTokens(t.tokens, name)}</p>;
      case "text": return t.tokens ? renderTokens(t.tokens, name) : highlightName(t.text, name);
      case "strong": return <strong>{renderTokens(t.tokens, name)}</strong>;
      case "em": return <em>{renderTokens(t.tokens, name)}</em>;
      case "del": return <del>{renderTokens(t.tokens, name)}</del>;
      case "blockquote": return <blockquote>{renderTokens(t.tokens, name)}</blockquote>;
      case "code": return <pre><code>{t.text}</code></pre>;
      case "codespan": return <code>{t.text}</code>;
      case "list": return t.ordered
        ? <ol start={typeof t.start === "number" ? t.start : 1}>{renderTokens(t.items, name)}</ol>
        : <ul>{renderTokens(t.items, name)}</ul>;
      case "list_item": return <li>{renderTokens(t.tokens, name)}</li>;
      case "checkbox": return t.checked ? "☑ " : "☐ ";
      case "link": {
        const url = publicLink(t.href);
        return url ? <a href={url} target="_blank" rel="noopener noreferrer">{renderTokens(t.tokens, name)}</a> : renderTokens(t.tokens, name);
      }
      case "table": return <div className="answer-table-scroll" tabIndex={0} role="region" aria-label="답변에 포함된 표"><table>
        <thead><tr>{t.header.map((c,i) => <th key={i} scope="col">{renderTokens(c.tokens, name)}</th>)}</tr></thead>
        <tbody>{t.rows.map((r,i) => <tr key={i}>{r.map((c,k) => <td key={k}>{renderTokens(c.tokens, name)}</td>)}</tr>)}</tbody>
      </table></div>;
      case "escape": case "html": return t.text;
      case "image": return t.text || t.raw;
      default: return item.raw;
    }
  };
  return tokens.map((t,i) => <Fragment key={i}>{render(t)}</Fragment>);
}

export function DiagnosticAnswerText({ text, businessName }: { text: string; businessName: string }) {
  const content = useMemo(() => {
    const chars = Array.from(businessName.replace(/\s/gu, ""));
    const escaped = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
    const name = chars.length > 1 && chars.length <= 100 ? new RegExp("(" + escaped.join("\\s*") + ")", "iu") : null;
    return renderTokens(marked.lexer(text, { gfm: true, breaks: true }), name);
  }, [text, businessName]);
  return <div className="saved-answer-text">{content}</div>;
}
