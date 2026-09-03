from pathlib import Path

path = Path('.github/scripts/community-preview-visual-validation.sh')
text = path.read_text(encoding='utf-8')
old = "    const actions = Array.from(document.querySelectorAll('.community-post__action'));"
new = "    const actions = Array.from(document.querySelectorAll('button.community-post__action, a.community-post__action, .community-post__location-details > summary'));"
count = text.count(old)
if count != 2:
    raise SystemExit(f'expected two post action selector anchors, found {count}')
path.write_text(text.replace(old, new), encoding='utf-8')
print('Interactive target selector fixed.')
