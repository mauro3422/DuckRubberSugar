import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

try:
    import speech_recognition as sr
except ImportError:
    print("Instalando SpeechRecognition mediante pip...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "SpeechRecognition"])
    import speech_recognition as sr


PORT = int(os.environ.get("DUCKSUGAR_PORT", "5500"))
LANGUAGE = os.environ.get("DUCKSUGAR_ASR_LANG", "es-AR")


class DuckSugarHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[DuckSugar] {self.address_string()} - {format % args}")

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
            transcript = recognizer.recognize_google(audio, language=LANGUAGE)
            self.send_json(200, {"success": True, "transcript": transcript})
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


def run():
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), DuckSugarHandler) as server:
        print(f"DuckSugar server: http://127.0.0.1:{PORT}/")
        print(f"Google ASR endpoint: http://127.0.0.1:{PORT}/transcribe")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    run()
