import Anthropic from "@anthropic-ai/sdk";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function llmConfig() {
  const effort = (process.env.LLM_EFFORT?.trim() || "medium") as Effort;
  return {
    model: process.env.LLM_MODEL?.trim() || "claude-sonnet-5",
    effort,
    // 안전 분류기에 의해 거절(refusal)되면 서버가 다른 모델로 재시도한다. 기본은 꺼짐, "on"으로 켠다.
    // Sonnet 5에서 fallbacks: "default"가 허용되는지 확인되지 않아 기본값을 꺼 둔다.
    fallbacks: process.env.LLM_FALLBACKS?.trim() === "on",
  };
}

/** USD / 100만 토큰. 기획 시점 공개 가격 — 바뀌면 환경변수로 덮어쓴다. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-8": { input: 5, output: 25 },
};

export function priceFor(model: string): { input: number; output: number } {
  const envIn = Number(process.env.LLM_PRICE_INPUT_PER_MTOK);
  const envOut = Number(process.env.LLM_PRICE_OUTPUT_PER_MTOK);
  if (envIn > 0 && envOut > 0) return { input: envIn, output: envOut };
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  return key ? PRICES[key] : { input: 5, output: 25 };
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function estimateCost(model: string, u: UsageLike): number {
  const p = priceFor(model);
  const input =
    u.input_tokens +
    (u.cache_creation_input_tokens ?? 0) * 1.25 +
    (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input * p.input + u.output_tokens * p.output) / 1_000_000;
}

export interface SourceDoc {
  label: string; // 본문에 [label] 형태로 인용되는 이름
  url: string | null;
  text: string;
}

export interface GlossaryEntry {
  termEn: string;
  termKo: string;
  note: string | null;
}

export interface AlbumNoteOutput {
  summary: string;
  background: string;
}

const RULES = `당신은 음악 조사 노트를 한국어로 정리하는 편집자입니다. 사용자는 아래 <source> 문서들만 근거로 한 앨범 노트를 원합니다.

규칙:
- <source> 안에 있는 내용만 서술합니다. 문서에 없는 사실, 일반 상식, 추측은 쓰지 않습니다. 이 노트의 가치는 모든 문장을 원문에서 확인할 수 있다는 데 있습니다.
- 문장마다 끝에 근거 소스를 [소스이름] 형태로 붙입니다. 예: "...녹음했다 [Wikipedia]". 소스 이름은 <source name="..."> 값을 그대로 씁니다.
- 소스끼리 내용이 다르면 한쪽을 고르지 말고 "Wikipedia는 ~라고, Discogs는 ~라고 함" 식으로 함께 적습니다.
- 해당 내용에 쓸 자료가 없으면 그 항목에 정확히 "수집된 자료 없음"이라고만 씁니다.
- 번역투를 피하고 자연스러운 한국어 문장으로 씁니다. 인명·밴드명·곡명·앨범명은 원어 표기를 유지합니다. <glossary>가 있으면 그 표기를 따릅니다.
- 원문 문장을 길게 그대로 옮기지 말고 요약합니다.`;

const SECTIONS = {
  summary: "이 앨범이 무엇인지 한 문장. 끝에 근거 소스 표기.",
  background:
    '제작 배경(결성·작곡·녹음·제작 과정·발매 경위 등). 마크다운 문단 여러 개, 필요하면 "### 소제목" 사용. 평론·차트 성적은 여기서 다루지 않습니다.',
};

const SYSTEM_PROMPT = `${RULES}

출력 필드:
- summary: ${SECTIONS.summary}
- background: ${SECTIONS.background}`;

/** 수동 모드(claude.ai에 붙여넣기)에서 쓰는 답변 형식의 제목 */
export const MANUAL_HEADINGS = { summary: "## 한 줄 요약", background: "## 제작 배경" } as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    background: { type: "string" },
  },
  required: ["summary", "background"],
  additionalProperties: false,
} as const;

