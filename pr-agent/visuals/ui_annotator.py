"""
T1-5: UIスクリーンショット アノテーション & マスキングツール

主な関数:
  add_arrow(image, point, label)  -- 赤矢印＋ラベルを合成
  mask_region(image, bbox)        -- 指定領域を黒塗り（PII保護）

CLI:
  uv run python -m visuals.ui_annotator --batch-test
    → visuals/raw/manual/ の12枚を処理して /tmp/annotated/ に出力

マスク座標の調整方法:
  MASK_REGIONS の bbox は (x1, y1, x2, y2) の相対比率 (0.0〜1.0)。
  --batch-test 実行後に /tmp/annotated/ を目視し、黒塗り位置がずれていれば調整する。
"""

import argparse
import sys
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont

# ============================================================
# PII マスク定義
# bbox: (x1, y1, x2, y2) — 画像幅・高さに対する相対比率 0.0〜1.0
# ============================================================
MASK_REGIONS: dict[int, list[tuple[float, float, float, float]]] = {
    # Image 4: AGENT版価格（¥30,000〜¥250,000）
    # 価格数値が並ぶ帯を黒塗り（中央帯・縦方向 30〜70%）
    4: [
        (0.10, 0.30, 0.90, 0.72),
    ],
    # Image 9: 取引先マスタ（ゴディバ、ローソン等の店名列）
    # 店名が並ぶ左〜中央列を黒塗り
    9: [
        (0.00, 0.08, 0.55, 0.95),
    ],
    # Image 2: 会計ソフト選択UI（弥生/freee/マネフォ）
    # ドロップダウン選択肢全体を黒塗り
    2: [
        (0.05, 0.25, 0.95, 0.75),
    ],
}


# ============================================================
# コアユーティリティ関数
# ============================================================

def add_arrow(
    image: Image.Image,
    point: tuple[int, int],
    label: str,
    color: str = "red",
    font_size: int = 24,
) -> Image.Image:
    """
    image の point 座標に矢印（▶）と label テキストを描画して返す。

    Args:
        image: PIL Image オブジェクト
        point: (x, y) — 矢印の先端座標（ピクセル）
        label: ラベル文字列
        color: 矢印・テキスト色
        font_size: フォントサイズ（px）
    """
    img = image.copy()
    draw = ImageDraw.Draw(img)

    x, y = point
    arrow_len = 40

    # 矢印ライン（左から右に向かって先端が point）
    draw.line([(x - arrow_len, y), (x, y)], fill=color, width=4)
    # 矢印頭部（三角）
    draw.polygon(
        [(x, y - 8), (x, y + 8), (x + 16, y)],
        fill=color,
    )

    # ラベル背景
    try:
        font = ImageFont.truetype("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc", font_size)
    except OSError:
        font = ImageFont.load_default()

    bbox = draw.textbbox((x + 20, y - font_size // 2), label, font=font)
    draw.rectangle(
        [bbox[0] - 4, bbox[1] - 2, bbox[2] + 4, bbox[3] + 2],
        fill="white",
        outline=color,
        width=2,
    )
    draw.text((x + 20, y - font_size // 2), label, fill=color, font=font)

    return img


def mask_region(
    image: Image.Image,
    bbox: tuple[float, float, float, float],
    mode: str = "fill",
) -> Image.Image:
    """
    image の bbox 領域をマスクして返す。

    Args:
        image: PIL Image オブジェクト
        bbox: (x1, y1, x2, y2) — 0.0〜1.0 の相対比率
        mode: "fill"（黒塗り）または "blur"（ぼかし）
    """
    img = image.copy().convert("RGBA")
    w, h = img.size
    x1 = int(bbox[0] * w)
    y1 = int(bbox[1] * h)
    x2 = int(bbox[2] * w)
    y2 = int(bbox[3] * h)

    if mode == "blur":
        from PIL import ImageFilter
        region = img.crop((x1, y1, x2, y2))
        blurred = region.filter(ImageFilter.GaussianBlur(radius=20))
        img.paste(blurred, (x1, y1))
    else:
        draw = ImageDraw.Draw(img)
        draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0, 255))

    return img.convert("RGB")


def add_border(image: Image.Image, label: str, color: str = "red") -> Image.Image:
    """画像全体に色枠＋ラベルを追加（batch-test 用の確認マーカー）"""
    img = image.copy().convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = img.size
    border = 6
    draw.rectangle([0, 0, w - 1, h - 1], outline=color, width=border)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc", 28)
    except OSError:
        font = ImageFont.load_default()

    bbox = draw.textbbox((border + 4, border + 4), label, font=font)
    draw.rectangle(
        [bbox[0] - 4, bbox[1] - 2, bbox[2] + 4, bbox[3] + 2],
        fill="white",
    )
    draw.text((border + 4, border + 4), label, fill=color, font=font)
    return img


# ============================================================
# batch-test
# ============================================================

RAW_DIR = Path(__file__).parent / "raw" / "manual"
OUT_DIR = Path("/tmp/annotated")


def batch_test() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(RAW_DIR.glob("0*.png")) + sorted(RAW_DIR.glob("0*.jpg"))
    files = sorted(set(files), key=lambda p: p.name)

    if not files:
        print(f"ERROR: {RAW_DIR} に画像ファイルが見つかりません。")
        sys.exit(1)

    print(f"[ui_annotator] 入力: {RAW_DIR}")
    print(f"[ui_annotator] 出力: {OUT_DIR}")
    print(f"[ui_annotator] 対象: {len(files)} 枚\n")

    for f in files:
        # index を filename の先頭3桁から取得
        try:
            index = int(f.name[:3])
        except ValueError:
            index = 0

        img = Image.open(f).convert("RGB")
        label = f"[{index:02d}] {f.stem}"

        # PII マスク
        if index in MASK_REGIONS:
            for bbox in MASK_REGIONS[index]:
                img = mask_region(img, bbox)
            label += " ⚠️MASKED"

        # 確認用ボーダー＋ラベル
        img = add_border(img, label)

        out_path = OUT_DIR / f"{f.stem}_annotated.png"
        img.save(out_path)
        masked_mark = " ← ⚠️ PII マスク適用" if index in MASK_REGIONS else ""
        print(f"  [{index:02d}] → {out_path.name}{masked_mark}")

    print(f"\n[ui_annotator] 完了。目視確認: open {OUT_DIR}")


# ============================================================
# CLI
# ============================================================

def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="shiwake-ai UI アノテーター")
    parser.add_argument(
        "--batch-test",
        action="store_true",
        help=f"12枚を処理して {OUT_DIR} に出力",
    )
    args = parser.parse_args(argv)

    if args.batch_test:
        batch_test()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
