// Pega esto en la consola de Chrome (F12) mientras usas DuckSugar.
// Mide el rendimiento real de tu Gemini Nano + GPU.

;(async () => {
  const fmt = (n) => (n).toFixed(1).padStart(8);

  console.log('%c═══ DuckSugar GPU Benchmark ═══', 'font-size:14px;font-weight:bold');

  // 1. WebGPU check
  console.log(`WebGPU: ${navigator.gpu ? 'DISPONIBLE' : 'NO — modo CPU'}`);
  console.log(`Hardware threads: ${navigator.hardwareConcurrency}`);

  // 2. Availability
  const avail = await LanguageModel.availability();
  console.log(`Modelo: ${avail}`);
  if (avail !== 'available') {
    console.log('%cAbrí DuckSugar primero y reintentá.', 'color:orange');
    return;
  }

  // 3. Benchmark con Gemini Nano
  const session = await LanguageModel.create({
    temperature: 0.1, topK: 10,
    initialPrompts: [{ role: 'system', content: 'Sé conciso.' }],
  });

  console.log(`Context Window: ${session.contextWindow} tokens`);

  // Pre-warm
  await session.prompt('warmup');
  console.log(`Context tras warmup: ${session.contextUsage} / ${session.contextWindow}`);

  // 3 corridas de benchmark
  const RUNS = 3;
  let ttfts = [], totals = [], rates = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    let first = null, lastLen = 0;
    const stream = session.promptStreaming('Responde exactamente: "Benchmark completo. Fin del test."');
    for await (const chunk of stream) {
      if (!first) first = performance.now();
      lastLen = String(chunk).length;
    }
    const total = performance.now() - t0;
    const ttft = first - t0;
    const active = Math.max(1, total - ttft);
    ttfts.push(ttft);
    totals.push(total);
    rates.push((lastLen / 4) / (active / 1000));
  }

  const avgTTFT = ttfts.reduce((a,b)=>a+b,0) / RUNS;
  const avgTotal = totals.reduce((a,b)=>a+b,0) / RUNS;
  const avgTPS = rates.reduce((a,b)=>a+b,0) / RUNS;

  console.log('');
  console.log('%c═══ Resultados ═══', 'font-size:13px;font-weight:bold');
  console.log(`TTFT promedio:  ${fmt(avgTTFT)} ms`);
  console.log(`Total promedio: ${fmt(avgTotal)} ms`);
  console.log(`TPS estimado:   ${fmt(avgTPS)} tok/s`);

  // 4. Performance Class (según docs de Chrome)
  console.log('');
  console.log('%c═══ Performance Class ═══', 'font-size:13px;font-weight:bold');
  let pc = '—';
  if (avgTPS > 35 && avgTTFT < 120) pc = 'kVeryHigh — GPU HIGHEST_QUALITY (GPU best)';
  else if (avgTPS > 25 && avgTTFT < 150) pc = 'kHigh — GPU HIGHEST_QUALITY';
  else if (avgTPS > 15 && avgTTFT < 250) pc = 'kMedium — GPU FASTEST_INFERENCE';
  else if (avgTPS > 5 && avgTTFT < 400) pc = 'kLow — GPU FASTEST_INFERENCE';
  else pc = 'CPU / kVeryLow';
  console.log(`→ ${pc}`);

  // 5. Sesiones paralelas estimadas
  console.log('');
  console.log('%c═══ Concurrencia ═══', 'font-size:13px;font-weight:bold');
  if (avgTPS > 25) {
    console.log('→ GPU dedicada (~6-8 GB VRAM): 2-3 sesiones paralelas');
  } else if (avgTPS > 10) {
    console.log('→ GPU integrada (~2-4 GB VRAM): 1-2 sesiones paralelas');
  } else {
    console.log(`→ CPU (${navigator.hardwareConcurrency} threads): 1-2 sesiones`);
  }

  console.log('');
  console.log('%c═══ Fin ═══', 'font-size:14px;font-weight:bold');
  session.destroy();
})();