export function buildUserMessage(
  album: { title: string; artist: string; year: number | null },
  sources: SourceDoc[],
  glossary: GlossaryEntry[],
): string {
  const parts: string[] = [];
  parts.push(
    `앨범: ${album.title}\n아티스트: ${album.artist}${album.year ? `\n발매 연도: ${album.year}` : ""}`,
  );
  if (glossary.length) {
    parts.push(
      "<glossary>\n" +
        glossary
          .map((g) => `${g.termEn} → ${g.termKo}${g.note ? ` (${g.note})` : ""}`)
          .join("\n") +
        "\n</glossary>",
    );
  }
  for (const s of sources) {
    parts.push(`<source name="${s.label}"${s.url ? ` url="${s.url}"` : ""}>\n${s.text}\n</source>`);
  }
  parts.push("위 자료로 노트를 작성하세요.");
  return parts.join("\n\n");
}

export interface LlmResult<T> {
  output: T;
  model: string;
  usage: UsageLike;
  cost: number;
}

export class LlmError extends Error {}

export async function generateAlbumNote(
  album: { title: string; artist: string; year: number | null },
  sources: SourceDoc[],
  glossary: GlossaryEntry[],
): Promise<LlmResult<AlbumNoteOutput>> {
  const cfg = llmConfig();
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: cfg.model,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(album, sources, glossary) }],
    thinking: { type: "adaptive" },
    output_config: {
      effort: cfg.effort,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    ...(cfg.fallbacks
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new LlmError("모델이 요청을 거절했습니다(refusal). 소스 내용을 확인하세요.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new LlmError("출력이 max_tokens에서 잘렸습니다.");
  }
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  let output: AlbumNoteOutput;
  try {
    output = JSON.parse(text) as AlbumNoteOutput;
  } catch {
    throw new LlmError("모델 출력 JSON을 해석하지 못했습니다.");
  }
  const usage: UsageLike = message.usage;
  return { output, model: message.model, usage, cost: estimateCost(message.model, usage) };
}

/**
 * 수동 모드: claude.ai 채팅에 그대로 붙여넣을 프롬프트 한 덩어리.
 * API 모드와 같은 규칙·원문을 쓰고, 출력은 JSON 대신 제목 두 개로 받는다(복사·붙여넣기가 쉬움).
 */
export function buildManualPrompt(
  album: { title: string; artist: string; year: number | null },
  sources: SourceDoc[],
  glossary: GlossaryEntry[],
): string {
  return `${RULES}

답변 형식: 아래 두 제목만 써서 답하세요. 앞뒤 인사말이나 설명은 붙이지 않습니다.

${MANUAL_HEADINGS.summary}
(${SECTIONS.summary})

${MANUAL_HEADINGS.background}
(${SECTIONS.background})

---

${buildUserMessage(album, sources, glossary).replace(/위 자료로 노트를 작성하세요\.$/, "위 자료로 노트를 작성하세요. 답변 형식을 지켜 주세요.")}`;
}

/**
 * claude.ai에서 복사해 온 답변을 섹션으로 나눈다.
 * "## 한 줄 요약" / "## 제작 배경" 제목(# 개수·띄어쓰기·굵게 표시 차이는 허용)을 찾는다.
 */
export function parseManualNote(text: string): AlbumNoteOutput {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const heading = (line: string): "summary" | "background" | null => {
    const t = line.trim().replace(/^#{1,3}\s*/, "").replace(/\*\*/g, "").replace(/[:：]$/, "").replace(/\s+/g, "");
    if (!/^#{1,3}\s|^\*\*/.test(line.trim())) return null;
    if (t === "한줄요약") return "summary";
    if (t === "제작배경") return "background";
    return null;
  };
  const out: Record<"summary" | "background", string[]> = { summary: [], background: [] };
  let current: "summary" | "background" | null = null;
  for (const line of lines) {
    const h = heading(line);
    if (h) {
      current = h;
      continue;
    }
    if (current) out[current].push(line);
  }
  const summary = out.summary.join("\n").trim();
  const background = out.background.join("\n").trim();
  if (!summary && !background) {
    throw new LlmError('"## 한 줄 요약", "## 제작 배경" 제목을 찾지 못했습니다. Claude 답변 전체를 복사해서 붙여넣으세요.');
  }
  return { summary, background };
}
