"""Prueba de lectura de tickets (spec 003, T-14): lee fotos con RapidOCR, busca palabras clave y dibuja cajas.

Uso: python ocr_probe.py <carpeta_con_fotos> <carpeta_de_salida>
Solo lectura local: no envía nada a ningún servidor.
"""
import re
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
from rapidocr_onnxruntime import RapidOCR

# Palabras clave (en el producto vivirán en la KB, no aquí).
# Se evalúan sobre el texto SIN espacios: el OCR a veces los pierde ("$20 =102flamesx2").
# Tolerancias: "#" opcional, 0↔O y 1↔l/I dentro de las palabras.
RULES = [
    ("receipt", re.compile(r"^#?(\d{8})$|#(\d{8})|Number:?#?(\d{8})", re.I), (220, 38, 38)),
    ("flames", re.compile(r"\$?(\d+)=(\d+)f[l1I]ames?[xX](\d+)", re.I), (22, 163, 74)),
    ("park", re.compile(r"(?:KidsEmpire)?([A-Z]{1,2}-[A-Z][A-Za-z]+)$"), (37, 99, 235)),
    ("date", re.compile(r"(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?[A-Za-z0]+\d{1,2},?\d{4}"), (147, 51, 234)),
    ("receipt_label", re.compile(r"Receipt[A-Za-z]{0,2}N[uo]m?ber", re.I), (234, 88, 12)),
]


def main(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    engine = RapidOCR()
    font = ImageFont.load_default()
    for path in sorted(src.glob("*.jpg")):
        img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        t0 = time.time()
        result, _ = engine(img_to_array(img))
        secs = time.time() - t0
        result = result or []
        draw = ImageDraw.Draw(img)
        print(f"\n=== {path.name}  {img.size[0]}x{img.size[1]}  {len(result)} líneas  {secs:.1f}s")
        found = {}
        for box, text, score in result:
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            rect = (min(xs), min(ys), max(xs), max(ys))
            label = None
            for name, rx, color in RULES:
                m = rx.search(re.sub(r"\s+", "", text))
                if m:
                    found.setdefault(name, []).append((text.strip(), round(float(score), 2)))
                    draw.rectangle(rect, outline=color, width=4)
                    draw.text((rect[0], max(0, rect[1] - 12)), f"{name} {float(score):.2f}", fill=color, font=font)
                    label = name
                    break
            if label is None:
                draw.rectangle(rect, outline=(180, 180, 180), width=1)
        for name, hits in found.items():
            print(f"  {name:14} {hits}")
        for need in ("receipt", "flames", "park", "date"):
            if need not in found:
                print(f"  {need:14} NO ENCONTRADO")
        img.save(out / f"annotated_{path.name}")


def img_to_array(img):
    import numpy as np

    return np.array(img)[:, :, ::-1]  # RGB -> BGR (lo que espera OpenCV/RapidOCR)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
