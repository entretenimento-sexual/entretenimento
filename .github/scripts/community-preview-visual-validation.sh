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
    const cover = document.querySelector('.community-preview__cover');
    const title = document.querySelector('.community-preview h1');
    const actions = Array.from(document.querySelectorAll('button.community-post__action, a.community-post__action, .community-post__location-details > summary'));
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1Count: document.querySelectorAll('.community-preview h1').length,
      tabCount: document.querySelectorAll('.community-preview__tabs button').length,
      hasMembersTab: document.querySelector('#community-tab-members')?.textContent.includes('Membros') === true,
      postCount: document.querySelectorAll('.community-post').length,
      hasComposer: Boolean(document.querySelector('.community-feed__composer')),
      hasCover: Boolean(document.querySelector('.community-preview__cover')),
      hasIdentity: Boolean(document.querySelector('.community-preview__identity')),
      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none'),
      railWidth: railRect?.width ?? 0,
      primaryWidth: primaryRect?.width ?? 0,
      bodyWidth: bodyRect?.width ?? 0,
      coverHeight: cover?.getBoundingClientRect().height ?? 0,
      titleFontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      minPostActionHeight: actions.length
        ? Math.min(...actions.map((action) => action.getBoundingClientRect().height))
        : 0,
      locationCount: document.querySelectorAll('.community-post__location').length,
      replyContextCount: document.querySelectorAll('.community-post__reply-context').length,
      railHasAbout: (rail?.textContent ?? '').includes('Sobre'),
      railHasMetrics: (rail?.textContent ?? '').includes('Comunidade agora'),
      railHasRules: (rail?.textContent ?? '').includes('Regras'),
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.h1Count !== 1
    || metrics.tabCount !== 4
    || !metrics.hasMembersTab
    || metrics.postCount !== 3
    || !metrics.hasComposer
    || !metrics.hasCover
    || !metrics.hasIdentity
    || !metrics.railVisible
    || metrics.railWidth < 240
    || metrics.primaryWidth < 700
    || metrics.bodyWidth <= metrics.primaryWidth
    || metrics.coverHeight < 120
    || metrics.titleFontSize < 20
    || metrics.minPostActionHeight < 44
    || metrics.locationCount !== 1
    || metrics.replyContextCount !== 1
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

