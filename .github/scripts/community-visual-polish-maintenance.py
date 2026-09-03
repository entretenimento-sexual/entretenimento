from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {text.count(old)}\nANCHOR:\n{old}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


preview = Path('src/app/community/preview/community-preview-page.component.css')
replace_once(preview, '  width: min(100%, 68rem);', '  width: min(100%, 72rem);')
replace_once(
    preview,
    '  height: clamp(5rem, 14vw, 7.25rem);',
    '  height: clamp(6.75rem, 15vw, 9rem);',
)
replace_once(
    preview,
    '  gap: 0.7rem;\n  padding: 0 0.9rem 0.55rem;',
    '  gap: 0.82rem;\n  padding: 0 1.05rem 0.8rem;',
)
replace_once(
    preview,
    '  width: clamp(3.55rem, 10vw, 4.4rem);\n  height: clamp(3.55rem, 10vw, 4.4rem);',
    '  width: clamp(4rem, 10vw, 5.1rem);\n  height: clamp(4rem, 10vw, 5.1rem);',
)
replace_once(
    preview,
    '  margin-top: clamp(-2.2rem, -4vw, -1.75rem);',
    '  margin-top: clamp(-2.65rem, -5vw, -2.05rem);',
)
replace_once(preview, '  font-size: 0.64rem;\n  font-weight: 700;', '  font-size: 0.7rem;\n  font-weight: 740;')
replace_once(
    preview,
    '  font-size: clamp(1.18rem, 3vw, 1.5rem);\n  font-weight: 760;',
    '  font-size: clamp(1.3rem, 3vw, 1.68rem);\n  font-weight: 780;',
)
replace_once(
    preview,
    '  gap: 0.3rem 0.75rem;\n  margin-top: 0.22rem;',
    '  gap: 0.38rem 0.9rem;\n  margin-top: 0.28rem;',
)
replace_once(
    preview,
    "  min-height: 2.75rem;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 0.42rem;\n  padding: 0.45rem 0.4rem;\n  border: 0;\n  background: transparent;\n  color: var(--text-color, #222);\n  font: inherit;\n  font-size: 0.8rem;",
    "  min-height: 3rem;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 0.46rem;\n  padding: 0.5rem 0.45rem;\n  border: 0;\n  background: transparent;\n  color: var(--text-color, #222);\n  font: inherit;\n  font-size: 0.84rem;",
)
replace_once(
    preview,
    '  gap: 0.55rem;\n  padding: 0.85rem;\n  border: 1px solid color-mix(',
    '  gap: 0.65rem;\n  padding: 1rem;\n  border: 1px solid color-mix(',
)
replace_once(
    preview,
    '  font-size: 0.8rem;\n  font-weight: 800;\n}',
    '  font-size: 0.88rem;\n  font-weight: 800;\n}',
)
replace_once(
    preview,
    '  font-size: 0.74rem;\n  line-height: 1.48;',
    '  font-size: 0.8rem;\n  line-height: 1.52;',
)
replace_once(
    preview,
    '  font-size: 0.86rem;\n  font-variant-numeric: tabular-nums;',
    '  font-size: 1rem;\n  font-variant-numeric: tabular-nums;',
)
replace_once(
    preview,
    '  font-size: 0.58rem;\n  text-overflow: ellipsis;',
    '  font-size: 0.64rem;\n  line-height: 1.3;\n  text-overflow: ellipsis;',
)
replace_once(
    preview,
    '  font-size: 0.9rem;\n  line-height: 1.55;\n  opacity: 0.78;',
    '  font-size: 0.96rem;\n  line-height: 1.6;\n  opacity: 0.82;',
)
replace_once(
    preview,
    '    width: min(100%, 84rem);',
    '    width: min(100%, 86rem);',
)
replace_once(
    preview,
    '    grid-template-columns: minmax(0, 1fr) minmax(17rem, 19rem);\n    align-items: start;\n    gap: 1rem;',
    '    grid-template-columns: minmax(0, 1fr) minmax(18rem, 20rem);\n    align-items: start;\n    gap: 1.15rem;',
)
replace_once(
    preview,
    '    gap: 0.65rem;\n    padding: 0.8rem 0.8rem 1rem 0;',
    '    gap: 0.75rem;\n    padding: 0.9rem 0.9rem 1.1rem 0;',
)

