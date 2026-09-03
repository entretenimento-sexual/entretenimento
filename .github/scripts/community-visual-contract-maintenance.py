from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {text.count(old)}\nANCHOR:\n{old}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


harness = Path('.github/visual-harness/community-preview-visual.app-component.ts')
replace_once(
    harness,
    "      text: 'Quem anima combinar alguma coisa tranquila no fim de semana? Podemos decidir pelo grupo.',\n      image: null,\n      location: null,\n      replyTo: null,",
    "      text: 'Quem anima combinar alguma coisa tranquila no fim de semana? Podemos decidir pelo grupo.',\n      image: null,\n      location: null,\n      replyTo: {\n        postId: 'visual-community-reference-post',\n        authorLabel: 'Clara',\n        textPreview: 'Podemos começar por um café mais tranquilo e decidir o restante pelo grupo.',\n        available: true,\n      },",
)

script = Path('.github/scripts/community-preview-visual-validation.sh')
replace_once(
    script,
    "    const railRect = rail?.getBoundingClientRect();\n    const primaryRect = primary?.getBoundingClientRect();\n    const bodyRect = body?.getBoundingClientRect();\n    return {",
    "    const railRect = rail?.getBoundingClientRect();\n    const primaryRect = primary?.getBoundingClientRect();\n    const bodyRect = body?.getBoundingClientRect();\n    const cover = document.querySelector('.community-preview__cover');\n    const title = document.querySelector('.community-preview h1');\n    const actions = Array.from(document.querySelectorAll('.community-post__action'));\n    return {",
)
replace_once(
    script,
    "      bodyWidth: bodyRect?.width ?? 0,\n      railHasAbout:",
    "      bodyWidth: bodyRect?.width ?? 0,\n      coverHeight: cover?.getBoundingClientRect().height ?? 0,\n      titleFontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,\n      minPostActionHeight: actions.length\n        ? Math.min(...actions.map((action) => action.getBoundingClientRect().height))\n        : 0,\n      locationCount: document.querySelectorAll('.community-post__location').length,\n      replyContextCount: document.querySelectorAll('.community-post__reply-context').length,\n      railHasAbout:",
)
replace_once(
    script,
    "    || metrics.bodyWidth <= metrics.primaryWidth\n    || !metrics.railHasAbout",
    "    || metrics.bodyWidth <= metrics.primaryWidth\n    || metrics.coverHeight < 120\n    || metrics.titleFontSize < 20\n    || metrics.minPostActionHeight < 44\n    || metrics.locationCount !== 1\n    || metrics.replyContextCount !== 1\n    || !metrics.railHasAbout",
)
replace_once(
    script,
    "    const rail = document.querySelector('.community-preview__rail');\n    return {",
    "    const rail = document.querySelector('.community-preview__rail');\n    const cover = document.querySelector('.community-preview__cover');\n    const actions = Array.from(document.querySelectorAll('.community-post__action'));\n    return {",
)
replace_once(
    script,
    "      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none'),\n    };",
    "      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none'),\n      coverHeight: cover?.getBoundingClientRect().height ?? 0,\n      minPostActionHeight: actions.length\n        ? Math.min(...actions.map((action) => action.getBoundingClientRect().height))\n        : 0,\n      locationCount: document.querySelectorAll('.community-post__location').length,\n      replyContextCount: document.querySelectorAll('.community-post__reply-context').length,\n    };",
)
replace_once(
    script,
    "    || metrics.railCount !== 1\n    || metrics.railVisible\n  ) {",
    "    || metrics.railCount !== 1\n    || metrics.railVisible\n    || metrics.coverHeight < 100\n    || metrics.minPostActionHeight < 44\n    || metrics.locationCount !== 1\n    || metrics.replyContextCount !== 1\n  ) {",
)

print('Community visual contract coverage applied.')
