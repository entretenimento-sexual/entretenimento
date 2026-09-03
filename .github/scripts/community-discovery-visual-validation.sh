#!/usr/bin/env bash
set -euo pipefail

# O filtro por tags possui rolagem horizontal interna intencional. No mobile,
# overflow da página é validado por body + window.scrollX; html.scrollWidth fica
# apenas como diagnóstico porque também contabiliza conteúdo de scrollers filhos.
OUT='artifacts/community-discovery'
BASE='http://127.0.0.1:4200/'
mkdir -p "$OUT/explore/desktop" "$OUT/explore/mobile" "$OUT/venues/mobile" "$OUT/profile/desktop" "$OUT/profile/mobile" "$OUT/browser-console"

check_log() {
  local file="$1"
  if grep -q '^### Error' "$file"; then
    cat "$file" >&2
    exit 1
  fi
}

run_checked() {
  local file="$1"
  local code="$2"
  playwright-cli run-code "$code" | tee "$file"
  check_log "$file"
}

playwright-cli open "${BASE}?visualState=explore"
playwright-cli resize 1440 1000

run_checked "$OUT/explore/desktop/metrics.log" "async (page) => {
  await page.waitForSelector('.community-discovery__grid', { state: 'visible' });
  await page.waitForSelector('.community-card', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const grid = document.querySelector('.community-discovery__grid');
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const cards = Array.from(document.querySelectorAll('.community-card'));
    const dismissButtons = Array.from(document.querySelectorAll('.community-card__dismiss'));
    const dismissOverlapsCards = dismissButtons.some((button) => {
      const buttonRect = button.getBoundingClientRect();
      return cards.some((card) => {
        const cardRect = card.getBoundingClientRect();
        return buttonRect.left < cardRect.right
          && buttonRect.right > cardRect.left
          && buttonRect.top < cardRect.bottom
          && buttonRect.bottom > cardRect.top;
      });
    });
    const create = document.querySelector('.community-discovery__create');
    const filters = document.querySelector('.community-discovery__filter-strip');
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1Count: document.querySelectorAll('.community-discovery h1').length,
      navCount: document.querySelectorAll('.community-discovery__scope-nav a').length,
      cardCount: cards.length,
      gridColumns: gridStyle?.gridTemplateColumns?.split(/\\s+/).filter(Boolean).length ?? 0,
      officialBadgeCount: document.querySelectorAll('.community-card .community-official-badge').length,
      filterChipCount: document.querySelectorAll('.community-discovery__filter-chip').length,
      filterScrollable: Boolean(filters && filters.scrollWidth >= filters.clientWidth),
      createHeight: create?.getBoundingClientRect().height ?? 0,
      dismissMinHeight: dismissButtons.length
        ? Math.min(...dismissButtons.map((button) => button.getBoundingClientRect().height))
        : 0,
      dismissOverlapsCards,
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.h1Count !== 1
    || metrics.navCount !== 3
    || metrics.cardCount !== 6
    || metrics.gridColumns < 3
    || metrics.officialBadgeCount < 3
    || metrics.filterChipCount < 6
    || metrics.createHeight < 44
    || metrics.dismissMinHeight < 44
    || metrics.dismissOverlapsCards
  ) {
    throw new Error('Community discovery desktop validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli snapshot --filename="$OUT/explore/desktop/accessibility.yml"
playwright-cli screenshot --filename="$OUT/explore/desktop/viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/explore/desktop/full-page.png"

playwright-cli resize 390 844
playwright-cli reload
playwright-cli screenshot --filename="$OUT/explore/mobile/precheck.viewport.png"

run_checked "$OUT/explore/mobile/metrics.log" "async (page) => {
  await page.waitForSelector('.community-discovery__grid', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const grid = document.querySelector('.community-discovery__grid');
    const gridRect = grid?.getBoundingClientRect();
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const firstCard = document.querySelector('.community-card')?.getBoundingClientRect();
    const nav = document.querySelector('.community-discovery__scope-nav');
    const filters = document.querySelector('.community-discovery__filter-strip');
    const filtersSection = document.querySelector('.community-discovery__filters');
    const main = document.querySelector('.community-discovery');
    const header = document.querySelector('.community-discovery__header');
    const create = document.querySelector('.community-discovery__create');
    const currentScrollY = window.scrollY;
    window.scrollTo(9999, currentScrollY);
    const windowScrollX = window.scrollX;
    window.scrollTo(0, currentScrollY);
    const overflowElements = Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.right <= window.innerWidth + 1 && rect.left >= -1) return false;
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body) {
          const style = getComputedStyle(ancestor);
          const overflowX = style.overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden' || overflowX === 'clip') {
            return false;
          }
          ancestor = ancestor.parentElement;
        }
        return true;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className ?? '').slice(0, 140),
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      })
      .sort((left, right) => right.right - left.right)
      .slice(0, 12);
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      windowScrollX,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      mainClientWidth: main?.clientWidth ?? 0,
      mainScrollWidth: main?.scrollWidth ?? 0,
      headerWidth: header?.getBoundingClientRect().width ?? 0,
      navClientWidth: nav?.clientWidth ?? 0,
      navScrollWidth: nav?.scrollWidth ?? 0,
      filtersSectionWidth: filtersSection?.getBoundingClientRect().width ?? 0,
      gridColumns: gridStyle?.gridTemplateColumns?.split(/\\s+/).filter(Boolean).length ?? 0,
      gridWidth: gridRect?.width ?? 0,
      firstCardWidth: firstCard?.width ?? 0,
      navHeight: nav?.getBoundingClientRect().height ?? 0,
      filterClientWidth: filters?.clientWidth ?? 0,
      filterScrollWidth: filters?.scrollWidth ?? 0,
      officialBadgeCount: document.querySelectorAll('.community-card .community-official-badge').length,
      dismissCount: document.querySelectorAll('.community-card__dismiss').length,
      createHeight: create?.getBoundingClientRect().height ?? 0,
      overflowElements,
    };
  });
  if (
    metrics.bodyScrollWidth > metrics.viewportWidth + 1
    || metrics.windowScrollX > 1
    || metrics.gridColumns !== 1
    || metrics.gridWidth < metrics.viewportWidth * 0.9
    || Math.abs(metrics.firstCardWidth - metrics.gridWidth) > 1
    || metrics.navHeight < 44
    || metrics.filterScrollWidth <= metrics.filterClientWidth
    || metrics.officialBadgeCount < 3
    || metrics.dismissCount !== 6
    || metrics.createHeight < 44
  ) {
    throw new Error('Community discovery mobile validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli snapshot --filename="$OUT/explore/mobile/accessibility.yml"
playwright-cli screenshot --filename="$OUT/explore/mobile/viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/explore/mobile/full-page.png"

playwright-cli goto "${BASE}?visualState=venues"
playwright-cli resize 390 844

run_checked "$OUT/venues/mobile/metrics.log" "async (page) => {
  await page.waitForSelector('.community-discovery__grid', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const locations = Array.from(document.querySelectorAll('.community-official-location'));
    const locationTexts = locations.map((node) => (node.textContent ?? '').replace(/\\s+/g, ' ').trim());
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cardCount: document.querySelectorAll('.community-card').length,
      officialBadgeCount: document.querySelectorAll('.community-official-badge').length,
      locationCount: locations.length,
      locationTexts,
      minLocationWidth: locations.length
        ? Math.min(...locations.map((node) => node.getBoundingClientRect().width))
        : 0,
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.cardCount !== 3
    || metrics.officialBadgeCount !== 3
    || metrics.locationCount !== 3
    || metrics.minLocationWidth < 80
    || !metrics.locationTexts.some((text) => text.includes('Copacabana') && text.includes('Rio de Janeiro, RJ'))
  ) {
    throw new Error('Official venue mobile validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli snapshot --filename="$OUT/venues/mobile/accessibility.yml"
playwright-cli screenshot --filename="$OUT/venues/mobile/viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/venues/mobile/full-page.png"

playwright-cli goto "${BASE}?visualState=profile"
playwright-cli resize 900 900

run_checked "$OUT/profile/desktop/metrics.log" "async (page) => {
  await page.waitForSelector('.profile-official-communities', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('.profile-official-community'));
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1Count: document.querySelectorAll('.visual-profile h1').length,
      sectionCount: document.querySelectorAll('.profile-official-communities').length,
      itemCount: links.length,
      officialBadgeCount: document.querySelectorAll('.profile-official-community .community-official-badge').length,
      locationCount: document.querySelectorAll('.profile-official-community .community-official-location').length,
      minLinkHeight: links.length ? Math.min(...links.map((link) => link.getBoundingClientRect().height)) : 0,
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.h1Count !== 1
    || metrics.sectionCount !== 1
    || metrics.itemCount !== 3
    || metrics.officialBadgeCount !== 3
    || metrics.locationCount !== 1
    || metrics.minLinkHeight < 72
  ) {
    throw new Error('Official profile desktop validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli snapshot --filename="$OUT/profile/desktop/accessibility.yml"
playwright-cli screenshot --filename="$OUT/profile/desktop/viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/profile/desktop/full-page.png"

playwright-cli resize 390 844
playwright-cli reload

run_checked "$OUT/profile/mobile/metrics.log" "async (page) => {
  await page.waitForSelector('.profile-official-communities', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const section = document.querySelector('.profile-official-communities')?.getBoundingClientRect();
    const links = Array.from(document.querySelectorAll('.profile-official-community'));
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      sectionWidth: section?.width ?? 0,
      itemCount: links.length,
      officialBadgeCount: document.querySelectorAll('.profile-official-community .community-official-badge').length,
      locationCount: document.querySelectorAll('.profile-official-community .community-official-location').length,
      minLinkHeight: links.length ? Math.min(...links.map((link) => link.getBoundingClientRect().height)) : 0,
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.sectionWidth > metrics.viewportWidth + 1
    || metrics.itemCount !== 3
    || metrics.officialBadgeCount !== 3
    || metrics.locationCount !== 1
    || metrics.minLinkHeight < 72
  ) {
    throw new Error('Official profile mobile validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli snapshot --filename="$OUT/profile/mobile/accessibility.yml"
playwright-cli screenshot --filename="$OUT/profile/mobile/viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/profile/mobile/full-page.png"

while IFS= read -r console_file; do
  cp "$console_file" "$OUT/browser-console/$(basename "$console_file")"
done < <(find .playwright-cli -type f -name 'console-*.log' -print 2>/dev/null || true)

console_error_count=0
shopt -s nullglob
console_files=("$OUT"/browser-console/console-*.log)
if (( ${#console_files[@]} == 0 )); then
  echo 'Community discovery visual validation did not produce browser console logs.' >&2
  exit 1
fi

for console_file in "${console_files[@]}"; do
  # Playwright CLI já usou tanto "[ERROR]" quanto "error <...>" colorizado.
  # A busca textual funciona nos dois formatos sem depender de cabeçalho-resumo.
  if grep -Eqi '(\[ERROR\]|(^|[[:space:]])error([[:space:]]|\x1b\[[0-9;]*m)*<)' "$console_file"; then
    echo "Unexpected browser console error in $console_file" >&2
    cat "$console_file" >&2
    console_error_count=$((console_error_count + 1))
  fi
done

playwright-cli close

if (( console_error_count > 0 )); then
  echo 'Community discovery visual validation found browser console errors.' >&2
  exit 1
fi
