import re

with open('src/services/benchmark-service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Imports
content = re.sub(r"import type \{ BenchmarkEntry, CodeUncertainties, Report \} from '../types\.js';", "import type { BenchmarkEntry, Report } from '../types.js';", content)

# Lines 112-117
content = re.sub(r"entry\.contextNeed \?\? ", "", content)
content = re.sub(r"entry\.rejectionReason \?\? ", "", content)
content = re.sub(r"entry\.placeholderFlags \?\? ", "", content)
content = re.sub(r"entry\.hallucinationFlags \?\? ", "", content)
content = re.sub(r"entry\.semanticMisrecognitions \?\? ", "", content)
content = re.sub(r"entry\.answerQuality \?\? ", "", content)

# Lines 148-164
content = re.sub(r"detectedLanguage: parsed\.detected_language \?\? '',\n\s*confidence: parsed\.confidence \?\? '',\n\s*diagnosticTags: parsed\.diagnostic_tags \?\? \[\],\n\s*nextAction: parsed\.next_action \?\? \(parsed\.needs_context \? 'ask_show_code' : ''\),\n\s*rejectionReason: diagnostics\.rejectionReason,\n\s*placeholderFlags: diagnostics\.placeholderFlags,\n\s*hallucinationFlags: diagnostics\.hallucinationFlags,\n\s*semanticMisrecognitions: diagnostics\.semanticMisrecognitions,\n\s*contextNeed: diagnostics\.contextNeed,\n\s*qualityBucket: diagnostics\.qualityBucket,\n\s*answerLanguage: diagnostics\.answerLanguage,\n\s*answerLanguageMatchesUser: diagnostics\.answerLanguageMatchesUser,\n\s*answerQuality: diagnostics\.answerQuality,\n\s*uncertaintyCount: this\.countUncertainties\(parsed\.code_uncertainties\),\n\s*uncertaintySummary: this\.summarizeUncertainties\(parsed\.code_uncertainties\),\n\s*probableCode: parsed\.probable_code \?\? '',\n\s*transcription: parsed\.transcription \?\? '',", "is_directed: parsed.is_directed,\n      lang: parsed.lang ?? '',\n      needs_context: parsed.needs_context,\n      code: parsed.code ?? '',\n      transcript: parsed.transcript ?? '',", content)

# answer: this.compactText(parsed.answer ?? parsed.general_answer ?? '', 700) -> parsed.answer
content = re.sub(r"answer: this\.compactText\(parsed\.answer \?\? parsed\.general_answer \?\? '', 700\)", "answer: this.compactText(parsed.answer ?? '', 700)", content)

# Lines 241-257
content = re.sub(r"intent: parsed\.intent \?\? '',\n\s*userSituation: parsed\.user_situation \?\? '',\n\s*userNeed: parsed\.user_need \?\? '',\n\s*detectedLanguage: parsed\.detected_language \?\? '',\n\s*confidence: parsed\.confidence \?\? '',\n\s*nextAction: parsed\.next_action \?\? \(parsed\.needs_context \? 'ask_show_code' : ''\),\n\s*needsContext: parsed\.needs_context \?\? false,\n\s*diagnosticTags: parsed\.diagnostic_tags \?\? \[\],\n\s*audioIssues: parsed\.audio_issues \?\? \[\],\n\s*codeUncertainties: this\.summarizeUncertainties\(parsed\.code_uncertainties\),\n\s*transcription: parsed\.transcription \?\? '',\n\s*probableCode: parsed\.probable_code \?\? '',\n\s*answer: parsed\.answer \?\? '',\n\s*generalAnswer: parsed\.general_answer \?\? '',\n\s*codeAnswer: parsed\.code_answer \?\? '',\n\s*reasoningNotes: parsed\.reasoning_notes \?\? '',\n\s*warnings: parsed\.warnings \?\? ''", "is_directed: parsed.is_directed,\n        lang: parsed.lang ?? '',\n        needs_context: parsed.needs_context ?? false,\n        code: parsed.code ?? '',\n        transcript: parsed.transcript ?? '',\n        answer: parsed.answer ?? ''", content)

# Lines 276-290
content = re.sub(r"confidence: entry\.confidence,\n\s*nextAction: entry\.nextAction \?\? '',\n\s*diagnosticTags: entry\.diagnosticTags \?\? \[\],\n\s*rejectionReason: entry\.rejectionReason \?\? diagnostics\.rejectionReason,\n\s*placeholderFlags: entry\.placeholderFlags \?\? diagnostics\.placeholderFlags,\n\s*hallucinationFlags: entry\.hallucinationFlags \?\? diagnostics\.hallucinationFlags,\n\s*semanticMisrecognitions: entry\.semanticMisrecognitions \?\? diagnostics\.semanticMisrecognitions,\n\s*contextNeed: entry\.contextNeed \?\? diagnostics\.contextNeed,\n\s*qualityBucket: entry\.qualityBucket \?\? diagnostics\.qualityBucket,\n\s*answerLanguage: entry\.answerLanguage \?\? diagnostics\.answerLanguage,\n\s*answerLanguageMatchesUser: entry\.answerLanguageMatchesUser \?\? diagnostics\.answerLanguageMatchesUser,\n\s*answerQuality: entry\.answerQuality \?\? diagnostics\.answerQuality,\n\s*uncertaintySummary: entry\.uncertaintySummary,\n\s*probableCode: entry\.probableCode,\n\s*transcription: entry\.transcription", "is_directed: entry.is_directed,\n      lang: entry.lang,\n      needs_context: entry.needs_context,\n      code: entry.code,\n      transcript: entry.transcript,\n      rejectionReason: diagnostics.rejectionReason,\n      placeholderFlags: diagnostics.placeholderFlags,\n      hallucinationFlags: diagnostics.hallucinationFlags,\n      semanticMisrecognitions: diagnostics.semanticMisrecognitions,\n      contextNeed: diagnostics.contextNeed,\n      qualityBucket: diagnostics.qualityBucket,\n      answerLanguage: diagnostics.answerLanguage,\n      answerLanguageMatchesUser: diagnostics.answerLanguageMatchesUser,\n      answerQuality: diagnostics.answerQuality", content)

# Lines 300-309
content = re.sub(r"probableCode: parsed\.probable_code \?\? '',\n\s*transcription: parsed\.transcription \?\? '',\n\s*answer: parsed\.answer \?\? parsed\.general_answer \?\? '',\n\s*generalAnswer: parsed\.general_answer \?\? '',\n\s*needsContext: parsed\.needs_context \?\? false,\n\s*expectedCode: report\.expectedCode,\n\s*intent: parsed\.intent \?\? '',\n\s*detectedLanguage: parsed\.detected_language \?\? '',\n\s*nextAction: parsed\.next_action \?\? \(parsed\.needs_context \? 'ask_show_code' : ''\),\n\s*diagnosticTags: parsed\.diagnostic_tags \?\? \[\]", "probableCode: parsed.code ?? '',\n      transcription: parsed.transcript ?? '',\n      answer: parsed.answer ?? '',\n      generalAnswer: '',\n      needsContext: parsed.needs_context ?? false,\n      expectedCode: report.expectedCode,\n      intent: '',\n      detectedLanguage: parsed.lang ?? '',\n      nextAction: parsed.needs_context ? 'ask_show_code' : '',\n      diagnosticTags: []", content)

# Lines 318-328
content = re.sub(r"rawOutput: \[entry\.probableCode, entry\.transcription, entry\.outputTail\]\.filter\(Boolean\)\.join\('\\n'\),\n\s*probableCode: entry\.probableCode,\n\s*transcription: entry\.transcription,\n\s*answer: entry\.answer \?\? '',\n\s*generalAnswer: '',\n\s*needsContext: \(entry\.nextAction \?\? ''\) === 'ask_show_code',\n\s*expectedCode: this\.expectedCodeForEntry\(entry\),\n\s*intent: '',\n\s*detectedLanguage: entry\.detectedLanguage,\n\s*nextAction: entry\.nextAction \?\? '',\n\s*diagnosticTags: entry\.diagnosticTags \?\? \[\]", "rawOutput: [entry.code, entry.transcript, entry.outputTail].filter(Boolean).join('\\n'),\n      probableCode: entry.code ?? '',\n      transcription: entry.transcript ?? '',\n      answer: entry.answer ?? '',\n      generalAnswer: '',\n      needsContext: entry.needs_context ?? false,\n      expectedCode: this.expectedCodeForEntry(entry),\n      intent: '',\n      detectedLanguage: entry.lang ?? '',\n      nextAction: entry.needs_context ? 'ask_show_code' : '',\n      diagnosticTags: []", content)

# isMeaningfulReport
content = content.replace("parsed.transcription?.trim()", "parsed.transcript?.trim()")
content = content.replace("parsed.probable_code?.trim()", "parsed.code?.trim()")

# detectCommonFailures
content = content.replace("entry.qualityBucket ?? this.analyzeEntry(entry).qualityBucket", "this.analyzeEntry(entry).qualityBucket")
content = content.replace("!entry.probableCode.trim()", "!(entry.code ?? '').trim()")
content = content.replace("this.looksLikePlaceholderCode(entry.probableCode)", "this.looksLikePlaceholderCode(entry.code ?? '')")
content = content.replace("this.looksHallucinated(entry.probableCode)", "this.looksHallucinated(entry.code ?? '')")
content = content.replace("entry.placeholderFlags ?? this.analyzeEntry(entry).placeholderFlags", "this.analyzeEntry(entry).placeholderFlags")
content = content.replace("entry.hallucinationFlags ?? this.analyzeEntry(entry).hallucinationFlags", "this.analyzeEntry(entry).hallucinationFlags")
content = content.replace("entry.semanticMisrecognitions ?? this.analyzeEntry(entry).semanticMisrecognitions", "this.analyzeEntry(entry).semanticMisrecognitions")

# Remove countUncertainties and summarizeUncertainties completely
content = re.sub(r'  private countUncertainties.*?\}\n', '', content, flags=re.DOTALL)

with open('src/services/benchmark-service.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced successfully")