feed = Path('src/app/community/feed/community-feed.component.css')
replace_once(
    feed,
    '  gap: 0.55rem;\n  padding: 0.7rem 0.85rem;',
    '  gap: 0.62rem;\n  padding: 0.8rem 1rem;',
)
replace_once(feed, '  font-size: 0.88rem;\n  line-height: 1.4;', '  font-size: 0.92rem;\n  line-height: 1.45;')
replace_once(
    feed,
    '    var(--surface-border) 68%,',
    '    var(--surface-border) 78%,',
)
replace_once(
    feed,
    '  padding: 0.82rem 1rem;\n  background: transparent;',
    '  padding: 0.98rem 1.1rem;\n  background: transparent;',
)
replace_once(
    feed,
    '  gap: 0.62rem;\n  margin-bottom: 0.5rem;',
    '  gap: 0.68rem;\n  margin-bottom: 0.58rem;',
)
replace_once(
    feed,
    '  font-size: 0.9rem;\n  line-height: 1.48;',
    '  font-size: 0.96rem;\n  line-height: 1.55;',
)
replace_once(
    feed,
    '  max-width: 34rem;\n  margin: 0.62rem 0 0 3.17rem;',
    '  max-width: 38rem;\n  margin: 0.74rem 0 0 3.17rem;',
)
replace_once(
    feed,
    '  max-height: 34rem;',
    '  max-height: 38rem;',
)
replace_once(
    feed,
    '  gap: 0.2rem;\n  margin: 0.5rem 0 0 2.94rem;\n  color: color-mix(in oklab, var(--text-color) 62%, transparent);\n  font-size: 0.74rem;',
    '  gap: 0.26rem;\n  margin: 0.62rem 0 0 2.94rem;\n  color: color-mix(in oklab, var(--text-color) 68%, transparent);\n  font-size: 0.8rem;',
)
replace_once(
    feed,
    '  padding: 0.45rem 0.72rem;',
    '  padding: 0.5rem 0.78rem;',
)