run_checked "$OUT/desktop/members.metrics.log" "async (page) => {
  await page.getByRole('button', { name: 'Membros', exact: true }).click();
  await page.waitForSelector('.community-members__profile', { state: 'visible' });
  const panel = page.locator('#community-panel-members');
  const initialCount = await panel.locator('.community-members__item').count();
  const firstLink = panel.getByRole('link', { name: 'Ver perfil de Marina', exact: true });
  await firstLink.focus();
  const profileHref = await firstLink.getAttribute('href');
  const focused = await firstLink.evaluate((link) => document.activeElement === link);
  await panel.getByRole('button', { name: 'Ver mais integrantes', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('#community-panel-members .community-members__item').length === 3
    && !document.querySelector('#community-panel-members .community-members__more button')
  );
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('#community-panel-members');
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      memberCount: panel?.querySelectorAll('.community-members__item').length,
      hasTitle: panel?.querySelector('h2')?.textContent === 'Membros',
      hasMore: Boolean(panel?.querySelector('.community-members__more button')),
      nestedMain: Boolean(panel?.querySelector('main, [role=main]')),
      hasBack: Boolean(panel?.querySelector('.community-members__topbar')),
      linksInsideViewport: Array.from(panel?.querySelectorAll('.community-members__profile') ?? [])
        .every((link) => {
          const rect = link.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.height >= 44;
        }),
    };
  });
  if (
    initialCount !== 2
    || metrics.memberCount !== 3
    || !metrics.hasTitle
    || metrics.hasMore
    || metrics.nestedMain
    || metrics.hasBack
    || !metrics.linksInsideViewport
    || metrics.scrollWidth > metrics.viewportWidth + 1
    || !focused
    || profileHref !== '/perfil/profile-00000000-0000-4000-8000-000000000001'
  ) {
    throw new Error('Community members desktop validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli screenshot --full-page --filename="$OUT/desktop/members.full-page.png"

run_checked "$OUT/desktop/member-search.metrics.log" "async (page) => {
  const panel = page.locator('#community-panel-members');
  const search = panel.getByRole('searchbox', { name: 'Buscar integrantes' });
  await search.fill('Mar');
  const results = panel.getByRole('list', { name: 'Resultados da busca por Mar' });
  await results.waitFor({ state: 'visible' });
  const links = results.getByRole('link');
  const count = await links.count();
  const href = await links.first().getAttribute('href');
  const label = await links.first().getAttribute('aria-label');
  if (count !== 1
      || href !== '/perfil/profile-00000000-0000-4000-8000-000000000001'
      || label !== 'Ver perfil de Marina') {
    throw new Error('Community member search validation failed: ' + JSON.stringify({ count, href, label }));
  }
  await search.fill('zzzz');
  await panel.getByText('Nenhum integrante encontrado para esta busca.', { exact: true }).waitFor({ state: 'visible' });
  await panel.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  const roster = panel.getByRole('list', { name: 'Integrantes da Comunidade' });
  await roster.waitFor({ state: 'visible' });
  const restoredCount = await roster.getByRole('link').count();
  if (restoredCount !== 3 || await search.inputValue() !== '') {
    throw new Error('Community member roster restoration failed: ' + JSON.stringify({ restoredCount }));
  }
  return { count, href, label, restoredCount };
}"


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
    const cover = document.querySelector('.community-preview__cover');
    const actions = Array.from(document.querySelectorAll('button.community-post__action, a.community-post__action, .community-post__location-details > summary'));
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      contentWidth: content?.width ?? 0,
      tabsWidth: tabs?.width ?? 0,
      tabCount: document.querySelectorAll('.community-preview__tabs button').length,
      hasMembersTab: document.querySelector('#community-tab-members')?.textContent.includes('Membros') === true,
      postCount: document.querySelectorAll('.community-post').length,
      railCount: document.querySelectorAll('.community-preview__rail').length,
      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none'),
      coverHeight: cover?.getBoundingClientRect().height ?? 0,
      minPostActionHeight: actions.length
        ? Math.min(...actions.map((action) => action.getBoundingClientRect().height))
        : 0,
      locationCount: document.querySelectorAll('.community-post__location').length,
      replyContextCount: document.querySelectorAll('.community-post__reply-context').length,
    };
  });
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.contentWidth > metrics.viewportWidth + 1
    || metrics.tabsWidth > metrics.viewportWidth + 1
    || metrics.tabCount !== 4
    || !metrics.hasMembersTab
    || metrics.postCount !== 3
    || metrics.railCount !== 1
    || metrics.railVisible
    || metrics.coverHeight < 100
    || metrics.minPostActionHeight < 44
    || metrics.locationCount !== 1
    || metrics.replyContextCount !== 1
  ) {
    throw new Error('Community page mobile validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"

playwright-cli snapshot --filename="$OUT/mobile/feed.accessibility.yml"
playwright-cli screenshot --filename="$OUT/mobile/feed.viewport.png"
playwright-cli screenshot --full-page --filename="$OUT/mobile/feed.full-page.png"

run_checked "$OUT/mobile/members.metrics.log" "async (page) => {
  await page.getByRole('button', { name: 'Membros', exact: true }).click();
  await page.waitForSelector('.community-members__profile', { state: 'visible' });
  const panel = page.locator('#community-panel-members');
  const initialCount = await panel.locator('.community-members__item').count();
  const firstLink = panel.getByRole('link', { name: 'Ver perfil de Marina', exact: true });
  await firstLink.focus();
  const profileHref = await firstLink.getAttribute('href');
  const focused = await firstLink.evaluate((link) => document.activeElement === link);
  await panel.getByRole('button', { name: 'Ver mais integrantes', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('#community-panel-members .community-members__item').length === 3
    && !document.querySelector('#community-panel-members .community-members__more button')
  );
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('#community-panel-members');
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      memberCount: panel?.querySelectorAll('.community-members__item').length,
      hasTitle: panel?.querySelector('h2')?.textContent === 'Membros',
      hasMore: Boolean(panel?.querySelector('.community-members__more button')),
      nestedMain: Boolean(panel?.querySelector('main, [role=main]')),
      hasBack: Boolean(panel?.querySelector('.community-members__topbar')),
      linksInsideViewport: Array.from(panel?.querySelectorAll('.community-members__profile') ?? [])
        .every((link) => {
          const rect = link.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.height >= 44;
        }),
    };
  });
  if (
    initialCount !== 2
    || metrics.memberCount !== 3
    || !metrics.hasTitle
    || metrics.hasMore
    || metrics.nestedMain
    || metrics.hasBack
    || !metrics.linksInsideViewport
    || metrics.scrollWidth > metrics.viewportWidth + 1
    || !focused
    || profileHref !== '/perfil/profile-00000000-0000-4000-8000-000000000001'
  ) {
    throw new Error('Community members mobile validation failed: ' + JSON.stringify(metrics));
  }
  return metrics;
}"
playwright-cli screenshot --full-page --filename="$OUT/mobile/members.full-page.png"

