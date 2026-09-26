import { Fragment } from "react";

export interface NoteSource {
  label: string;
  url: string | null;
}

/**
 * LLM이 만든 노트 본문 렌더링. 지원하는 문법은 최소한만:
 * 빈 줄로 문단 구분, "### " 소제목, "- " 목록, [소스이름] 인용 → 원문 링크 배지.
 * HTML은 해석하지 않는다(문자열 그대로 React 텍스트로 출력).
 */
export function NoteText({ text, sources }: { text: string; sources: NoteSource[] }) {
  const byLabel = new Map(sources.map((s) => [s.label.toLowerCase(), s]));
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  function inline(line: string, key: string) {
    const parts = line.split(/(\[[^\]\n]{1,40}\])/g);
    const out: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const m = p.match(/^\[([^\]]+)\]$/);
      const labels = m ? m[1].split(/\s*[,/]\s*/) : [];
      if (m && labels.every((l) => byLabel.has(l.toLowerCase()))) {
        // "…했다 [Wikipedia]." → "…했다. [Wikipedia]": 배지 뒤 문장부호를 배지 앞으로 옮긴다.
        const punct = parts[i + 1]?.match(/^[.,;:!?)\]。、」』]+/)?.[0] ?? "";
        if (punct) {
          parts[i + 1] = parts[i + 1].slice(punct.length);
          const prev = out.length - 1;
          // 배지 앞의 공백은 문장부호 뒤로 보낸다 ("했다 ." 방지)
          const before = typeof parts[i - 1] === "string" ? parts[i - 1] : "";
          if (/\s$/.test(before) && prev >= 0) {
            out[prev] = <Fragment key={`${key}-${i - 1}`}>{emphasis(before.replace(/\s+$/, ""), `${key}-${i - 1}`)}</Fragment>;
          }
          out.push(<Fragment key={`${key}-${i}-p`}>{punct} </Fragment>);
        }
        out.push(
          <span key={`${key}-${i}`} className="whitespace-nowrap">
            {labels.map((l) => {
              const s = byLabel.get(l.toLowerCase())!;
              return s.url ? (
                <a key={l} href={s.url} target="_blank" rel="noreferrer" className="cite">
                  {s.label}
                </a>
              ) : (
                <span key={l} className="cite">
                  {s.label}
                </span>
              );
            })}
          </span>,
        );
        continue;
      }
      out.push(<Fragment key={`${key}-${i}`}>{emphasis(p, `${key}-${i}`)}</Fragment>);
    }
    return out;
  }

  return (
    <div className="prose-note">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.startsWith("### ")) {
          const [head, ...rest] = b.split("\n");
          return (
            <Fragment key={key}>
              <h3>{inline(head.slice(4), `${key}h`)}</h3>
              {rest.length > 0 && <p>{inline(rest.join(" "), `${key}p`)}</p>}
            </Fragment>
          );
        }
        const lines = b.split("\n");
        if (lines.every((l) => /^[-*] /.test(l))) {
          return (
            <ul key={key} className="mb-[0.9em] list-disc pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2), `${key}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{inline(lines.join(" "), key)}</p>;
      })}
    </div>
  );
}

/**
 * 마크다운 강조 표시: **굵게** → <strong>, *기울임* / _기울임_ → <em>.
 * 여는 표시 바로 뒤와 닫는 표시 바로 앞이 공백이면 강조로 보지 않는다 ("2 * 3 * 4" 같은 경우).
 */
const EMPHASIS = /(\*\*[^*\n]+?\*\*|\*(?![\s*])[^*\n]*?[^\s*]\*|\*[^\s*]\*|(?<![A-Za-z0-9])_(?![\s_])[^_\n]*?[^\s_]_(?![A-Za-z0-9]))/gu;

export function emphasis(text: string, key: string): React.ReactNode[] {
  return text.split(EMPHASIS).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith("**")) return <strong key={`${key}-e${i}`}>{part.slice(2, -2)}</strong>;
    return <em key={`${key}-e${i}`}>{part.slice(1, -1)}</em>;
  });
}

