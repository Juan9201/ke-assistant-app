"""Lee una foto con RapidOCR y entrega JSON (spec 003). Sin red.

Uso:  python ocr_read.py [--scale K] < foto.jpg      (la imagen llega por entrada estándar)
      python ocr_read.py [--scale K] foto.jpg        (o como archivo, para pruebas)
--scale K amplía la foto K veces (Lanczos) antes de leerla, para fotos chicas o dudosas; las cajas de la
salida SIEMPRE vuelven a las coordenadas de la foto original.
Salida (stdout): {"width":W,"height":H,"scale":K,"ms":N,"lines":[{"text":"...","score":0.97,"box":[[x,y],[x,y],[x,y],[x,y]]}]}
La imagen nunca se guarda en disco.
La salida es ASCII puro (los caracteres raros salen escapados): en Windows la consola no siempre es UTF-8.
"""
import io
import json
import sys
import time

import numpy as np
from PIL import Image, ImageOps
from rapidocr_onnxruntime import RapidOCR


def parse_args(argv):
    scale = 1.0
    path = None
    i = 0
    while i < len(argv):
        if argv[i] == "--scale" and i + 1 < len(argv):
            scale = max(1.0, min(float(argv[i + 1]), 6.0))
            i += 2
        else:
            path = argv[i]
            i += 1
    return scale, path


def main() -> None:
    scale, path = parse_args(sys.argv[1:])
    data = open(path, "rb").read() if path else sys.stdin.buffer.read()
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    width, height = img.size
    work = img if scale == 1.0 else img.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
    t0 = time.time()
    result, _ = RapidOCR()(np.array(work)[:, :, ::-1])  # RGB -> BGR
    lines = [
        {
            "text": str(text),
            "score": round(float(score), 3),
            "box": [[int(round(p[0] / scale)), int(round(p[1] / scale))] for p in box],
        }
        for box, text, score in (result or [])
    ]
    print(json.dumps({"width": width, "height": height, "scale": scale, "ms": int((time.time() - t0) * 1000), "lines": lines}, ensure_ascii=True))


if __name__ == "__main__":
    main()