run_checked "$OUT/mobile/member-search.metrics.log" "async (page) => {
  const panel = page.locator('#community-panel-members');
  const search = panel.getByRole('searchbox', { name: 'Buscar integrantes' });
  await search.fill('Mar');
  const results = panel.getByRole('list', { name: 'Resultados da busca por Mar' });
  await results.waitFor({ state: 'visible' });
  const links = results.getByRole('link');
  const count = await links.count();
  const href = await links.first().getAttribute('href');
  const label = await links.first().getAttribute('aria-label');
  if (count !== 1
      || href !== '/perfil/profile-00000000-0000-4000-8000-000000000001'
      || label !== 'Ver perfil de Marina') {
    throw new Error('Community member search validation failed: ' + JSON.stringify({ count, href, label }));
  }
  await search.fill('zzzz');
  await panel.getByText('Nenhum integrante encontrado para esta busca.', { exact: true }).waitFor({ state: 'visible' });
  await panel.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  const roster = panel.getByRole('list', { name: 'Integrantes da Comunidade' });
  await roster.waitFor({ state: 'visible' });
  const restoredCount = await roster.getByRole('link').count();
  if (restoredCount !== 3 || await search.inputValue() !== '') {
    throw new Error('Community member roster restoration failed: ' + JSON.stringify({ restoredCount }));
  }
  return { count, href, label, restoredCount };
}"


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

validate_timeline() {
  local viewport="$1"
  run_checked "$OUT/management/$viewport/history.metrics.log" "async (page) => {
    const hub = page.locator('.community-management-hub');
    const history = hub.getByRole('button', { name: 'Histórico', exact: true });
    await history.focus();
    if (!(await history.evaluate(button => document.activeElement === button))) {
      throw new Error('History navigation is not keyboard focusable');
    }
    await history.press('Enter');
    const timeline = hub.getByRole('region', { name: 'Histórico administrativo' });
    await timeline.waitFor({ state: 'visible' });
    await timeline.getByText('Marina aprovou a entrada de Bia.', { exact: true }).waitFor({ state: 'visible' });
    const refresh = timeline.getByRole('button', { name: 'Atualizar histórico administrativo' });
    const more = timeline.getByRole('button', { name: 'Carregar mais', exact: true });
    const metrics = await timeline.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const buttons = Array.from(element.querySelectorAll('button'));
      const minTarget = Math.min(...buttons.map(button => {
        const box = button.getBoundingClientRect();
        return Math.min(box.width, box.height);
      }));
      return {
        insideViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1,
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        minTarget,
        hasPrivacyNotice: (element.textContent ?? '').includes('Dados internos de auditoria e evidências não'),
        timeCount: element.querySelectorAll('time[datetime]').length,
      };
    });
    if (await history.getAttribute('aria-pressed') !== 'true'
      || !metrics.insideViewport || !metrics.noOverflow || metrics.minTarget < 44
      || !metrics.hasPrivacyNotice || metrics.timeCount !== 1) {
      throw new Error('History accessibility validation failed: ' + JSON.stringify(metrics));
    }
    await more.click();
    await timeline.getByText('Rafael destacou uma publicação.', { exact: true }).waitFor({ state: 'visible' });
    if (await timeline.locator('li').count() !== 2 || await more.count() !== 0) {
      throw new Error('History pagination did not retain both events');
    }
    await refresh.click();
    await more.waitFor({ state: 'visible' });
    if (await timeline.locator('li').count() !== 1) {
      throw new Error('History refresh did not reset pagination');
    }
    await hub.getByRole('button', { name: 'Visão geral', exact: true }).click();
    await timeline.waitFor({ state: 'detached' });
    const card = hub.locator('.community-management-hub__card').filter({ hasText: 'Histórico administrativo' });
    await card.click();
    await timeline.getByText('Marina aprovou a entrada de Bia.', { exact: true }).waitFor({ state: 'visible' });
    return metrics;
  }"
  playwright-cli screenshot --full-page --filename="$OUT/management/$viewport/history.full-page.png"
}

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
      contentTabCount: document.querySelectorAll('.community-preview__tabs button').length,
      contentTabLabels: Array.from(
        document.querySelectorAll('.community-preview__tabs button span')
      ).map((label) => (label.textContent ?? '').trim()),
      managementActionCount: document.querySelectorAll(
        '.community-preview__management-actions button'
      ).length,
      managementActionLabels: Array.from(
        document.querySelectorAll('.community-preview__management-actions button span')
      ).map((label) => (label.textContent ?? '').trim()),
      duplicatedAdminRail: Array.from(
        document.querySelectorAll('.community-preview__rail-card')
      ).some((card) => (card.textContent ?? '').includes('Administração')),
      hubWidth: hubRect?.width ?? 0,
      navLabels,
      cardLabels,
      cardCount: cardLabels.length,
      hasOwnerLabel: (hub?.textContent ?? '').includes('Proprietário'),
      hasTitle: (hub?.textContent ?? '').includes('Gestão da Comunidade'),
      hasCapacity: (hub?.textContent ?? '').includes('86 de 100 integrantes'),
      heavyChildren: document.querySelectorAll(
        'app-community-member-roster-management, app-community-settings, app-community-ownership-management, app-community-admin-timeline'
      ).length,
    };
  });
  const expectedContentTabs = ['Mural', 'Fotos', 'Membros', 'Sobre'];
  const expectedManagementActions = ['Gestão', 'Convites'];
  const expectedNav = ['Visão geral', 'Solicitações', 'Participantes', 'Configurações', 'Histórico', 'Propriedade'];
  const expectedCards = ['Solicitações', 'Participantes', 'Convites', 'Configurações', 'Moderação', 'Capacidade', 'Histórico administrativo', 'Propriedade'];
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.contentTabCount !== expectedContentTabs.length
    || !expectedContentTabs.every((label) => metrics.contentTabLabels.includes(label))
    || metrics.managementActionCount !== expectedManagementActions.length
    || !expectedManagementActions.every((label) => metrics.managementActionLabels.includes(label))
    || metrics.duplicatedAdminRail
    || metrics.hubWidth < 700
    || metrics.navLabels.length !== expectedNav.length
    || !expectedNav.every((label, index) => metrics.navLabels[index] === label)
    || metrics.cardCount !== expectedCards.length
    || !expectedCards.every((label, index) => metrics.cardLabels[index] === label)
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
      'app-community-member-roster-management, app-community-settings, app-community-ownership-management, app-community-admin-timeline'
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

