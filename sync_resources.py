"""Synchronize CET6 resources from source archives into the local pdf/ and audio/ folders.

This script scans 【1】、【2】、【3】 source directories and copies recognized
真题、解析、听力 files into the current six-level practice system.

It uses a standardized target naming schema:
  pdf/YYYYMM_N.pdf
  pdf/YYYYMM_N_解析.pdf
  audio/YYYYMM_N.mp3

Run from the 六级真题练习系统 directory with:
  python sync_resources.py
"""

from __future__ import annotations

import re
from pathlib import Path
from shutil import copy2
from typing import Dict, List, Optional, Tuple

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
SRC_DIRS = [
    ROOT_DIR / '【1】2015-2024年12月六级真题+听力+答案合集',
    ROOT_DIR / '【2】2025年6月六级真题+解析+听力',
    ROOT_DIR / '【3】2025年12月六级真题+解析+听力（最新）',
]
PDF_DIR = BASE_DIR / 'pdf'
AUDIO_DIR = BASE_DIR / 'audio'
PDF_EXT = '.pdf'
AUDIO_EXTS = {'.mp3', '.m4a', '.wav', '.aac'}
IGNORE_AUDIO_PATTERNS = ('听力原文', '听力文本', '译文')
ANALYSIS_KEYWORDS = ('解析', '答案', '详解', '答案及', '答案解析', '答题')
EXAM_KEYWORDS = ('真题', '原题', '试题', 'question')
TRANSCRIPT_KEYWORDS = ('听力原文', '听力文本', '译文')
CHINESE_NUMERAL_MAP = {
    '一': 1,
    '二': 2,
    '两': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
    '十': 10,
}

YEAR_MONTH_PATTERN = re.compile(r'(20\d{2})[^\d]*(\d{1,2})')
SET_PATTERN = re.compile(r'第\s*([0-9一二三四五六七八九十]+)\s*套')
UNDERSCORE_SET_PATTERN = re.compile(r'_(\d)(?:_|\.|$)')


def parse_chinese_numeral(text: str) -> Optional[int]:
    if text.isdigit():
        return int(text)
    value = 0
    for char in text:
        if char in CHINESE_NUMERAL_MAP:
            value += CHINESE_NUMERAL_MAP[char]
    return value if value > 0 else None


def normalize_text(text: str) -> str:
    return text.replace('（', '(').replace('）', ')').replace(' ', '').replace('\u3000', '')


def extract_year_month(path: Path) -> Tuple[Optional[int], Optional[int]]:
    for candidate in [path.name] + [p.name for p in path.parents]:
        text = normalize_text(candidate)
        match = YEAR_MONTH_PATTERN.search(text)
        if match:
            year = int(match.group(1))
            month = int(match.group(2))
            if 1 <= month <= 12:
                return year, month
    return None, None


def extract_set_number(name: str) -> Optional[int]:
    text = normalize_text(name)
    match = SET_PATTERN.search(text)
    if match:
        return parse_chinese_numeral(match.group(1))
    match = UNDERSCORE_SET_PATTERN.search(text)
    if match:
        return int(match.group(1))
    digits = re.findall(r'([1-9])', text)
    if digits:
        # fallback: prefer first digit close to '第' or '套'
        if '第' in text and '套' in text:
            sequence = re.findall(r'第\s*([0-9一二三四五六七八九十]+)\s*套', text)
            if sequence:
                return parse_chinese_numeral(sequence[0])
        return int(digits[0])
    return None


def classify_pdf(path: Path) -> Optional[str]:
    name = path.name
    lower = name.lower()
    if any(keyword in lower for keyword in map(str.lower, TRANSCRIPT_KEYWORDS)):
        return None
    if any(keyword in lower for keyword in map(str.lower, ANALYSIS_KEYWORDS)):
        return 'analysis'
    if any(keyword in lower for keyword in map(str.lower, EXAM_KEYWORDS)):
        return 'exam'
    parent = path.parent.name
    if '解析' in parent or '答案' in parent:
        return 'analysis'
    if '真题' in parent or '题' in parent:
        return 'exam'
    return None


def classify_audio(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_EXTS


def target_pdf_name(year: int, month: int, set_number: int, kind: str) -> str:
    base = f'{year}{month:02d}_{set_number}'
    return f'{base}_解析.pdf' if kind == 'analysis' else f'{base}.pdf'


def target_audio_name(year: int, month: int, set_number: int, ext: str) -> str:
    return f'{year}{month:02d}_{set_number}{ext}'


def collect_source_files() -> Tuple[Dict[Tuple[int,int,int,str], Path], List[str]]:
    mapping: Dict[Tuple[int,int,int,str], Path] = {}
    warnings: List[str] = []
    for src_root in SRC_DIRS:
        if not src_root.exists():
            warnings.append(f'source missing: {src_root}')
            continue
        for path in sorted(src_root.rglob('*')):
            if not path.is_file():
                continue
            ext = path.suffix.lower()
            if ext == '.docx':
                continue
            year, month = extract_year_month(path)
            if year is None or month is None:
                warnings.append(f'cannot parse year/month from {path}')
                continue
            set_number = extract_set_number(path.name)
            if set_number is None:
                # try folder parent names
                set_number = extract_set_number(path.parent.name)
            if set_number is None:
                warnings.append(f'cannot parse set from {path}')
                continue
            if ext == PDF_EXT:
                kind = classify_pdf(path)
                if kind is None:
                    warnings.append(f'ignore unknown pdf type: {path}')
                    continue
            elif ext in AUDIO_EXTS:
                kind = 'audio'
            else:
                warnings.append(f'ignore unsupported file type: {path}')
                continue
            key = (year, month, set_number, kind)
            existing = mapping.get(key)
            if existing is not None:
                warnings.append(f'duplicate mapping for {key}: {existing} and {path}')
            mapping[key] = path
    return mapping, warnings


def apply_mapping(mapping: Dict[Tuple[int,int,int,str], Path]) -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    target_files = set()
    copied = []
    for (year, month, set_number, kind), src in sorted(mapping.items()):
        if kind == 'audio':
            dst = AUDIO_DIR / target_audio_name(year, month, set_number, src.suffix.lower())
        else:
            dst = PDF_DIR / target_pdf_name(year, month, set_number, kind)
        copy2(src, dst)
        target_files.add(dst.name)
        copied.append((src, dst))

    # Clean old/misnamed files in target folders
    pdf_pattern = re.compile(r'^\d{6}_[1-9](?:_解析)?\.pdf$')
    audio_pattern = re.compile(r'^\d{6}_[1-9]\.(mp3|m4a|wav|aac)$', re.IGNORECASE)
    removed = []
    for folder, pattern in ((PDF_DIR, pdf_pattern), (AUDIO_DIR, audio_pattern)):
        for path in sorted(folder.glob('*')):
            if path.name not in target_files and pattern.match(path.name):
                path.unlink()
                removed.append(path)

    print(f'Copied {len(copied)} files:')
    for src, dst in copied:
        print(f'  {src.relative_to(ROOT_DIR)} -> {dst.relative_to(ROOT_DIR)}')
    if removed:
        print(f'\nRemoved {len(removed)} stale target files:')
        for path in removed:
            print(f'  {path.relative_to(ROOT_DIR)}')


def main() -> None:
    mapping, warnings = collect_source_files()
    print(f'Found {len(mapping)} mapped source files.')
    if warnings:
        print('\nWarnings:')
        for warning in warnings:
            print('  -', warning)
    apply_mapping(mapping)
    print('\nDone. Please run generate_manifest.py again to refresh library-data.json if needed.')


if __name__ == '__main__':
    main()
