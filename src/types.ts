export type Availability = "available" | "downloadable" | "downloading" | "unavailable";

export type LanguageModelContent = { type: "text"; value: string } | { type: "audio"; value: Blob };

export type LanguageModelPrompt = Array<{
  role: "user";
  content: LanguageModelContent[];
}>;

export type SessionShape = {
  methods: string[];
  props: Record<string, unknown>;
};

export type Metrics = {
  usedStreaming: boolean;
  totalMs: number;
  firstChunkMs: number | null;
  generationWindowMs: number;
  chunkCount: number;
  repairPassMs: number | null;
  repairAttemptCount: number;
  repairReasons: Record<string, number>;
  repairAttempts: RepairAttempt[];
  fallbackUsed: boolean;
  outputChars: number;
  outputWords: number;
  outputTokensApprox: number;
  outputTokensApproxByWords: number;
  contentTokensApprox: number;
  tokensPerSecond: number;
  charsPerSecond: number;
  contentTokensPerSecond: number;
  audioDurationMs: number | null;
  audioSize: number | null;
  audioType: string | null;
  contextUsage: unknown;
  sessionShape: SessionShape | null;
  truncated: boolean;
  truncatedReason: TruncatedReason;
  outputTail: string | null;
};

export type TruncatedReason = "max_stream_ms" | "stale_stream" | "repetition_stream" | "blank_stream" | "non_stream_timeout" | null;

export type RepairReason = "asr_text_retry" | "json_repair" | "self_refinement";

export type RepairAttempt = {
  reason: RepairReason;
  elapsedMs: number;
  accepted: boolean;
  improved: boolean;
  scoreDelta: number | null;
  truncated: boolean;
  scoreBefore: number | null;
  scoreAfter: number | null;
  outputChars: number;
};

export type CodexSummarySnapshot = {
  promptVersion: string;
  generatedAt: string;
  runs: number;
  transcriptAvg: number | null;
  codeAvg: number | null;
  repairRunRate: number;
  tokPerSecAvg: number | null;
};

export type TestCase = {
  id: string;
  fileName: string;
  expectedTranscript: string;
  expectedCode: string;
  contextHint?: string;
};

export type BenchmarkDataset = {
  id: string;
  name: string;
  cases: TestCase[];
};

export type BenchmarkEntry = {
  at: string;
  promptVersion: string;
  caseId?: string;
  fileName?: string;
  audioSize: number | null;
  audioDurationMs: number | null;
  totalMs: number | null;
  firstChunkMs: number | null;
  tokensPerSecond: number | null;
  charsPerSecond: number | null;
  transcriptSimilarity: number | null;
  transcriptDistance: number | null;
  codeSimilarity: number | null;
  codeDistance: number | null;
  
  is_directed?: boolean;
  lang?: string;
  needs_context?: boolean;
  code?: string;
  code_origin?: string;
  code_tags?: string[];
  answer?: string;
  transcript?: string;
  thought_tags?: string;
  rawOutputHead?: string;
  rawOutputTail?: string;

  // Dialogue analysis fields
  interaction_category?: string;
  dialogue_flow?: string;
  detected_topics?: string[];
  suggested_questions?: string[];
  phonetic_corrections?: string[];

  contextUsage: unknown;
  contentTokensPerSecond: number | null;
  repairPassMs?: number | null;
  repairAttemptCount?: number;
  repairReasons?: Record<string, number>;
  repairAttempts?: RepairAttempt[];
  fallbackUsed?: boolean;
  truncated: boolean;
  truncatedReason: TruncatedReason;
  outputTail: string | null;
};

export type EventLog = {
  at: string;
  type: string;
  data: Record<string, unknown>;
};

export type ParsedResponse = {
  think?: string;
  is_directed?: boolean;
  lang?: string;
  needs_context?: boolean;
  code?: string;
  code_origin?: string;
  code_tags?: string[];
  code_notes?: string;
  answer?: string;
  transcript?: string;
  thought_tags?: string;

  // Dialogue analysis fields
  interaction_category?: "Saludo / Charla" | "Dictado de Código" | "Mixto (Charla y Código)";
  dialogue_flow?: string;
  detected_topics?: string[];
  suggested_questions?: string[];
  phonetic_corrections?: string[];
};

export type TranscriptDiff = {
  referenceWords: number;
  hypothesisWords: number;
  distance: number;
  similarity: number;
};

export type CodeDiff = TranscriptDiff & {
  expectedCode: string;
  probableCode: string;
};

export type Report = {
  generatedAt: string;
  promptVersion: string;
  testCase: Pick<TestCase, "id" | "fileName"> | null;
  location: string;
  userAgent: string;
  chromeLanguageModel: {
    present: boolean;
    sessionMode: string;
  };
  metrics: Metrics | null;
  parsed: ParsedResponse | null;
  expectedTranscript: string;
  transcriptDiff: TranscriptDiff | null;
  expectedCode: string;
  codeDiff: CodeDiff | null;
  rawOutput: string;
  events: EventLog[];
};

export type LanguageModelSession = {
  prompt(prompt: string | LanguageModelPrompt, options?: PromptOptions): Promise<string>;
  promptStreaming?: (prompt: string | LanguageModelPrompt, options?: PromptOptions) => AsyncIterable<string>;
  measureContextUsage?: (prompt: string | LanguageModelPrompt, options?: PromptOptions) => Promise<unknown>;
  clone?: () => Promise<LanguageModelSession>;
  destroy?: () => void;
  [key: string]: unknown;
};

export type PromptOptions = {
  responseConstraint?: unknown;
  omitResponseConstraintInput?: boolean;
};

export type PromptRun = {
  text: string;
  usedStreaming: boolean;
  elapsedMs: number;
  firstChunkMs: number | null;
  chunkCount: number;
  truncated: boolean;
  truncatedReason: TruncatedReason;
};

export type LanguageModelFactory = {
  availability(options: unknown): Promise<Availability>;
  create(options: unknown): Promise<LanguageModelSession>;
};

export type AudioAsset = {
  blob: Blob;
  durationMs: number | null;
};

export type AppState = {
  sessionMode: string;
  isInitializing: boolean;
  isBenchmarkRunning: boolean;
  isPromptRunning: boolean;
  latestMetrics: Metrics | null;
  latestReport: Report | null;
  events: EventLog[];
  currentTestCase: TestCase | null;
  audioStateText: string;
  audioPlaybackUrl: string | null;
  statusText: string;
  statusKind: string;
  rawOutputText: string;
  expectedTranscript: string;
  parsedResponse: ParsedResponse | null;
  benchmarkEntries: BenchmarkEntry[];
  benchmarkHistory: CodexSummarySnapshot[];
  dynamicPromptVersion?: string;
  manualTranscript?: string;
  isTranscribingAudio?: boolean;
  detectedEmpathyMood?: "calm" | "focus" | "tired" | "frustrated";
  empathyWpm?: number;
};

declare global {
  interface Window {
    LanguageModel?: LanguageModelFactory;
  }

  const LanguageModel: LanguageModelFactory | undefined;
}
