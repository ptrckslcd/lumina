(function () {
  'use strict';

  const STORAGE_KEY = 'lumina_guided_onboarding_done_v1';
  const AUTO_START_FALLBACK_MS = 5200;
  const CARD_PAD = 14;
  const MAX_AUTO_FOCUS_AREA_RATIO = 0.24;
  const LARGE_TARGET_WIDTH_RATIO = 0.52;
  const LARGE_TARGET_HEIGHT_RATIO = 0.44;

  const steps = [
    {
      kicker: 'Overview',
      title: 'Welcome to Lumina',
      body: 'This tour explains the important controls page by page. Use Back and Next to navigate, or Skip if you already know your flow.'
    },
    {
      kicker: 'Navigation',
      title: 'Main Tabs',
      body: 'These tabs switch between Lighting, Automations, System, Logs, and Lab. The guide will move across each one.',
      target: '.pill-tabs'
    },
    {
      kicker: 'Lighting',
      title: 'Power Controls',
      body: 'Turn On and Turn Off are your quickest manual commands for the lamp before adjusting effects.',
      tab: 'page-lighting',
      target: '#btn-lamp-on',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Lighting',
      title: 'Effect and Color Picker',
      body: 'Pick a base color and choose a curated WLED effect. This is where most visual mood changes begin.',
      tab: 'page-lighting',
      target: '#fx-grid',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Lighting',
      title: 'Brightness, Pace, and Intensity',
      body: 'Fine-tune motion and brightness here. Preset buttons are useful for quick 0%, 25%, 50%, 75%, and 100% jumps.',
      tab: 'page-lighting',
      target: '#sl-brightness',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Lighting',
      title: 'Commit Changes',
      body: 'After adjusting controls, press Commit Changes to apply the selected state immediately.',
      tab: 'page-lighting',
      target: '#btn-apply-light',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Automations',
      title: 'Weather Dashboard',
      body: 'This dashboard shows live weather, heat index, and current mapping status used to drive automatic lighting behavior.',
      tab: 'page-automations',
      target: '#weather-board'
    },
    {
      kicker: 'Automations',
      title: 'Weather Sync Controls',
      body: 'Set location override and sync interval, then click Sync Now to test weather-to-light mapping in real time.',
      tab: 'page-automations',
      target: '#btn-fetch-weather',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Automations',
      title: 'Hydration Reminder',
      body: 'Configure reminder effect, color, interval, and duration. Trigger Reminder runs a manual test instantly.',
      tab: 'page-automations',
      target: '#btn-trigger-water',
      focusClosest: '.section-group'
    },
    {
      kicker: 'System',
      title: 'Weather Credentials',
      body: 'Set your default location and OpenWeather API key here. These values power weather syncing and visual responses.',
      tab: 'page-system',
      target: '#sys-apikey-input',
      focusClosest: '.section-group'
    },
    {
      kicker: 'System',
      title: 'Startup and Active Mode',
      body: 'Choose startup behavior and switch between REST (local network) or MQTT (remote/cloud) communication.',
      tab: 'page-system',
      target: '#ui-comm-mode-group',
      focusClosest: '.section-group'
    },
    {
      kicker: 'System',
      title: 'Connection Endpoint Inputs',
      body: 'REST mode uses WLED IP, while MQTT mode uses broker, port, and topic. Fill only the active mode inputs.',
      tab: 'page-system',
      targets: ['#group-rest', '#group-mqtt'],
      focusClosest: '.section-group'
    },
    {
      kicker: 'System',
      title: 'Ping and Save',
      body: 'Ping Target validates reachability first. Save Config stores settings in local browser storage for next launch.',
      tab: 'page-system',
      target: '#btn-test-conn',
      focusClosest: '.pwr-controls'
    },
    {
      kicker: 'System',
      title: 'Countdown Timers',
      body: 'These counters show when the next weather sync and hydration reminder cycles are expected to run.',
      tab: 'page-system',
      target: '#timer-weather-cd',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Logs',
      title: 'Event Log Feed',
      body: 'Use Logs to inspect connection attempts, automation events, and diagnostics. Clear removes only local log history.',
      tab: 'page-logs',
      target: '#log-feed'
    },
    {
      kicker: 'Lab',
      title: 'Weather Preset Testing',
      body: 'Lab presets let you simulate global locations quickly to preview weather-driven visuals and mapped effects.',
      tab: 'page-lab',
      target: '#preset-grid',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Lab',
      title: 'JSON Payload Injector',
      body: 'Advanced users can send raw WLED JSON payloads here for direct hardware testing and quick debugging.',
      tab: 'page-lab',
      target: '#pi-json-input',
      focusClosest: '.section-group'
    },
    {
      kicker: 'Done',
      title: 'Replay Anytime',
      body: 'Open About and click Start Guided Onboarding whenever you want a refresher tour.',
      target: '#btn-open-info'
    }
  ];

  const state = {
    active: false,
    index: 0,
    targetEl: null,
    autoTried: false
  };

  const ui = {
    root: null,
    card: null,
    kicker: null,
    title: null,
    body: null,
    progress: null,
    btnPrev: null,
    btnNext: null,
    btnSkip: null
  };

  function query(selector) {
    return document.querySelector(selector);
  }

  function clearFocus() {
    if (state.targetEl) {
      state.targetEl.classList.remove('lumina-onboarding-focus');
      state.targetEl = null;
    }
  }

  function isElementVisible(el) {
    if (!el) return false;
    if (el.classList.contains('hidden')) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findVisibleBySelector(selector) {
    const nodes = document.querySelectorAll(selector);
    if (!nodes.length) return null;

    let fallback = null;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!fallback) fallback = node;
      if (isElementVisible(node)) return node;
    }

    return fallback;
  }

  function findStepAnchor(step) {
    const selectors = [];
    if (Array.isArray(step.targets)) selectors.push.apply(selectors, step.targets);
    if (step.target) selectors.push(step.target);

    for (let i = 0; i < selectors.length; i += 1) {
      const candidate = findVisibleBySelector(selectors[i]);
      if (candidate) return candidate;
    }

    return null;
  }

  function resolveFocusTarget(step, anchorEl) {
    let focusEl = anchorEl;

    if (focusEl && step.focusClosest) {
      const closest = focusEl.closest(step.focusClosest);
      if (closest) {
        const rect = closest.getBoundingClientRect();
        const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
        const areaRatio = (rect.width * rect.height) / viewportArea;

        if (areaRatio <= MAX_AUTO_FOCUS_AREA_RATIO) {
          focusEl = closest;
        }
      }
    }

    return focusEl;
  }

  function activateTab(pageId) {
    const tabButton = query('.tab-btn[data-page="' + pageId + '"]');
    if (tabButton) tabButton.click();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function positionCard(targetEl) {
    if (!ui.card) return;

    const cardRect = ui.card.getBoundingClientRect();
    let left = window.innerWidth - cardRect.width - CARD_PAD;
    let top = CARD_PAD;

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const isLargeTarget =
        rect.width >= window.innerWidth * LARGE_TARGET_WIDTH_RATIO ||
        rect.height >= window.innerHeight * LARGE_TARGET_HEIGHT_RATIO;

      if (isLargeTarget) {
        ui.card.style.left = window.innerWidth - cardRect.width - CARD_PAD + 'px';
        ui.card.style.top = CARD_PAD + 'px';
        return;
      }

      const belowSpace = window.innerHeight - rect.bottom;
      const preferBelow = belowSpace >= cardRect.height + 18;

      top = preferBelow ? rect.bottom + 12 : rect.top - cardRect.height - 12;
      top = clamp(top, CARD_PAD, window.innerHeight - cardRect.height - CARD_PAD);

      const putRight = rect.left < window.innerWidth * 0.55;
      left = putRight ? rect.right + 14 : rect.left - cardRect.width - 14;
      left = clamp(left, CARD_PAD, window.innerWidth - cardRect.width - CARD_PAD);
    }

    ui.card.style.left = left + 'px';
    ui.card.style.top = top + 'px';
  }

  function renderStep() {
    const step = steps[state.index];
    if (!step) return;

    clearFocus();

    if (step.tab) {
      activateTab(step.tab);
    }

    ui.kicker.textContent = step.kicker || 'Guided Onboarding';
    ui.title.textContent = step.title;
    ui.body.textContent = step.body;
    ui.progress.textContent = 'Step ' + (state.index + 1) + ' of ' + steps.length;

    ui.btnPrev.disabled = state.index === 0;
    ui.btnPrev.style.opacity = state.index === 0 ? '0.45' : '1';
    if (state.index === 0) {
      ui.btnNext.textContent = 'Start Tour';
    } else if (state.index === steps.length - 1) {
      ui.btnNext.textContent = 'Finish';
    } else {
      ui.btnNext.textContent = 'Next';
    }

    window.setTimeout(function () {
      const anchorEl = findStepAnchor(step);
      const focusEl = resolveFocusTarget(step, anchorEl);

      if (focusEl) {
        focusEl.classList.add('lumina-onboarding-focus');
        state.targetEl = focusEl;
        focusEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }

      positionCard(focusEl || anchorEl);
    }, 120);
  }

  function finish(markDone) {
    clearFocus();
    state.active = false;

    if (ui.root) {
      ui.root.classList.add('hidden');
    }

    if (markDone) {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
  }

  function nextStep() {
    if (state.index >= steps.length - 1) {
      finish(true);
      return;
    }

    state.index += 1;
    renderStep();
  }

  function prevStep() {
    if (state.index <= 0) return;
    state.index -= 1;
    renderStep();
  }

  function ensureUi() {
    if (ui.root) return;

    const root = document.createElement('div');
    root.id = 'lumina-onboarding';
    root.className = 'lumina-onboarding hidden';
    root.innerHTML = [
      '<div class="lumina-onboarding-backdrop"></div>',
      '<section class="lumina-onboarding-card" role="dialog" aria-modal="true" aria-label="Guided onboarding">',
      '<div class="lumina-onboarding-kicker">Guided Onboarding</div>',
      '<h3 class="lumina-onboarding-title"></h3>',
      '<p class="lumina-onboarding-body"></p>',
      '<div class="lumina-onboarding-progress"></div>',
      '<div class="lumina-onboarding-actions">',
      '<button type="button" class="btn-ghost" data-ob="prev">Back</button>',
      '<button type="button" class="btn-clean" data-ob="next">Next</button>',
      '<button type="button" class="btn-ghost" data-ob="skip">Skip</button>',
      '</div>',
      '</section>'
    ].join('');

    document.body.appendChild(root);

    ui.root = root;
    ui.card = root.querySelector('.lumina-onboarding-card');
    ui.kicker = root.querySelector('.lumina-onboarding-kicker');
    ui.title = root.querySelector('.lumina-onboarding-title');
    ui.body = root.querySelector('.lumina-onboarding-body');
    ui.progress = root.querySelector('.lumina-onboarding-progress');
    ui.btnPrev = root.querySelector('[data-ob="prev"]');
    ui.btnNext = root.querySelector('[data-ob="next"]');
    ui.btnSkip = root.querySelector('[data-ob="skip"]');

    ui.btnPrev.addEventListener('click', prevStep);
    ui.btnNext.addEventListener('click', nextStep);
    ui.btnSkip.addEventListener('click', function () {
      finish(true);
    });

    window.addEventListener('resize', function () {
      if (state.active) positionCard(state.targetEl);
    });

    window.addEventListener(
      'scroll',
      function () {
        if (state.active) positionCard(state.targetEl);
      },
      true
    );
  }

  function start(force) {
    ensureUi();

    if (state.active) return;
    if (!force && window.localStorage.getItem(STORAGE_KEY) === '1') return;

    state.active = true;
    state.index = 0;
    ui.root.classList.remove('hidden');
    renderStep();
  }

  function tryAutoStart() {
    if (state.autoTried) return;
    state.autoTried = true;
    start(false);
  }

  function bindStartButton() {
    const launchBtn = query('#btn-start-onboarding');
    if (!launchBtn) return;

    launchBtn.addEventListener('click', function () {
      const infoModal = query('#info-modal');
      if (infoModal) {
        infoModal.classList.add('hidden');
      }
      start(true);
    });
  }

  function init() {
    ensureUi();
    bindStartButton();

    window.addEventListener('lumina-loader-complete', function () {
      window.setTimeout(tryAutoStart, 240);
    });

    window.setTimeout(tryAutoStart, AUTO_START_FALLBACK_MS);

    window.LuminaOnboarding = {
      start: function () {
        start(true);
      },
      reset: function () {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
