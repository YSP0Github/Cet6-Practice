from pathlib import Path
import re, os
p = Path('library-data.js')
t = p.read_text(encoding='utf-8')
entries = re.findall(r"\{[^}]*'name': '([^']*)', type: '([^']*)', path: '([^']*)'\}", t)
missing = []
base = Path('g:/CUG/四六级/六级真题+解析/六级真题练习系统')
for name, typ, pathstr in entries:
    if typ == '听力':
        full = base / Path(pathstr.replace('/', os.sep))
        if not full.exists():
            missing.append((name, pathstr, str(full)))
print('total audio:', sum(1 for e in entries if e[1] == '听力'))
print('missing:', len(missing))
for name, p, full in missing[:50]:
    print(name, p, full)
