import Anthropic from "@anthropic-ai/sdk";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function llmConfig() {
  const effort = (process.env.LLM_EFFORT?.trim() || "medium") as Effort;
  return {
    model: process.env.LLM_MODEL?.trim() || "claude-opus-5",
    effort,
    // 안전 분류기에 의해 거절(refusal)되면 서버가 다른 모델로 재시도한다. "off"로 끌 수 있다.
    fallbacks: process.env.LLM_FALLBACKS?.trim() !== "off",
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

const SYSTEM_PROMPT = `당신은 음악 조사 노트를 한국어로 정리하는 편집자입니다. 사용자는 아래 <source> 문서들만 근거로 한 앨범 노트를 원합니다.

규칙:
- <source> 안에 있는 내용만 서술합니다. 문서에 없는 사실, 일반 상식, 추측은 쓰지 않습니다. 이 노트의 가치는 모든 문장을 원문에서 확인할 수 있다는 데 있습니다.
- 문장마다 끝에 근거 소스를 [소스이름] 형태로 붙입니다. 예: "...녹음했다 [Wikipedia]". 소스 이름은 <source name="..."> 값을 그대로 씁니다.
- 소스끼리 내용이 다르면 한쪽을 고르지 말고 "Wikipedia는 ~라고, Discogs는 ~라고 함" 식으로 함께 적습니다.
- 해당 내용에 쓸 자료가 없으면 그 필드에 정확히 "수집된 자료 없음"이라고만 씁니다.
- 번역투를 피하고 자연스러운 한국어 문장으로 씁니다. 인명·밴드명·곡명·앨범명은 원어 표기를 유지합니다. <glossary>가 있으면 그 표기를 따릅니다.
- 원문 문장을 길게 그대로 옮기지 말고 요약합니다.

출력 필드:
- summary: 이 앨범이 무엇인지 한 문장. 끝에 근거 소스 표기.
- background: 제작 배경(결성·작곡·녹음·제작 과정·발매 경위 등). 마크다운 문단 여러 개, 필요하면 "### 소제목" 사용. 평론·차트 성적은 이 필드에서 다루지 않습니다.`;

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
