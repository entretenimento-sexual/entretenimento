#!/usr/bin/env bash
set -euo pipefail
OUT='artifacts/community-page'
mkdir -p "$OUT/desktop" "$OUT/mobile" "$OUT/management/desktop" "$OUT/management/mobile"

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

playwright-cli open 'http://127.0.0.1:4200/'
playwright-cli resize 1440 1100

run_checked "$OUT/desktop/feed.metrics.log" "async (page) => {
  await page.waitForSelector('.community-preview__content', { state: 'visible' });
  await page.waitForSelector('.community-post', { state: 'visible' });
  await page.waitForSelector('.community-preview__rail', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const rail = document.querySelector('.community-preview__rail');
    const primary = document.querySelector('.community-preview__primary');
    const body = document.querySelector('.community-preview__body');
    const railRect = rail?.getBoundingClientRect();
    const primaryRect = primary?.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1Count: document.querySelectorAll('.community-preview h1').length,
      tabCount: document.querySelectorAll('.community-preview__tabs button').length,
      postCount: document.querySelectorAll('.community-post').length,
      hasComposer: Boolean(document.querySelector('.community-feed__composer')),
      hasCover: Boolean(document.querySelector('.community-preview__cover')),
      hasIdentity: Boolean(document.querySelector('.community-preview__identity')),
      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none'),
      railWidth: railRect?.width ?? 0,
      primaryWidth: primaryRect?.width ?? 0,
      bodyWidth: bodyRect?.width ?? 0,
      railHasAbout: (rail?.textContent ?? '').includes('Sobre'),
      railHasMetrics: (rail?.textContent ?? '').includes('Comunidade agora'),
      railHasRules: (rail?.textContent ?? '').includes('Regras'),
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.h1Count !== 1
    || metrics.tabCount !== 3
    || metrics.postCount !== 3
    || !metrics.hasComposer
    || !metrics.hasCover
    || !metrics.hasIdentity
    || !metrics.railVisible
    || metrics.railWidth < 240
    || metrics.primaryWidth < 700
    || metrics.bodyWidth <= metrics.primaryWidth
    || !metrics.railHasAbout
    || !metrics.railHasMetrics
    || !metrics.railHasRules
  ) {
    throw new Error('Community page desktop feed validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"

playwright-cli snapshot --filename="$OUT/desktop/feed.accessibility.yml"
playwright-cli screenshot --filename="$OUT/desktop/feed.viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/desktop/feed.full-page.png"

run_checked "$OUT/desktop/about.metrics.log" "async (page) => {
  await page.getByRole('button', { name: 'Sobre', exact: true }).click();
  await page.waitForSelector('.community-preview__about', { state: 'visible' });
  const text = (await page.locator('.community-preview__about').innerText()).trim();
  const metrics = {
    hasRules: text.includes('Regras da Comunidade'),
    hasDescription: text.includes('Espaço para conhecer pessoas'),
    hasTags: text.includes('#Amizade') && text.includes('#Encontros'),
    railCount: await page.locator('.community-preview__rail').count(),
    scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
  };
  if (
    !metrics.hasRules
    || !metrics.hasDescription
    || !metrics.hasTags
    || metrics.railCount !== 0
    || metrics.scrollWidth > 1441
  ) {
    throw new Error('Community page desktop about validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli screenshot --filename="$OUT/desktop/about.viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/desktop/about.full-page.png"

playwright-cli goto 'http://127.0.0.1:4200/'
playwright-cli resize 390 844

run_checked "$OUT/mobile/feed.metrics.log" "async (page) => {
  await page.waitForSelector('.community-preview__content', { state: 'visible' });
  await page.waitForSelector('.community-post', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const tabs = document.querySelector('.community-preview__tabs')?.getBoundingClientRect();
    const content = document.querySelector('.community-preview__content')?.getBoundingClientRect();
    const rail = document.querySelector('.community-preview__rail');
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      contentWidth: content?.width ?? 0,
      tabsWidth: tabs?.width ?? 0,
      tabCount: document.querySelectorAll('.community-preview__tabs button').length,
      postCount: document.querySelectorAll('.community-post').length,
      railCount: document.querySelectorAll('.community-preview__rail').length,
      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none'),
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.contentWidth > metrics.viewportWidth + 1
    || metrics.tabsWidth > metrics.viewportWidth + 1
    || metrics.tabCount !== 3
    || metrics.postCount !== 3
    || metrics.railCount !== 1
    || metrics.railVisible
  ) {
    throw new Error('Community page mobile validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"

playwright-cli snapshot --filename="$OUT/mobile/feed.accessibility.yml"
playwright-cli screenshot --filename="$OUT/mobile/feed.viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/mobile/feed.full-page.png"

run_checked "$OUT/mobile/about.metrics.log" "async (page) => {
  await page.getByRole('button', { name: 'Sobre', exact: true }).click();
  await page.waitForSelector('.community-preview__about', { state: 'visible' });
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    railCount: document.querySelectorAll('.community-preview__rail').length,
  }));
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.railCount !== 0
  ) {
    throw new Error('Community page mobile about validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli screenshot --full-page --filename="$OUT/mobile/about.full-page.png"

playwright-cli goto 'http://127.0.0.1:4200/?scenario=owner'
playwright-cli resize 1440 1100

run_checked "$OUT/management/desktop/overview.metrics.log" "async (page) => {
  await page.getByRole('button', { name: 'Gestão', exact: true }).click();
  await page.waitForSelector('.community-management-hub', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const hub = document.querySelector('.community-management-hub');
    const hubRect = hub?.getBoundingClientRect();
    const navLabels = Array.from(
      document.querySelectorAll('.community-management-hub__nav button')
    ).map((button) => (button.textContent ?? '').trim());
    const cardLabels = Array.from(
      document.querySelectorAll('.community-management-hub__card')
    ).map((card) => (card.querySelector('strong')?.textContent ?? '').trim());
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      topTabCount: document.querySelectorAll('.community-preview__tabs button').length,
      hubWidth: hubRect?.width ?? 0,
      navLabels,
      cardLabels,
      cardCount: cardLabels.length,
      hasOwnerLabel: (hub?.textContent ?? '').includes('Proprietário'),
      hasTitle: (hub?.textContent ?? '').includes('Gestão da Comunidade'),
      hasCapacity: (hub?.textContent ?? '').includes('86 de 100 integrantes'),
      heavyChildren: document.querySelectorAll(
        'app-community-member-roster-management, app-community-settings, app-community-ownership-management'
      ).length,
    };
  });
  const expectedNav = ['Visão geral', 'Solicitações', 'Participantes', 'Configurações', 'Propriedade'];
  const expectedCards = ['Solicitações', 'Participantes', 'Convites', 'Configurações', 'Moderação', 'Capacidade', 'Propriedade'];
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.topTabCount !== 5
    || metrics.hubWidth < 700
    || metrics.navLabels.length !== expectedNav.length
    || !expectedNav.every((label) => metrics.navLabels.some((value) => value.includes(label)))
    || metrics.cardCount !== expectedCards.length
    || !expectedCards.every((label) => metrics.cardLabels.includes(label))
    || !metrics.hasOwnerLabel
    || !metrics.hasTitle
    || !metrics.hasCapacity
    || metrics.heavyChildren !== 0
  ) {
    throw new Error('Community owner management desktop validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"

playwright-cli snapshot --filename="$OUT/management/desktop/overview.accessibility.yml"
playwright-cli screenshot --filename="$OUT/management/desktop/overview.viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/management/desktop/overview.full-page.png"

run_checked "$OUT/management/desktop/requests.metrics.log" "async (page) => {
  await page.locator('.community-management-hub__nav button').filter({ hasText: 'Solicitações' }).click();
  await page.waitForSelector('.community-membership-management', { state: 'visible' });
  const text = (await page.locator('.community-membership-management').innerText()).trim();
  const metrics = {
    hasTitle: text.includes('Solicitações de entrada'),
    hasContextualEmptyState: text.includes('Nenhuma solicitação de entrada pendente.'),
    scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    heavyChildren: await page.locator(
      'app-community-member-roster-management, app-community-settings, app-community-ownership-management'
    ).count(),
  };
  if (
    !metrics.hasTitle
    || !metrics.hasContextualEmptyState
    || metrics.scrollWidth > 1441
    || metrics.heavyChildren !== 0
  ) {
    throw new Error('Community owner requests desktop validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli screenshot --full-page --filename="$OUT/management/desktop/requests.full-page.png"

playwright-cli goto 'http://127.0.0.1:4200/?scenario=owner'
playwright-cli resize 390 844

run_checked "$OUT/management/mobile/overview.metrics.log" "async (page) => {
  await page.getByRole('button', { name: 'Gestão', exact: true }).click();
  await page.waitForSelector('.community-management-hub', { state: 'visible' });
  const metrics = await page.evaluate(() => {
    const hub = document.querySelector('.community-management-hub');
    const hubRect = hub?.getBoundingClientRect();
    const nav = document.querySelector('.community-management-hub__nav');
    const topTabs = document.querySelector('.community-preview__tabs');
    const topTabLabels = Array.from(
      document.querySelectorAll('.community-preview__tabs button span')
    );
    const topTabLabelsVisible = topTabLabels.every((label) => {
      const rect = label.getBoundingClientRect();
      const style = getComputedStyle(label);
      return rect.width > 1
        && rect.height > 1
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    });
    const cards = Array.from(document.querySelectorAll('.community-management-hub__card'));
    const cardsInsideViewport = cards.every((card) => {
      const rect = card.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= window.innerWidth + 1;
    });
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hubWidth: hubRect?.width ?? 0,
      navClientWidth: nav?.clientWidth ?? 0,
      navScrollWidth: nav?.scrollWidth ?? 0,
      topTabsClientWidth: topTabs?.clientWidth ?? 0,
      topTabsScrollWidth: topTabs?.scrollWidth ?? 0,
      topTabCount: document.querySelectorAll('.community-preview__tabs button').length,
      topTabLabelsVisible,
      navCount: document.querySelectorAll('.community-management-hub__nav button').length,
      cardCount: cards.length,
      cardsInsideViewport,
      hasTitle: (hub?.textContent ?? '').includes('Gestão da Comunidade'),
      heavyChildren: document.querySelectorAll(
        'app-community-member-roster-management, app-community-settings, app-community-ownership-management'
      ).length,
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.hubWidth > metrics.viewportWidth + 1
    || metrics.topTabCount !== 5
    || !metrics.topTabLabelsVisible
    || metrics.topTabsScrollWidth <= metrics.topTabsClientWidth
    || metrics.navCount !== 5
    || metrics.cardCount !== 7
    || !metrics.cardsInsideViewport
    || !metrics.hasTitle
    || metrics.heavyChildren !== 0
    || metrics.navScrollWidth < metrics.navClientWidth
  ) {
    throw new Error('Community owner management mobile validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"

playwright-cli snapshot --filename="$OUT/management/mobile/overview.accessibility.yml"
playwright-cli screenshot --filename="$OUT/management/mobile/overview.viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/management/mobile/overview.full-page.png"

mkdir -p "$OUT/browser-console"
while IFS= read -r console_file; do
  cp "$console_file" "$OUT/browser-console/$(basename "$console_file")"
done < <(find .playwright-cli -type f -name 'console-*.log' -print 2>/dev/null || true)

playwright-cli close