location_styles = r'''

/* A localização e o contexto de resposta fazem parte do conteúdo do post.
   O tratamento abaixo concentra a apresentação no CSS e mantém alvos de 44px. */
.community-feed__location-preview {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 44px;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid color-mix(
    in oklab,
    var(--surface-border) 76%,
    var(--primary-color) 24%
  );
  border-radius: 0.9rem;
  background: color-mix(
    in oklab,
    var(--surface-color) 95%,
    var(--primary-color) 5%
  );
}

.community-feed__location-preview > i {
  width: 1.35rem;
  color: var(--primary-color);
  text-align: center;
}

.community-feed__location-preview > span {
  min-width: 0;
  display: grid;
  gap: 0.12rem;
}

.community-feed__location-preview strong {
  color: var(--text-color);
  font-size: 0.8rem;
}

.community-feed__location-preview small {
  color: color-mix(in oklab, var(--text-color) 62%, transparent);
  font-size: 0.7rem;
}

.community-feed__location-preview button {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: color-mix(in oklab, var(--text-color) 66%, transparent);
  font: inherit;
  cursor: pointer;
}

.community-post__location,
.community-post__reply-context {
  min-width: 0;
  margin: 0.72rem 0 0 3.17rem;
  border: 1px solid color-mix(
    in oklab,
    var(--surface-border) 78%,
    var(--primary-color) 22%
  );
  border-radius: 0.82rem;
  background: color-mix(
    in oklab,
    var(--surface-color) 97%,
    var(--primary-color) 3%
  );
}

.community-post__location {
  overflow: hidden;
}

.community-post__location-details > summary::-webkit-details-marker {
  display: none;
}

.community-post__location-meta {
  min-width: 0;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem 0.72rem;
}

.community-post__location-details > .community-post__location-meta {
  justify-content: space-between;
  cursor: pointer;
  list-style: none;
}

.community-post__location-label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.62rem;
}

.community-post__location-label > i {
  width: 1.15rem;
  flex: 0 0 1.15rem;
  color: var(--primary-color);
  text-align: center;
}

.community-post__location-label > span {
  min-width: 0;
  display: grid;
  gap: 0.12rem;
}

.community-post__location-label strong {
  color: var(--text-color);
  font-size: 0.8rem;
  line-height: 1.3;
}

.community-post__location-label small {
  overflow-wrap: anywhere;
  color: color-mix(in oklab, var(--text-color) 60%, transparent);
  font-size: 0.7rem;
  line-height: 1.35;
}

.community-post__location-details > .community-post__location-meta .community-post__action {
  flex: 0 0 auto;
}

.community-post__location-map {
  aspect-ratio: 16 / 9;
  min-height: 13rem;
  border-top: 1px solid color-mix(
    in oklab,
    var(--surface-border) 74%,
    transparent
  );
  background: color-mix(
    in oklab,
    var(--surface-color) 90%,
    var(--text-color) 10%
  );
}

.community-post__location-map iframe {
  width: 100%;
  height: 100%;
  display: block;
  border: 0;
}

.community-post__location-external {
  justify-content: flex-end;
  padding-top: 0;
  border-top: 1px solid color-mix(
    in oklab,
    var(--surface-border) 64%,
    transparent
  );
}

.community-post__location-external a {
  text-decoration: none;
}

.community-post__reply-context {
  display: grid;
  gap: 0.22rem;
  padding: 0.62rem 0.78rem;
  border-inline-start: 3px solid color-mix(
    in oklab,
    var(--primary-color) 72%,
    transparent
  );
  color: color-mix(in oklab, var(--text-color) 76%, transparent);
  text-decoration: none;
}

.community-post__reply-context strong {
  display: flex;
  align-items: center;
  gap: 0.38rem;
  color: var(--text-color);
  font-size: 0.76rem;
  line-height: 1.35;
}

.community-post__reply-context > span {
  overflow: hidden;
  color: color-mix(in oklab, var(--text-color) 68%, transparent);
  font-size: 0.74rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.community-post__reply-context.is-navigable {
  cursor: pointer;
}

.community-post__reply-context.is-navigable:hover {
  border-color: color-mix(
    in oklab,
    var(--surface-border) 56%,
    var(--primary-color) 44%
  );
  background: color-mix(
    in oklab,
    var(--surface-color) 93%,
    var(--primary-color) 7%
  );
}

.community-post__reply-status {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  white-space: normal;
}

.community-post__reply-status.is-error {
  color: var(--error-color, #b42318);
}
'''
anchor = '\n/* Fotos é somente uma compilação dos itens photo da mesma timeline. */\n'
text = feed.read_text(encoding='utf-8')
if text.count(anchor) != 1:
    raise SystemExit('feed: photo section anchor not found exactly once')
feed.write_text(text.replace(anchor, location_styles + anchor, 1), encoding='utf-8')

replace_once(
    feed,
    '  .community-post p,\n  .community-post__media {\n    margin-left: 0;\n  }',
    '  .community-post p,\n  .community-post__media,\n  .community-post__location,\n  .community-post__reply-context {\n    margin-left: 0;\n  }',
)
replace_once(
    feed,
    ':host-context(.high-contrast) .community-post__confirmation,\n:host-context(.high-contrast) .community-feed--photos .community-post {',
    ':host-context(.high-contrast) .community-post__confirmation,\n:host-context(.high-contrast) .community-post__location,\n:host-context(.high-contrast) .community-post__reply-context,\n:host-context(.high-contrast) .community-feed--photos .community-post {',
)

html = Path('src/app/community/feed/community-feed.component.html')
replace_once(
    html,
    '                      class="community-post__location-meta"\n                      style="justify-content: space-between; cursor: pointer; list-style: none;"',
    '                      class="community-post__location-meta"',
)
replace_once(
    html,
    '                  <div class="community-post__location-meta" style="justify-content: flex-end; padding-top: 0;">',
    '                  <div class="community-post__location-meta community-post__location-external">',
)
replace_once(
    html,
    '                      class="community-post__action"\n                      style="text-decoration: none;"',
    '                      class="community-post__action"',
)

print('Community visual hierarchy patch applied.')
