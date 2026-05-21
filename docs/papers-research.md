# Research Papers — Speech-to-Code for DuckSugar

## 1. Kencode — Vocal Programming Tool (JVLC 2025)

**Title**: *A Method of Vocal Programming Using Natural Language Without Code Editor*
**Authors**: Takumi Yamaguchi, Keigo Matsumoto, Haruya Shiba, Tomoo Inoue
**Venue**: Journal of Vision, Imaging, and Signal Processing (JVLC), 2025

### Key Contributions
- Formal taxonomy **[K][B][O][W]** for vocal programming:
  - **[K]eywords**: Language structural keywords (`if`, `for`, `while`)
  - **[B]ase-words**: Base operations (`printf`, `display`, `scan`)
  - **[O]perators**: Operations (`+`, `-`, `=`, `*`)
  - **[W]ords**: Identifiers and variable names
- Complete vocally-programmable language with 22 grammar rules
- Grammar handles lists, conditions, loops, function calls — including non-deterministic resolution of ambiguous tokens
- 8 participants could write 3 programs each (despite some taking >30 minutes)
- Efficiency improved 16-20% over bare dictation by the third program

### Relevance to DuckSugar
- Taxonomy directly applicable to SpeechNormalizer tag system
- Non-deterministic grammar suggests confidence-based matching is the right approach
- [K][B][O][W] mapping mirrors our planned rule categories

**Link**: https://www.jstage.jst.go.jp/article/jvics/3/1/3_14/_pdf

---

## 2. Spoken Java (Begel, PhD Dissertation)

**Author**: Andrew Begel (UC Berkeley, 2005)
**Topics**: XGLR parser, lexical/syntactic/semantic ambiguity

### Key Contributions
- **XGLR parser**: Handles all three levels of ambiguity in spoken code
  - *Lexical*: "print" vs "println", homophones
  - *Syntactic*: Multiple valid parse trees for same spoken input
  - *Semantic*: Variable name scope, type resolution
- Complete spoken Java environment with IDE integration
- Formative evaluation with professional programmers

### Relevance to DuckSugar
- XGLR-style ambiguity resolution maps to our mismatch tag system
- Three-level ambiguity framework useful for designing our confidence scoring
- Demonstrates that IDE context is essential for semantic disambiguation
- Pioneering work (2005) — nearly 20 years old but still relevant

---

## 3. VoiceJava — Programming by Voice (Shahebaz, 2019)

**Title**: *Programming by Voice: A Domain-Specific Pronunciation Approach*
**Author**: Shahebaz

### Key Contributions
- Domain-specific pronunciation model for code
- Maps spoken "dot" → `.`, "open bracket" → `(`, etc.
- Focus on reducing error rates through tailored language models

### Relevance to DuckSugar
- Confirms the approach of domain-specific pronunciation handling
- Our `universal-grammar.ts` token patterns follow similar principles
- Supports our decision to use contextual recovery over universal dictionaries

---

## 4. fuSE — Spoken Code Input Framework (Washizaki, 2025)

**Title**: *fuSE: A Framework for Supporting Spoken Code Input*
**Authors**: Hironori Washizaki et al. (Waseda University)
**Venue**: 2025

### Key Contributions
- Comprehensive framework for converting speech to code
- Supports multiple programming languages
- Evaluated with 12 participants across Python, Java, JavaScript

### Relevance to DuckSugar
- Multi-language support aligns with our ES/EN bilingual approach
- Framework architecture provides reference for our pipeline design
- Evaluation methodology useful for future benchmark design

---

## 5. ACM Empirical Study (ACM 2023)

**Title**: *Voice-Based Programming: An Empirical Study of Developers' Dictation Behavior*
**Venue**: ACM Conference, 2023

### Key Findings
- Semicolons dictated only ~60% of the time (users expect auto-complete)
- Parentheses dictated 72-83% of the time, rarely both open and close
- Users naturally omit closing delimiters — expecting the system to infer them
- Significant difference between experienced and novice voice programmers

### Relevance to DuckSugar
- Validates our approach of NOT requiring users to dictate every closing paren/brace
- Our mismatch tags (`possible_unclosed_paren`) handle omitted delimiters better than silent correction
- Confirms that dictation patterns vary widely — confidence scoring is essential

---

## 6. Commercial Systems (Not Published)

### Code Dictator (VS Code Extension)
- 50+ hardcoded keyword-to-symbol mappings
- User says "open bracket three" → `{{{`
- Pure dictionary lookup, no LLM, no ambiguity handling
- **Limitation**: No Spanish support, no confidence scoring

### VoxPilot (AI-powered dictation)
- LLM-based code dictation from speech
- Handles natural language descriptions of code
- **Limitation**: Proprietary, cloud-based, no local-only mode

### Serenade (Cross-editor Voice Coding)
- Natural language to code via custom engine
- "Add a button that says hello" → generates component code
- **Limitation**: Shutdown in 2024, no Spanish variant

## Summary: Why DuckSugar Is Different

| System | Approach | Spanish? | Local-Only? | Confidence Tags? | Smart Regex? |
|--------|----------|----------|-------------|------------------|-------------|
| Kencode | Formal grammar | No | Yes | No | No (hardcoded [K][B][O][W]) |
| Code Dictator | Dictionary lookup | No | Yes | No | No (50 hardcoded mappings) |
| Serenade | Custom NL engine | No | No | No | No |
| VoxPilot | Cloud LLM | Yes | No | No | No |
| Spoken Java | XGLR parser | No | Yes | No | No (deterministic) |
| **DuckSugar** | **Smart regex + LLM** | **ES/EN** | **Yes** | **Planned** | **In progress** |

No existing system combines: (1) Spanish + English bilingual input, (2) local-only execution, (3) confidence-based mismatch detection, and (4) a smart regex library with context lexicon resolution.
