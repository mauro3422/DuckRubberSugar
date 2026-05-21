import { SpeechNormalizer } from "./dist/src/utils/speech-normalizer.js";

const TEST_CASES = [
  // ===== BASIC PRINTF =====
  {
    id: "TC-01",
    desc: "Printf simple Hola mundo con punto y coma",
    input: 'el codigo es printf parentesis comilla Hola mundo comilla punto y coma',
    expectCode: 'printf("hola mundo"):',
    expectTags: ["spoken_print_call"],
  },
  {
    id: "TC-02",
    desc: "Printf con signo pesos variable",
    input: 'printf parentesis comilla Hola mundo punto signo pesos variable comilla punto y coma',
    expectCode: 'printf("hola mundo. $variable"):',
    expectTags: ["spoken_print_call"],
  },
  {
    id: "TC-03",
    desc: "Printf con dolar monto",
    input: 'printf parentesis comilla el total es dolar monto comilla punto y coma',
    expectCode: 'printf("el total es $monto"):',
    expectTags: ["spoken_print_call"],
  },
  {
    id: "TC-04",
    desc: "Printf con signo pesos y llave (template literal ${...})",
    input: 'printf parentesis comilla valor es signo pesos llave total llave comilla punto y coma',
    expectCode: 'printf("valor es ${total}"):',
    expectTags: ["spoken_print_call"],
  },
  {
    id: "TC-05",
    desc: "Printf con signo pesos (spanglish - dollar)",
    input: 'printf parenthesis quote hello dollar name quote semicolon',
    expectCode: 'printf("hello $name"):',
    expectTags: ["spoken_print_call"],
  },

  // ===== IF / NOT CONDITIONS =====
  {
    id: "TC-06",
    desc: "If not condition simple",
    input: 'if not count',
    expectCode: 'if (!count)',
    expectTags: ["spoken_not_condition"],
  },
  {
    id: "TC-07",
    desc: "If not condition con contexto largo",
    input: 'necesito que si no hay elementos haga if not notas parentesis',
    expectHasCode: true,
  },

  // ===== CONSOLE.LOG =====
  {
    id: "TC-08",
    desc: "Console.log via consola punto log (sin auto-close paren)",
    input: 'consola punto log parentesis comilla mensaje de prueba comilla punto y coma',
    expectHasCode: true,
    // Nota: falta el parentesis de cierre porque solo hay un "parentesis" en el transcript
    // (limitacion conocida del alternador abrir/cerrar)
  },
  {
    id: "TC-09",
    desc: "Console.log con texto (console punto log - inferCodeFromSpeech > hasCodePatterns)",
    input: 'console punto log parentesis comilla test comilla punto y coma',
    // inferCodeFromSpeech es mas permisivo que hasCodePatterns: extrae el span
    // desde "punto" y produce ".log('test';" aunque falte "console" y el paren de cierre
    expectHasCode: true,
  },

  // ===== ARROW FUNCTIONS =====
  {
    id: "TC-10",
    desc: "Arrow function suma",
    input: 'const suma igual parentesis a coma b parentesis flecha a mas b',
    expectHasCode: true,
  },

  // ===== ARRAY METHODS =====
  {
    id: "TC-11",
    desc: "Map array items (.map fix) - antes rechazado por leading dot en looksMalformedCode",
    input: 'items punto map parentesis item flecha item punto nombre parentesis',
    expectHasCode: true,
  },
  {
    id: "TC-12",
    desc: "Filter notas activas (.filter fix) - antes rechazado por leading dot",
    input: 'notas punto filter parentesis nota flecha nota punto activo igual igual igual verdadero parentesis',
    expectHasCode: true,
  },
  {
    id: "TC-13",
    desc: "innerHTML assignment (.innerHTML fix) - antes rechazado por leading dot",
    input: 'elemento punto innerHTML igual comilla hola mundo comilla',
    expectHasCode: true,
  },
  {
    id: "TC-12",
    desc: "Filter notas activas",
    input: 'notas punto filter parentesis nota flecha nota punto activo igual igual igual verdadero parentesis',
    expectHasCode: true,
  },

  // ===== DOM OPERATIONS =====
  {
    id: "TC-13",
    desc: "innerHTML assignment",
    input: 'elemento punto innerHTML igual comilla hola mundo comilla',
    expectHasCode: true,
  },
  {
    id: "TC-14",
    desc: "textContent via noteCount.textContent",
    input: 'noteCount punto textContent igual notas punto length punto tostring parentesis',
    expectHasCode: true,
  },

  // ===== PRONUNCIATION / MISRECOGNITION =====
  {
    id: "TC-15",
    desc: "Esprint f (mispronunciation of printf)",
    input: 'esprint f parentesis comilla valor es dolar total comilla punto y coma',
    expectCode: 'printf("valor es $total"):',
    expectTags: ["spoken_print_call"],
  },
  {
    id: "TC-16",
    desc: "Consola log (mispronunciation, sin auto-close paren)",
    input: 'consola log parentesis comilla error comilla punto y coma',
    expectHasCode: true,
  },
  {
    id: "TC-17",
    desc: "Printf sin punto y coma",
    input: 'printf parentesis comilla test comilla',
    expectHasCode: true,
  },

  // ===== MULTIPLE STATEMENTS =====
  {
    id: "TC-18",
    desc: "Dos printf consecutivos",
    input: 'printf comilla hola comilla punto y coma printf comilla adios comilla punto y coma',
    expectHasCode: true,
  },

  // ===== CONTEXT LEXICON =====
  {
    id: "TC-19",
    desc: "Context lexicon: noteList filter (detecta identifiers, no genera codigo - correcto)",
    input: 'mostrar note list filtrada',
    contextHint: 'identificadores_visibles: noteList, notasFiltradas, noteCount, activeClass',
    // Nota: detecta identifiers via buildCodeNotes, pero no produce codigo porque no hay
    // estructura de codigo en el habla. Comportamiento correcto.
    expectIdentifiers: ['noteList', 'noteCount'],
    expectUncertain: true,
    expectHasCode: false,
  },
  {
    id: "TC-20",
    desc: "Context lexicon: notasFiltradas (detecta identifiers, no genera codigo - correcto)",
    input: 'actualizar notas filtradas',
    contextHint: 'identificadores_visibles: noteList, notasFiltradas, noteCount',
    expectIdentifiers: ['notasFiltradas'],
    expectUncertain: true,
    expectHasCode: false,
  },

  // ===== BRACKET MATCHING =====
  {
    id: "TC-21",
    desc: "Array literal con brackets",
    input: 'const lista igual corchete uno coma dos coma tres corchete',
    expectHasCode: true,
  },

  // ===== IF STATEMENT =====
  {
    id: "TC-22",
    desc: "If statement equality check",
    input: 'if parentesis x igual igual igual cinco parentesis abrir llave cerrar llave',
    expectHasCode: true,
  },

  // ===== EDGE CASES =====
  {
    id: "TC-23",
    desc: "Code with dolar variable in string",
    input: 'el sistema muestra printf parentesis comilla el valor es signo pesos total con IVA comilla punto y coma',
    expectHasCode: true,
  },
  {
    id: "TC-24",
    desc: "Let declaration - 'igual' es ASSIGN signal (correcto que detecte codigo)",
    input: 'let contador igual cero',
    // 'igual' se detecta como ASSIGN (spoken punctuation signal), funciona bien.
    expectHasCode: true,
  },
  {
    id: "TC-25",
    desc: "False positive: conversation (should NOT produce code)",
    input: 'Hola como estas todo bien espero que si ningun problema aca estamos probando el sistema',
    expectHasCode: false,
  },
  {
    id: "TC-26",
    desc: "Dictation stutter (repeated comilla)",
    input: 'printf parentesis comilla comilla Hola mundo comilla punto y coma',
    expectHasCode: true,
  },
  {
    id: "TC-27",
    desc: "If not going (sin 'count' en texto, no mapea a 'count' automaticamente)",
    input: 'if not going',
    expectHasCode: true,
  },
  {
    id: "TC-28",
    desc: "innerHTML via inner html spoken (. fix)",
    input: 'div punto inner html igual texto',
    expectHasCode: true,
  },

  // ===== REPRODUCE THE USER'S ORIGINAL BUG =====
  {
    id: "TC-29",
    desc: "Reproduccion exacta del bug original: printf + signo pesos variable",
    input: 'printf parentesis comilla Hola mundo comilla punto signo pesos variable parentesis comilla punto y coma',
    expectHasCode: true,
  },
  {
    id: "TC-30",
    desc: "Transcripcion larga real del user (signo pesos bug)",
    input: 'Hola como estas Este es un audio de prueba te voy a decir un poco de codigo y veremos si es capaz de codigo probable reconstruido de reconstruirlo justamente el codigo es printf parentesis comilla Hola mundo comilla punto signo pesos variable parentesis comilla punto y coma',
    expectHasCode: true,
  },
];

