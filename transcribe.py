import os
import json
import re
import sys

# Asegurar que SpeechRecognition está instalado
try:
    import speech_recognition as sr
except ImportError:
    print("Instalando SpeechRecognition mediante pip...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "SpeechRecognition"])
    import speech_recognition as sr

REGISTRY_PATH = "pruebas/dataset-registry.json"
DATASET_TS_PATH = "src/data/default-dataset.ts"
PRUEBAS_DIR = "pruebas"

DEFAULT_CASES = [
    {
        "id": "tc-01-hello",
        "fileName": "Prueba0.weba",
        "expectedTranscript": "Hola, como estas? Necesitaria que eh, ahora estamos haciendo una prueba de tu funcionamiento. Voy a contarte un algoritmo o una parte de codigo y dime si me entiendes: print f, parentesis, comilla, hola mundo, parentesis, comilla, dos puntos. Bueno, eso es solo todo, chao.",
        "expectedCode": "printf(\"hola mundo)\":"
    },
    {
        "id": "tc-02-notecount",
        "fileName": "prueba 2.wav",
        "expectedTranscript": "Mira, aca tengo una pregunta. En en if not count, por que eh una condicion vacia que cuando eh not count es rellenado mas arriba? Eh o como poronga que detecta si esta vacio o no para dejar si se comprueba esta condicion?",
        "expectedCode": "if (!count)"
    },
    {
        "id": "tc-03-notelist",
        "fileName": "prueba 3.wav",
        "expectedTranscript": "Hola, hola, como estas? Estoy haciendo aca metiendo unos filtros todavia a un modelo, estoy leyendo un poco el codigo, ahora estoy en la parte donde estoy en note list.innerhtml. Igual notas filtradas.map, nota arrow function const active class, nota id igual igual igual, nota active id, active, bueno, okay. Despues de eso me toca un if note count que estoy metiendo un contador si no me equivoco, eh, note.count.text content eh, content igual, eh, comilla, notas, eh, notas filtradas, eh, con la escritura correcta claramente, length de notas.",
        "expectedCode": "noteList.innerHTML = notasFiltradas.map(nota => { const activeClass = nota.id === noteActiveId ? 'active' : ''; });\nif (noteCount) {\n  noteCount.textContent = notasFiltradas.length + ' notas';\n}",
        "contextHint": "<ide_context>\ntipo: contexto_visible_de_ide\nlenguaje_probable: JavaScript\ntema: lista de notas filtradas\nidentificadores_visibles: noteList, notasFiltradas, nota, noteActiveId, activeClass, noteCount\ntokens_visibles: innerHTML, map, const, id, active, if, textContent, length, notas\ninstruccion: usar solo para elegir identificadores cuando el audio sea ambiguo; no completar lineas que el audio no mencione.\n</ide_context>"
    }
]

def load_registry():
    if os.path.exists(REGISTRY_PATH):
        try:
            with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error cargando el registro JSON: {e}. Recreándolo.")
    
    # Crear registro inicial
    os.makedirs(PRUEBAS_DIR, exist_ok=True)
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(DEFAULT_CASES, f, indent=2, ensure_ascii=False)
    return DEFAULT_CASES

def save_registry(registry):
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)

def clean_filename_to_id(filename):
    name = os.path.splitext(filename)[0]
    clean = re.sub(r"[^a-zA-Z0-9\-]", "-", name).lower()
    clean = re.sub(r"-+", "-", clean).strip("-")
    return f"tc-auto-{clean}"

def transcribe_audio_file(filepath):
    print(f"Transcribiendo '{filepath}' con la API de Google...")
    r = sr.Recognizer()
    try:
        with sr.AudioFile(filepath) as source:
            audio = r.record(source)
        # es-AR para acento argentino/rioplatense
        transcript = r.recognize_google(audio, language="es-AR")
        print(f"Transcripción exitosa: \"{transcript}\"")
        return transcript
    except Exception as e:
        print(f"[ERROR] Error transcribiendo '{filepath}': {e}")
        return None

def write_typescript_dataset(cases):
    ts_content = [
        "import type { BenchmarkDataset } from \"../types.js\";",
        "",
        "export const DefaultDataset: BenchmarkDataset = {",
        "  id: \"ds-alpha-01\",",
        "  name: \"DuckSugar Alpha Tests\",",
        "  cases: ["
    ]

    for case in cases:
        case_id = case["id"]
        filename = case["fileName"]
        # Escapar comillas dobles y saltos de línea para el JS/TS
        transcript = case["expectedTranscript"].replace('"', '\\"').replace('\n', '\\n')
        expected_code = case["expectedCode"].replace('"', '\\"').replace('\n', '\\n')
        
        ts_content.append("    {")
        ts_content.append(f"      id: \"{case_id}\",")
        ts_content.append(f"      fileName: \"{filename}\",")
        ts_content.append(f"      expectedTranscript: \"{transcript}\",")
        ts_content.append(f"      expectedCode: \"{expected_code}\",")
        
        if "contextHint" in case and case["contextHint"]:
            hint = case["contextHint"].replace('"', '\\"').replace('\n', '\\n')
            ts_content.append(f"      contextHint: \"{hint}\",")
            
        ts_content.append("    },")

    ts_content.extend([
        "  ],",
        "};",
        ""
    ])

    with open(DATASET_TS_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(ts_content))
    print(f"[OK] Archivo '{DATASET_TS_PATH}' regenerado con exito.")

def main():
    print("=== DuckSugar Google ASR Transcripter ===")
    registry = load_registry()
    
    # Escanear la carpeta pruebas/ por archivos .wav
    files_in_pruebas = os.listdir(PRUEBAS_DIR)
    wav_files = [f for f in files_in_pruebas if f.endswith(".wav")]
    
    registered_files = {case["fileName"] for case in registry}
    updated = False

    for wav_file in wav_files:
        if wav_file not in registered_files:
            filepath = os.path.join(PRUEBAS_DIR, wav_file)
            transcript = transcribe_audio_file(filepath)
            if transcript:
                case_id = clean_filename_to_id(wav_file)
                new_case = {
                    "id": case_id,
                    "fileName": wav_file,
                    "expectedTranscript": transcript,
                    "expectedCode": "" # Dejar en blanco para que el usuario defina
                }
                registry.append(new_case)
                registered_files.add(wav_file)
                updated = True
                print(f"[INFO] Agregado al dataset: {wav_file} (ID: {case_id})")

    if updated:
        save_registry(registry)
        print("[SAVE] Registro JSON de dataset actualizado.")
    else:
        print("No se encontraron nuevos archivos .wav para transcribir.")

    # Siempre regenerar el archivo TS para asegurar consistencia
    write_typescript_dataset(registry)

if __name__ == "__main__":
    main()
