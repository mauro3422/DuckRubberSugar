import type { BenchmarkDataset } from "../types.js";

export const DefaultDataset: BenchmarkDataset = {
  id: "ds-alpha-01",
  name: "DuckSugar Alpha Tests",
  cases: [
    {
      id: "tc-01-hello",
      fileName: "Prueba0.weba",
      expectedTranscript: "Hola, como estas? Necesitaria que eh, ahora estamos haciendo una prueba de tu funcionamiento. Voy a contarte un algoritmo o una parte de codigo y dime si me entiendes: print f, parentesis, comilla, hola mundo, parentesis, comilla, dos puntos. Bueno, eso es solo todo, chao.",
      expectedCode: 'printf("hola mundo)"):' ,
    },
    {
      id: "tc-02-notecount",
      fileName: "prueba 2.wav",
      expectedTranscript: "Mira, aca tengo una pregunta. En en if not count, por que eh una condicion vacia que cuando eh not count es rellenado mas arriba? Eh o como poronga que detecta si esta vacio o no para dejar si se comprueba esta condicion?",
      expectedCode: "if (!count)",
    },
    {
      id: "tc-03-notelist",
      fileName: "prueba 3.wav",
      expectedTranscript: "Hola, hola, como estas? Estoy haciendo aca metiendo unos filtros todavia a un modelo, estoy leyendo un poco el codigo, ahora estoy en la parte donde estoy en note list.innerhtml. Igual notas filtradas.map, nota arrow function const active class, nota id igual igual igual, nota active id, active, bueno, okay. Despues de eso me toca un if note count que estoy metiendo un contador si no me equivoco, eh, note.count.text content eh, content igual, eh, comilla, notas, eh, notas filtradas, eh, con la escritura correcta claramente, length de notas.",
      expectedCode: "noteList.innerHTML = notasFiltradas.map(nota => { const activeClass = nota.id === noteActiveId ? 'active' : ''; });\nif (noteCount) {\n  noteCount.textContent = notasFiltradas.length + ' notas';\n}",
      contextHint: "<ide_context>\ntipo: contexto_visible_de_ide\nlenguaje_probable: JavaScript\ntema: lista de notas filtradas\nidentificadores_visibles: noteList, notasFiltradas, nota, noteActiveId, activeClass, noteCount\ntokens_visibles: innerHTML, map, const, id, active, if, textContent, length, notas\ninstruccion: usar solo para elegir identificadores cuando el audio sea ambiguo; no completar lineas que el audio no mencione.\n</ide_context>",
    },
    {
      id: "tc-04-printf",
      fileName: "prueba4.ogg",
      expectedTranscript: "",
      expectedCode: "",
    },
  ],
};
