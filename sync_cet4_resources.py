"""Synchronize CET-4 resources from source archives into pdf/cet4/ and audio/cet4/.

Run from the 六级真题练习系统 directory with:
  python sync_cet4_resources.py
"""

from __future__ import annotations

import re
from pathlib import Path
from shutil import copy2
from typing import Dict, List, Optional, Tuple

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
SRC_DIR = ROOT_DIR / '2021-2025四级真题'
PDF_DIR = BASE_DIR / 'pdf' / 'cet4'
AUDIO_DIR = BASE_DIR / 'audio' / 'cet4'
PDF_EXT = '.pdf'
AUDIO_EXTS = {'.mp3', '.m4a', '.wav', '.aac'}
SKIP_KEYWORDS = ('听力原文', '听力文本', '译文', '说明书', '提示')
ANALYSIS_KEYWORDS = ('解析', '答案', '详解', '答案及', '答案解析', '答题')
EXAM_KEYWORDS = ('真题', '原题', '试题', '原卷')
CHINESE_NUMERAL_MAP = {
    '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
}
YEAR_MONTH_PATTERN = re.compile(r'(20\d{2})[^\d]*(\d{1,2})')
SET_PATTERN = re.compile(r'第\s*([0-9一二三四五六七八九十]+)\s*套')


def parse_chinese_numeral(text: str) -> Optional[int]:
    if text.isdigit():
        return int(text)
    value = 0
    for char in text:
        if char in CHINESE_NUMERAL_MAP:
            value += CHINESE_NUMERAL_MAP[char]
    return value if value > 0 else None


def normalize_text(text: str) -> str:
    return text.replace('（', '(').replace('）', ')').replace(' ', '').replace('　', '')


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
    # Try patterns like "全1套" or "全3套"
    aggregate = re.search(r'全(\d)套', text)
    if aggregate:
        return None  # aggregate files handled separately
    # Single-set indicator: "全1套" means only 1 set exists
    single = re.search(r'全(\d)套', text)
    if single and int(single.group(1)) == 1:
        return 1
    return None


def classify_pdf(path: Path) -> Optional[str]:
    name = path.name
    lower = name.lower()
    if any(kw in lower for kw in SKIP_KEYWORDS):
        return None
    if any(kw in lower for kw in ANALYSIS_KEYWORDS):
        return 'analysis'
    if any(kw in lower for kw in EXAM_KEYWORDS):
        return 'exam'
    parent = path.parent.name
    if '解析' in parent or '答案' in parent:
        return 'analysis'
    if '真题' in parent or '原题' in parent or '原卷' in parent:
        return 'exam'
    return None


def classify_audio(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_EXTS


def target_pdf_name(year: int, month: int, set_number: int, kind: str) -> str:
    base = f'{year}{month:02d}_{set_number}'
    return f'{base}_解析.pdf' if kind == 'analysis' else f'{base}.pdf'


def target_audio_name(year: int, month: int, set_number: int, ext: str) -> str:
    return f'{year}{month:02d}_{set_number}{ext}'


def collect_source_files() -> Tuple[Dict[Tuple[int, int, int, str], Path], List[str]]:
    mapping: Dict[Tuple[int, int, int, str], Path] = {}
    warnings: List[str] = []
    if not SRC_DIR.exists():
        warnings.append(f'source missing: {SRC_DIR}')
        return mapping, warnings

    # First pass: collect all candidate files
    candidates: List[Tuple[Path, int, int, Optional[int], str]] = []
    for path in sorted(SRC_DIR.rglob('*')):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext not in AUDIO_EXTS and ext != PDF_EXT:
            continue
        if any(kw in path.name for kw in SKIP_KEYWORDS):
            continue
        if ext == '.txt':
            continue

        year, month = extract_year_month(path)
        if year is None or month is None:
            warnings.append(f'cannot parse year/month: {path.name}')
            continue

        set_number = extract_set_number(path.name)
        if set_number is None:
            set_number = extract_set_number(path.parent.name)

        if ext == PDF_EXT:
            kind = classify_pdf(path)
            if kind is None:
                warnings.append(f'ignore pdf: {path.name}')
                continue
            if set_number is None and '3套' in path.name:
                set_number = 1
            if set_number is None:
                parent_set = re.search(r'第(\d)套', path.parent.name)
                if parent_set:
                    set_number = int(parent_set.group(1))
        elif ext in AUDIO_EXTS:
            kind = 'audio'
            if set_number is None:
                num_match = re.search(r'第(\d)套', path.name)
                if num_match:
                    set_number = int(num_match.group(1))
                elif '全1套' in path.name or '全一套' in path.name:
                    set_number = 1
                else:
                    num_match = re.search(r'音频(\d)', path.name)
                    if num_match:
                        set_number = int(num_match.group(1))
        else:
            continue

        candidates.append((path, year, month, set_number, kind))

    # For any file lacking a set number, assign set 1 (combined/session-level files)
    for i, (path, year, month, sn, kind) in enumerate(candidates):
        if sn is None:
            candidates[i] = (path, year, month, 1, kind)

    # Second pass: build mapping with dedup
    for path, year, month, set_number, kind in candidates:
        if set_number is None:
            warnings.append(f'cannot parse set: {path.name}')
            continue
        key = (year, month, set_number, kind)
        existing = mapping.get(key)
        if existing is not None:
            if path.parent == SRC_DIR and existing.parent != SRC_DIR:
                mapping[key] = path
            else:
                warnings.append(f'duplicate: {path.name} (kept {mapping[key].name})')
        else:
            mapping[key] = path

    return mapping, warnings


def apply_mapping(mapping: Dict[Tuple[int, int, int, str], Path]) -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    target_names = set()
    copied = []
    for (year, month, set_number, kind), src in sorted(mapping.items()):
        if kind == 'audio':
            dst = AUDIO_DIR / target_audio_name(year, month, set_number, src.suffix.lower())
        else:
            dst = PDF_DIR / target_pdf_name(year, month, set_number, kind)
        copy2(src, dst)
        target_names.add(dst.name)
        copied.append((src, dst))

    # Remove stale files
    pdf_pattern = re.compile(r'^\d{6}_[1-9](?:_解析)?\.pdf$')
    audio_pattern = re.compile(r'^\d{6}_[1-9]\.(mp3|m4a|wav|aac)$', re.IGNORECASE)
    removed = []
    for folder, pattern in ((PDF_DIR, pdf_pattern), (AUDIO_DIR, audio_pattern)):
        for path in sorted(folder.glob('*')):
            if path.name not in target_names and pattern.match(path.name):
                path.unlink()
                removed.append(path)

    print(f'Copied {len(copied)} files:')
    for src, dst in copied:
        print(f'  {src.name} -> {dst.relative_to(BASE_DIR)}')
    if removed:
        print(f'\nRemoved {len(removed)} stale files:')
        for path in removed:
            print(f'  {path.relative_to(BASE_DIR)}')


def main() -> None:
    mapping, warnings = collect_source_files()
    print(f'Found {len(mapping)} source files.')
    if warnings:
        print(f'\nWarnings ({len(warnings)}):')
        for w in warnings:
            print(f'  - {w}')
    apply_mapping(mapping)
    print('\nDone. Run generate_manifest.py to refresh library-data.json.')


if __name__ == '__main__':
    main()