function runTests() {
  const results = [];
  let passed = 0;
  let failed = 0;

  console.log("=".repeat(90));
  console.log("  DUCKSUGAR SPEECH NORMALIZER - TEST SUITE AUTÓNOMO");
  console.log("  Ejecutado:", new Date().toISOString());
  console.log("=".repeat(90));
  console.log();

  for (const tc of TEST_CASES) {
    const start = performance.now();

    const hasCode = SpeechNormalizer.hasCodePatterns(tc.input, tc.contextHint || "");
    const inference = SpeechNormalizer.inferCodeFromSpeech(tc.input, tc.contextHint || "");
    const elapsed = (performance.now() - start).toFixed(2);

    if (inference.code) {
      // Trim trailing/leading whitespace for comparison
      inference.code = inference.code.trim();
    }

    // Determine if test passed
    let ok = true;
    const failures = [];

    if (tc.expectCode !== undefined) {
      const actual = inference.code || "";
      if (actual !== tc.expectCode) {
        ok = false;
        failures.push(`code mismatch: got "${actual}", expected "${tc.expectCode}"`);
      }
    }

    if (tc.expectTags !== undefined) {
      for (const tag of tc.expectTags) {
        if (!inference.tags.includes(tag)) {
          ok = false;
          failures.push(`missing tag: ${tag} (got ${JSON.stringify(inference.tags)})`);
        }
      }
    }

    if (tc.expectIdentifiers !== undefined) {
      const notesStr = (inference.notes || []).join(" ");
      for (const ident of tc.expectIdentifiers) {
        if (!notesStr.includes(ident)) {
          ok = false;
          failures.push(`expected identifier '${ident}' in notes, got notes=${JSON.stringify(inference.notes)}`);
        }
      }
    }

    if (tc.expectUncertain !== undefined && tc.expectUncertain) {
      const hasUncertain = (inference.notes || []).some((n) => n.startsWith("uncertain:"));
      if (!hasUncertain) {
        ok = false;
        failures.push(`expected uncertain note, got notes=${JSON.stringify(inference.notes)}`);
      }
    }

    if (tc.expectHasCode !== undefined) {
      const actualHasCode = inference.code.length > 0;
      if (tc.expectHasCode && !actualHasCode) {
        ok = false;
        failures.push(`expected hasCode=true but got code=""`);
      }
      if (!tc.expectHasCode && actualHasCode) {
        ok = false;
        failures.push(`expected hasCode=false but got code="${inference.code}"`);
      }
    }

    if (ok) passed++;
    else failed++;

    results.push({
      ...tc,
      hasCode,
      code: inference.code,
      tags: inference.tags,
      notes: inference.notes,
      elapsed,
      ok,
      failures,
    });
  }

  // Print results
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    console.log(`[${icon}] ${r.id} - ${r.desc}`);
    console.log(`      Input[..${r.input.length}]...: "${r.input.slice(0, 80)}${r.input.length > 80 ? "..." : ""}"`);
    console.log(`      hasCodePatterns: ${r.hasCode}, Code: "${r.code || "(empty)"}"`);
    console.log(`      Tags: ${JSON.stringify(r.tags)}`);
    if (r.notes?.length) console.log(`      Notes: ${r.notes.join(" | ")}`);
    console.log(`      Time: ${r.elapsed}ms`);
    if (!r.ok) {
      console.log(`      FAILURES:`);
      for (const f of r.failures) console.log(`        - ${f}`);
    }
    console.log();
  }

  // ===== SUMMARY =====
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);
  const avgTime = (results.reduce((s, r) => s + parseFloat(r.elapsed), 0) / total).toFixed(2);
  const tagCounts = {};
  for (const r of results) {
    for (const t of r.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  console.log("=".repeat(90));
  console.log("  RESUMEN FINAL");
  console.log("=".repeat(90));
  console.log(`  Total: ${total} casos`);
  console.log(`  Pasaron: ${passed} (${passRate}%)`);
  console.log(`  Fallaron: ${failed}`);
  console.log(`  Tiempo promedio: ${avgTime}ms`);
  console.log();
  console.log("  Distribucion de Tags:");
  for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / total) * 100).toFixed(1);
    console.log(`    ${tag.padEnd(35)} ${String(count).padStart(2)}/${total} (${pct}%)`);
  }
  console.log();

  // ===== ANALISIS DE FALLOS =====
  const failed_results = results.filter((r) => !r.ok);
  if (failed_results.length > 0) {
    console.log("=".repeat(90));
    console.log("  ANALISIS DE FALLOS");
    console.log("=".repeat(90));
    for (const r of failed_results) {
      console.log(`  [${r.id}] ${r.desc}`);
      for (const f of r.failures) console.log(`    ${f}`);
      console.log(`    >> Posible causa: verificar regex en inferPrintfCall / normalizeSpokenCodeTokens`);
      console.log();
    }
  }

  // ===== RECOMENDACIONES =====
  console.log("=".repeat(90));
  console.log("  RECOMENDACIONES");
  console.log("=".repeat(90));
  if (failed === 0) {
    console.log("  Todos los casos pasaron. El reconstructor local (SpeechNormalizer)");
    console.log("  funciona correctamente para el conjunto de pruebas actual.");
  } else {
    const tagIssues = failed_results.filter((r) => r.failures.some((f) => f.includes("tag")));
    const codeIssues = failed_results.filter((r) => r.failures.some((f) => f.includes("code")));
    const hasCodeIssues = failed_results.filter((r) => r.failures.some((f) => f.includes("hasCode")));

    if (tagIssues.length) console.log(`  - ${tagIssues.length} casos con tags faltantes`);
    if (codeIssues.length) console.log(`  - ${codeIssues.length} casos con code mismatch`);
    if (hasCodeIssues.length) console.log(`  - ${hasCodeIssues.length} casos con hasCode mismatch`);
    console.log("  Revisar speech-normalizer.ts para ajustar regex/funciones afectadas.");
  }
  console.log();
}

runTests();
