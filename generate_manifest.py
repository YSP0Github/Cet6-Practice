"""
扫描当前“六级真题练习系统”目录下的本地资源文件夹（pdf/ 和 audio/），生成供网页直接读取的 library-data.json / library-data.js。

使用方式：
  1. 将要发布的 PDF 和音频文件放入本目录下的 pdf/ 和 audio/。
  2. 运行 python generate_manifest.py。
  3. 生成的 library-data.js 会被 index.html 与 preview.html 自动读取，无需再手动修改 app.js。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Dict, List, Tuple

BASE_DIR = Path(__file__).resolve().parent
PDF_DIR = BASE_DIR / 'pdf'
AUDIO_DIR = BASE_DIR / 'audio'
OUTPUT_JSON = BASE_DIR / 'library-data.json'
OUTPUT_JS = BASE_DIR / 'library-data.js'

PDF_EXT = '.pdf'
AUDIO_EXTS = {'.mp3', '.m4a', '.wav', '.aac'}
SUPPORTED_EXTS = {PDF_EXT, *AUDIO_EXTS}
EXCLUDE_DIRS = {
    BASE_DIR.name,
    '.vscode',
    'cet6-practice',
    '__pycache__'
}
AGGREGATE_KEYWORDS = ('合集', '总汇', '打包', '大全')
YEAR_MONTH_PATTERN = re.compile(r'(20\d{2})[^\d]{0,3}(\d{1,2})')
YEAR_PATTERN = re.compile(r'(20\d{2})')
TITLE_BRACKET_PATTERN = re.compile(r'^[\[{(（【]\s*\d+\s*[\]})）】]\s*')
TITLE_INDEX_PATTERN = re.compile(r'^\d+\s*[、.．:：-]\s*')
TYPE_PRIORITY = {'真题': 0, '解析': 1, '听力': 2}
ANALYSIS_KEYWORDS = ('解析', '答案', '讲解', '详解', '讲评', '讲义', '评析', '答案详解', '答题卡')
ATTACHMENT_KEYWORDS = ('译文', '听力原文', '听力文本', 'word', 'Word', '范文', '作文', '说明', '文本', '讲稿', '抄写', '速记')
ASSET_PDF_PATTERN = re.compile(r'^(20\d{2})(\d{2})_(\d)(?:_(解析))?\.pdf$', re.IGNORECASE)
ASSET_AUDIO_PATTERN = re.compile(r'^(20\d{2})(\d{2})_(\d)\.(mp3|m4a|wav|aac)$', re.IGNORECASE)


def to_posix(path: Path) -> str:
    return Path(os.path.relpath(path, BASE_DIR)).as_posix()


def should_skip(directory: Path) -> bool:
    name = directory.name
    if name in EXCLUDE_DIRS:
        return True
    if name.startswith('.') or name.startswith('__'):
        return True
    return False


def extract_year_month(text: str) -> Tuple[int, int]:
    match = YEAR_MONTH_PATTERN.search(text)
    if match:
        year = int(match.group(1))
        month = int(match.group(2)) if match.group(2) else 0
        return year, month
    year_match = YEAR_PATTERN.search(text)
    if year_match:
        return int(year_match.group(1)), 0
    return 0, 0


def classify_resource(path: Path) -> str:
    ext = path.suffix.lower()
    name = path.name
    if ext in AUDIO_EXTS:
        return '听力'
    if any(keyword in name for keyword in ANALYSIS_KEYWORDS):
        return '解析'
    if any(keyword in name for keyword in ATTACHMENT_KEYWORDS):
        return '附录'
    return '真题'


def collect_resources(folder: Path) -> List[dict]:
    resources: List[dict] = []
    for path in sorted(folder.rglob('*')):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext not in SUPPORTED_EXTS:
            continue
        resources.append({
            'name': path.name,
            'type': classify_resource(path),
            'path': to_posix(path)
        })
    resources.sort(key=lambda item: (TYPE_PRIORITY.get(item['type'], 3), item['name']))
    return resources


def has_single_year(folder: Path) -> bool:
    years = YEAR_PATTERN.findall(folder.name)
    return len(years) == 1


def looks_aggregate(folder: Path) -> bool:
    name = folder.name
    return any(keyword in name for keyword in AGGREGATE_KEYWORDS)


def normalize_title(name: str) -> str:
    title = name.strip()
    prev = None
    while prev != title:
        prev = title
        title = TITLE_BRACKET_PATTERN.sub('', title)
        title = TITLE_INDEX_PATTERN.sub('', title)
    title = title.strip(' -_·•')
    return title or name


def discover_entry_folders() -> List[Path]:
    entries: List[Path] = []

    def walk(current: Path) -> bool:
        if not current.is_dir() or should_skip(current):
            return False
        if has_single_year(current) and not looks_aggregate(current):
            entries.append(current)
            return True
        produced = False
        for child in sorted(current.iterdir()):
            if child.is_dir():
                produced = walk(child) or produced
        if not produced:
            if any(p.suffix.lower() == PDF_EXT for p in current.rglob('*') if p.is_file()):
                entries.append(current)
                return True
        return produced

    for top in sorted(BASE_DIR.iterdir()):
        if should_skip(top) or not top.is_dir():
            continue
        walk(top)
    return entries


def build_raw_entries() -> List[dict]:
    entries = []
    for folder in discover_entry_folders():
        resources = collect_resources(folder)
        if not resources or not any(item['path'].lower().endswith(PDF_EXT) for item in resources):
            continue
        year, month = extract_year_month(folder.name)
        tags = []
        if any(item['type'] == '真题' for item in resources):
            tags.append('真题')
        if any(item['type'] == '解析' for item in resources):
            tags.append('解析')
        if any(item['type'] == '听力' for item in resources):
            tags.append('听力')
        entry = {
            'year': str(year) if year else folder.name,
            'month': month,
            'title': normalize_title(folder.name),
            'rawTitle': folder.name,
            'tags': tags or ['真题'],
            'resources': resources,
            '_sort': year * 100 + month
        }
        entries.append(entry)
    entries.sort(key=lambda item: (item['_sort'], item['title']), reverse=True)
    for entry in entries:
        entry.pop('_sort', None)
    return entries


def build_asset_entries() -> List[dict]:
    pdf_dir = PDF_DIR
    if not pdf_dir.exists():
        return []
    entry_map: Dict[Tuple[int, int], dict] = {}

    def ensure_entry(year: int, month: int) -> dict:
        key = (year, month)
        if key not in entry_map:
            title = f'{year}年{str(month).zfill(2)}月CET6真题+解析+听力'
            entry_map[key] = {
                'year': str(year),
                'month': month,
                'title': title,
                'rawTitle': title,
                'tags': set(),
                'resources': [],
                '_sort': year * 100 + month
            }
        return entry_map[key]

    for pdf_path in sorted(pdf_dir.glob('*.pdf')):
        match = ASSET_PDF_PATTERN.match(pdf_path.name)
        if not match:
            continue
        year = int(match.group(1))
        month = int(match.group(2))
        set_index = int(match.group(3))
        is_analysis = bool(match.group(4))
        entry = ensure_entry(year, month)
        entry['tags'].add('解析' if is_analysis else '真题')
        entry['resources'].append({
            'name': pdf_path.name,
            'type': '解析' if is_analysis else '真题',
            'path': to_posix(pdf_path),
            'set': set_index
        })

    audio_dir = AUDIO_DIR
    if audio_dir.exists():
        for audio_path in sorted(audio_dir.iterdir()):
            if not audio_path.is_file():
                continue
            match = ASSET_AUDIO_PATTERN.match(audio_path.name)
            if not match:
                continue
            year = int(match.group(1))
            month = int(match.group(2))
            set_index = int(match.group(3))
            entry = ensure_entry(year, month)
            entry['tags'].add('听力')
            entry['resources'].append({
                'name': audio_path.name,
                'type': '听力',
                'path': to_posix(audio_path),
                'set': set_index
            })

    entries = []
    for entry in entry_map.values():
        entry['resources'].sort(key=lambda item: (TYPE_PRIORITY.get(item['type'], 3), item.get('set', 0), item['name']))
        for resource in entry['resources']:
            resource.pop('set', None)
        ordered_tags = []
        for candidate in ('真题', '解析', '听力'):
            if candidate in entry['tags']:
                ordered_tags.append(candidate)
        entry['tags'] = ordered_tags or ['真题']
        entries.append(entry)
    entries.sort(key=lambda item: item['_sort'], reverse=True)
    for entry in entries:
        entry.pop('_sort', None)
    return entries


def entry_key(entry: dict) -> Tuple[str, int, str]:
    year = entry.get('year')
    month = entry.get('month')
    if isinstance(month, int) and month > 0:
        return (year, month, '')
    return (year, 0, entry.get('title', year))


def merge_entries(primary: List[dict], secondary: List[dict]) -> List[dict]:
    merged: Dict[Tuple[str, int, str], dict] = {}

    def add(entry: dict):
        key = entry_key(entry)
        existing = merged.get(key)
        if not existing:
            merged[key] = entry
            return
        existing_paths = {res['path'] for res in existing['resources']}
        for resource in entry['resources']:
            if resource['path'] not in existing_paths:
                existing['resources'].append(resource)
                existing_paths.add(resource['path'])
        combined_tags = existing['tags'] + entry['tags']
        ordered = []
        for tag in ('真题', '解析', '听力', '附录'):
            if tag in combined_tags and tag not in ordered:
                ordered.append(tag)
        existing['tags'] = ordered or ['真题']

    for entry in primary:
        add(entry)
    for entry in secondary:
        add(entry)

    def sort_key(entry: dict) -> Tuple[int, str]:
        year_str = entry.get('year', '')
        year_num = int(year_str) if isinstance(year_str, str) and year_str.isdigit() else 0
        month_val = entry.get('month')
        month_num = month_val if isinstance(month_val, int) else 0
        return (year_num * 100 + month_num, entry.get('title', ''))

    result = list(merged.values())
    result.sort(key=sort_key, reverse=True)
    return result


def write_outputs(entries: List[dict]) -> None:
    json_text = json.dumps(entries, ensure_ascii=False, indent=2)
    OUTPUT_JSON.write_text(json_text + '\n', encoding='utf-8')
    OUTPUT_JS.write_text(f'window.libraryData = {json_text};\n', encoding='utf-8')
    print(f'Generated {len(entries)} entries -> {OUTPUT_JSON.name} / {OUTPUT_JS.name}')


def main() -> None:
    entries = build_asset_entries()
    write_outputs(entries)


if __name__ == '__main__':
    main()
