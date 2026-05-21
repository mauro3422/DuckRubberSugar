import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
from typing import Iterable
from urllib.parse import urlparse

try:
    import speech_recognition as sr
except ImportError:
    print("Instalando SpeechRecognition mediante pip...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "SpeechRecognition"])
    import speech_recognition as sr


DEFAULT_PORT = 5500
PORT = int(os.environ.get("DUCKSUGAR_PORT", str(DEFAULT_PORT)))
AUTO_PORTS = os.environ.get("DUCKSUGAR_AUTO_PORTS", "5500,5501,5510")
LANGUAGE = os.environ.get("DUCKSUGAR_ASR_LANG", "es-AR")


class DuckSugarHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        if directory is None:
            directory = os.getcwd()
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format, *args):
        print(f"[DuckSugar] {self.address_string()} - {format % args}", flush=True)

    def do_OPTIONS(self):
        self.send_response(200, "OK")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(200, {
                "success": True,
                "service": "ducksugar",
                "asr": "google",
                "language": LANGUAGE,
                "port": self.server.server_address[1],
            })
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/transcribe":
            self.send_response(404)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0:
            self.send_json(400, {"success": False, "error": "Empty audio payload"})
            return

        audio_data = self.rfile.read(content_length)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_file.write(audio_data)
            temp_file_path = temp_file.name

        try:
            recognizer = sr.Recognizer()
            with sr.AudioFile(temp_file_path) as source:
                audio = recognizer.record(source)
            
            import concurrent.futures
            
            # Concurrently run es-AR and en-US ASR network calls in parallel threads
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                future_es = executor.submit(recognizer.recognize_google, audio, language="es-AR")
                future_en = executor.submit(recognizer.recognize_google, audio, language="en-US")
                
                try:
                    transcript_es = future_es.result()
                except Exception as err:
                    print(f"[DuckSugar] es-AR transcription failed: {err}", flush=True)
                    transcript_es = ""
                
                try:
                    transcript_en = future_en.result()
                except Exception as err:
                    print(f"[DuckSugar] en-US transcription failed: {err}", flush=True)
                    transcript_en = ""
            
            # Primary transcript defaults to Spanish if available, falling back to English
            primary_transcript = transcript_es if transcript_es else transcript_en
            
            self.send_json(200, {
                "success": True,
                "transcript": primary_transcript,
                "transcript_es": transcript_es,
                "transcript_en": transcript_en,
            })
        except Exception as error:
            self.send_json(200, {
                "success": False,
                "error": str(error),
                "errorType": type(error).__name__,
            })
        finally:
            try:
                os.remove(temp_file_path)
            except OSError:
                pass

    def send_json(self, status, response):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response, ensure_ascii=False).encode("utf-8"))


def candidate_ports() -> Iterable[int]:
    seen = set()
    for raw_port in [str(PORT), *AUTO_PORTS.split(",")]:
        try:
            port = int(raw_port.strip())
        except ValueError:
            continue
        if port in seen:
            continue
        seen.add(port)
        yield port


def run():
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    last_error = None
    for port in candidate_ports():
        try:
            with socketserver.ThreadingTCPServer(("127.0.0.1", port), DuckSugarHandler) as server:
                print(f"DuckSugar server: http://127.0.0.1:{port}/", flush=True)
                print(f"Google ASR endpoint: http://127.0.0.1:{port}/transcribe", flush=True)
                try:
                    server.serve_forever()
                except KeyboardInterrupt:
                    pass
                return
        except OSError as error:
            last_error = error
            print(f"Port {port} unavailable for DuckSugar ASR bridge: {error}", flush=True)

    raise RuntimeError(f"No available DuckSugar ASR bridge port. Last error: {last_error}")


if __name__ == "__main__":
    run()
