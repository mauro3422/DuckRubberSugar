import type { BenchmarkDataset } from "../types.js";

export const DefaultDataset: BenchmarkDataset = {
  id: "ds-alpha-01",
  name: "DuckSugar Alpha Tests",
  cases: [
    {
      id: "tc-01-hello",
      fileName: "Prueba0.weba",
      expectedTranscript: "",
      expectedCode: "printf(\"hola mundo\"):",
    },
    {
      id: "tc-02-notecount",
      fileName: "prueba 2.wav",
      expectedTranscript: "",
      expectedCode: "if (!count)",
    },
    {
      id: "tc-03-notelist",
      fileName: "prueba 3.wav",
      expectedTranscript: "",
      expectedCode: "noteList.innerHTML = notasFiltradas.map(nota => { const activeClass = nota.id === noteActiveId ? 'active' : ''; });\nif (noteCount) {\n  noteCount.textContent = notasFiltradas.length + ' notas';\n}",
      contextHint: "<ide_context>\ntipo: contexto_visible_de_ide\nlenguaje_probable: JavaScript\ntema: lista de notas filtradas\nidentificadores_visibles: noteList, notasFiltradas, nota, noteActiveId, activeClass, noteCount\ntokens_visibles: innerHTML, map, const, id, active, if, textContent, length, notas\ninstruccion: usar solo para elegir identificadores cuando el audio sea ambiguo; no completar lineas que el audio no mencione.\n</ide_context>",
    },
  ],
};
