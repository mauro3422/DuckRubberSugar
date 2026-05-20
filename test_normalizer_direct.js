import { SpeechNormalizer } from "./dist/src/utils/speech-normalizer.js";

const transcript = "Hola cómo estás necesitaría que eh ahora estamos haciendo una prueba de tu funcionamiento voy a contarte un algoritmo la parte de código y dime si me entiendes Sprint F paréntesis comilla Hola mundo paréntesis comilla dos puntos Bueno eso es solo todo cha";

console.log("--- START TEST ---");
const result = SpeechNormalizer.inferCodeFromSpeech(transcript);
console.log("Normalized Code Output:", JSON.stringify(result.code));
console.log("Tags:", result.tags);
