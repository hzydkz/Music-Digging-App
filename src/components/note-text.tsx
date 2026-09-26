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
    return parts.map((p, i) => {
      const m = p.match(/^\[([^\]]+)\]$/);
      if (m) {
        const labels = m[1].split(/\s*[,/]\s*/);
        if (labels.every((l) => byLabel.has(l.toLowerCase()))) {
          return (
            <Fragment key={`${key}-${i}`}>
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
            </Fragment>
          );
        }
      }
      return <Fragment key={`${key}-${i}`}>{p.replace(/\*\*(.+?)\*\*/g, "$1")}</Fragment>;
    });
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