validate_timeline desktop

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
    const managementNav = document.querySelector('.community-preview__management-nav');
    const managementButtons = Array.from(
      document.querySelectorAll('.community-preview__management-actions button')
    );
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
      contentTabCount: document.querySelectorAll('.community-preview__tabs button').length,
      topTabLabelsVisible,
      managementNavInsideViewport: (() => {
        const rect = managementNav?.getBoundingClientRect();
        return Boolean(rect && rect.left >= -1 && rect.right <= window.innerWidth + 1);
      })(),
      managementActionCount: managementButtons.length,
      managementActionMinHeight: managementButtons.length
        ? Math.min(...managementButtons.map((button) => button.getBoundingClientRect().height))
        : 0,
      managementActionLabels: managementButtons.map(
        (button) => (button.textContent ?? '').trim()
      ),
      navCount: document.querySelectorAll('.community-management-hub__nav button').length,
      navLabels: Array.from(document.querySelectorAll('.community-management-hub__nav button'))
        .map((button) => (button.textContent ?? '').trim()),
      cardCount: cards.length,
      cardLabels: cards.map((card) => (card.querySelector('strong')?.textContent ?? '').trim()),
      cardsInsideViewport,
      hasTitle: (hub?.textContent ?? '').includes('Gestão da Comunidade'),
      heavyChildren: document.querySelectorAll(
        'app-community-member-roster-management, app-community-settings, app-community-ownership-management, app-community-admin-timeline'
      ).length,
    };
  });
  const expectedManagementActions = ['Gestão', 'Convites'];
  if (
    metrics.scrollWidth > metrics.viewportWidth + 1
    || metrics.hubWidth > metrics.viewportWidth + 1
    || metrics.contentTabCount !== 4
    || !metrics.topTabLabelsVisible
    || metrics.topTabsScrollWidth > metrics.topTabsClientWidth + 1
    || !metrics.managementNavInsideViewport
    || metrics.managementActionCount !== expectedManagementActions.length
    || !expectedManagementActions.every((label) =>
      metrics.managementActionLabels.some((value) => value.includes(label))
    )
    || metrics.managementActionMinHeight < 44
    || metrics.navCount !== ['Visão geral', 'Solicitações', 'Participantes', 'Configurações', 'Histórico', 'Propriedade'].length
    || !['Visão geral', 'Solicitações', 'Participantes', 'Configurações', 'Histórico', 'Propriedade'].every((label, index) => metrics.navLabels[index] === label)
    || metrics.cardCount !== ['Solicitações', 'Participantes', 'Convites', 'Configurações', 'Moderação', 'Capacidade', 'Histórico administrativo', 'Propriedade'].length
    || !['Solicitações', 'Participantes', 'Convites', 'Configurações', 'Moderação', 'Capacidade', 'Histórico administrativo', 'Propriedade'].every((label, index) => metrics.cardLabels[index] === label)
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

validate_timeline mobile

mkdir -p "$OUT/browser-console"
while IFS= read -r console_file; do
  cp "$console_file" "$OUT/browser-console/$(basename "$console_file")"
done < <(find .playwright-cli -type f -name 'console-*.log' -print 2>/dev/null || true)

playwright-cli close
