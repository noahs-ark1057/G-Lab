const RAW_DB = window.__OFFICIAL_GUNDAM_CARD_DB || { cards: [], packages: [], generatedAt: "" };

const RAW_REFERENCE_DECKS = window.__TOURNAMENT_REFERENCE_DECKS || {
  generatedAt: "",
  deckCount: 0,
  decks: [],
};

const MAIN_DECK_TYPES = ["UNIT", "PILOT", "COMMAND", "BASE"];
const RESOURCE_TYPE = "RESOURCE";
const EXTRA_TYPES = ["UNIT TOKEN", "EX BASE", "EX RESOURCE"];
const STORAGE_KEY = "gundam-deck-maker-official-jp";
const PACKAGE_SHORTCUT_LIMIT = 12;
const RARITY_ORDER = ["C", "U", "R", "LR", "P"];
const FAVORITES_STORAGE_KEY = `${STORAGE_KEY}-favorites`;
const THEME_STORAGE_KEY = `${STORAGE_KEY}-theme`;
const REFERENCE_HISTORY_STORAGE_KEY = `${STORAGE_KEY}-reference-history`;
const COMPARE_LIMIT = 3;
const THEME_SWITCH_OUT_MS = 280;
const THEME_SWITCH_BG_MS = 360;
const THEME_SWITCH_IN_MS = 420;
const DECK_TYPE_ORDER = ["UNIT", "PILOT", "COMMAND", "BASE"];
const REFERENCE_HISTORY_LIMIT = 24;
let confirmAcceptHandler = null;
const TYPE_SPLIT_PATTERN = /\s*(?:\/|／|,|，|\+|＋|&|＆|\|)\s*/g;

function getDiagnosisMode(theme = loadTheme()) {
  return theme === "red" ? "colonel" : "captain";
}

function getSearchPlaceholder(theme = loadTheme()) {
  return theme === "red"
    ? "例: シャア / ファルメル / etc..."
    : "例: アムロ / ホワイトベース / etc...";
}

function getDiagnosisLabels(theme = loadTheme()) {
  if (getDiagnosisMode(theme) === "colonel") {
    return {
      mode: "colonel",
      title: "大佐一言診断",
      badge: "大佐所見",
      suggestionTitle: "大佐推奨カード",
      emptyTitle: "まだ大佐診断がない。",
      emptyBody: "デッキを組んだなら「診断する」を押すことだ。",
      freshNote: "現状デッキに対する私の所見だ。",
      staleNote: "デッキ内容が変わっている。再診断しろ。",
    };
  }

  return {
    mode: "captain",
    title: "艦長一言診断",
    badge: "艦長所見",
    suggestionTitle: "艦長提案カード",
    emptyTitle: "まだ診断に値する構成ではない。",
    emptyBody: "まずデッキを整えろ。準備ができたなら「診断する」を押してくれ。",
    freshNote: "現状デッキに対する私の所見だ。",
    staleNote: "デッキ内容が変わっている。再診断で更新しろ。",
  };
}

function createEmptyAiDiagnosis(theme = loadTheme()) {
  const labels = getDiagnosisLabels(theme);
  return {
    badge: labels.badge,
    good: "",
    caution: "",
    suggestion: "",
    suggestedCards: [],
    status: "info",
    persona: labels.mode,
    signature: "",
    createdAt: "",
  };
}

function normalizeTypeToken(value = "") {
  return String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

function parseTypeTokens(value = "") {
  return [...new Set(String(value || "").split(TYPE_SPLIT_PATTERN).map(normalizeTypeToken).filter(Boolean))];
}

function extractImplicitTypeTokens(text = "") {
  const source = String(text || "");
  const tokens = [];
  const keywordMap = [
    ["【パイロット】", "PILOT"],
    ["【コマンド】", "COMMAND"],
    ["【ベース】", "BASE"],
    ["【ユニット】", "UNIT"],
    ["[PILOT]", "PILOT"],
    ["[COMMAND]", "COMMAND"],
    ["[BASE]", "BASE"],
    ["[UNIT]", "UNIT"],
  ];
  keywordMap.forEach(([keyword, type]) => {
    if (source.includes(keyword) && !tokens.includes(type)) {
      tokens.push(type);
    }
  });
  return tokens;
}

function inferType(raw) {
  const explicitTypes = parseTypeTokens(raw.type);
  if (explicitTypes.length) return explicitTypes[0];
  if (raw.number?.startsWith("EXB-")) return "EX BASE";
  if (raw.number?.startsWith("EXR-")) return "EX RESOURCE";
  if (raw.number?.startsWith("R-")) return "RESOURCE";
  return "OTHER";
}

function inferName(raw) {
  if (raw.name && raw.name !== raw.number) return raw.name;
  if (raw.number === "R-001") return "基本リソース";
  if (raw.number?.startsWith("R-")) return "リソース";
  if (raw.number?.startsWith("EXB-")) return "EXベース";
  if (raw.number?.startsWith("EXR-")) return "EXリソース";
  return raw.name || raw.number || "Unknown Card";
}

function cleanList(list = []) {
  return (list || []).filter((item) => item && item !== "-" && item !== "・");
}

function normalizeSearchText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/\s+/g, " ")
    .trim();
}

function hasCardType(card, type) {
  const needle = normalizeTypeToken(type);
  if (!needle) return false;
  return (card?.typeTokens || [card?.type]).some((token) => normalizeTypeToken(token) === needle);
}

function normalizeCard(raw) {
  const type = inferType(raw);
  const typeTokens = [
    ...new Set(
      [
        ...(parseTypeTokens(raw.type).length ? parseTypeTokens(raw.type) : [type]),
        ...extractImplicitTypeTokens(raw.text),
      ].map(normalizeTypeToken),
    ),
  ];
  const packageInfo = raw.packages?.[0] || { id: "unknown", name: raw.whereToGet || "未分類" };
  const primaryImageUrl = raw.imageUrlLocal || raw.imageUrl || "";
  const name = inferName(raw);
  const displayColor = raw.color && raw.color !== "-" ? raw.color : "Colorless";
  const title = raw.sourceTitle || "未分類";
  const traits = cleanList(raw.traits);
  const links = cleanList(raw.links);
  const zones = cleanList(raw.zones);
  const variants = (raw.variants || [])
    .filter((variant) => variant?.imageUrl)
    .map((variant) => ({
      detailId: variant.detailId,
      label: variant.label || "通常",
      imageUrl: variant.imageUrlLocal || variant.imageUrl,
    }));

  if (!variants.length && primaryImageUrl) {
    variants.push({
      detailId: raw.detailId || raw.id,
      label: "通常",
      imageUrl: primaryImageUrl,
    });
  }

  return {
    ...raw,
    id: raw.id,
    number: raw.number || raw.id,
    name,
    type,
    typeTokens,
    color: displayColor,
    displayColor,
    packageId: packageInfo.id,
    packageName: packageInfo.name,
    title,
    rarity: raw.rarity || "-",
    block: raw.block || "-",
    level: Number.isInteger(raw.level) ? raw.level : null,
    cost: Number.isInteger(raw.cost) ? raw.cost : null,
    ap: Number.isInteger(raw.ap) ? raw.ap : null,
    hp: Number.isInteger(raw.hp) ? raw.hp : null,
    text: raw.text || "",
    traits,
    links,
    zones,
    faq: raw.faq || [],
    imageUrl: primaryImageUrl || variants[0]?.imageUrl || "",
    variants,
    isMainDeckCard: typeTokens.some((token) => MAIN_DECK_TYPES.includes(token)),
    isResourceCard: typeTokens.some((token) => token === RESOURCE_TYPE),
    isExtraCard: typeTokens.some((token) => EXTRA_TYPES.includes(token)) || type === "OTHER",
    isBasicResource: raw.number === "R-001",
    searchHaystack: normalizeSearchText(
      [
        raw.number || raw.id,
        name,
        packageInfo.name,
        title,
        ...typeTokens,
        displayColor,
        raw.rarity || "-",
        raw.text || "",
        ...traits,
        ...links,
        ...zones,
      ].join(" "),
    ),
    normalizedNumber: normalizeSearchText(raw.number || raw.id),
    normalizedName: normalizeSearchText(name),
    normalizedPackageName: normalizeSearchText(packageInfo.name),
    normalizedTitle: normalizeSearchText(title),
    normalizedType: normalizeSearchText(typeTokens.join(" ")),
    normalizedTypes: typeTokens.map((token) => normalizeSearchText(token)),
    normalizedColor: normalizeSearchText(displayColor),
    normalizedRarity: normalizeSearchText(raw.rarity || "-"),
    normalizedText: normalizeSearchText(raw.text || ""),
    normalizedTraits: traits.map((item) => normalizeSearchText(item)),
    normalizedLinks: links.map((item) => normalizeSearchText(item)),
    normalizedZones: zones.map((item) => normalizeSearchText(item)),
  };
}

const PACKAGE_ORDER = new Map(RAW_DB.packages.map((pkg, index) => [pkg.id, index]));
const ALL_CARDS = RAW_DB.cards.map(normalizeCard);
const CARD_LOOKUP = new Map(ALL_CARDS.map((card) => [card.id, card]));
const CARD_BY_NUMBER = new Map();
ALL_CARDS.forEach((card) => {
  if (card.number && !CARD_BY_NUMBER.has(card.number)) {
    CARD_BY_NUMBER.set(card.number, card);
  }
});

const TITLE_COUNTS = countValues(ALL_CARDS.map((card) => card.title).filter(Boolean));
const TRAIT_COUNTS = countValues(ALL_CARDS.flatMap((card) => card.traits));
const RARITIES = [...new Set(ALL_CARDS.map((card) => card.rarity).filter((value) => value && value !== "-"))].sort(
  compareRarity,
);
const COLORS = uniqueSorted(
  ALL_CARDS.map((card) => card.displayColor).filter((value) => value && value !== "Colorless"),
);
const TYPES = uniqueSorted(ALL_CARDS.flatMap((card) => card.typeTokens).filter(Boolean));
const TITLES = [...TITLE_COUNTS.entries()]
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
  .map(([title]) => title);
const TRAITS = [...TRAIT_COUNTS.entries()]
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
  .slice(0, 28)
  .map(([trait]) => trait);
const LEVEL_VALUES = Array.from({ length: 8 }, (_, index) => String(index + 1));
const COST_VALUES = Array.from({ length: 8 }, (_, index) => String(index + 1));
const AP_VALUES = Array.from({ length: 6 }, (_, index) => String(index + 1));
const HP_VALUES = Array.from({ length: 7 }, (_, index) => String(index + 1));

const state = {
  dbLoaded: ALL_CARDS.length > 0,
  query: "",
  sort: "featured",
  view: "grid",
  mobileView: "side",
  isFilterDrawerOpen: false,
  isSideDrawerOpen: false,
  isDetailDrawerOpen: false,
  onlyFavorites: false,
  activeDeckZone: "main",
  quickAddTarget: "main",
  activeTab: "deck",
  detailReturnView: "side",
  detailReturnTab: "deck",
  preset: "",
  showExtras: false,
  theme: loadTheme(),
  curvePage: "level",
  favorites: loadFavorites(),
  compareIds: [],
  selectedCardId: ALL_CARDS.find((card) => card.isMainDeckCard)?.id || ALL_CARDS[0]?.id || null,
  selectedVariantByCard: {},
  filters: {
    packages: new Set(),
    colors: new Set(),
    types: new Set(),
    levels: new Set(),
    costs: new Set(),
    aps: new Set(),
    hps: new Set(),
    titles: new Set(),
    rarities: new Set(),
    traits: new Set(),
  },
  deck: {
    id: `deck-${Date.now()}`,
    name: "青白サンプル構築",
    note: "公式JPカードDBを使った初期サンプル。ここから差し替えていけます。",
    main: [],
    token: [],
    resource: [],
  },
  openingHand: [],
  savedDecks: loadSavedDecks(),
  referenceHistory: loadReferenceHistory(),
  lastCheck: null,
  aiDiagnosis: createEmptyAiDiagnosis(),
  referenceDeckZones: {},
  cloud: {
    configured: false,
    ready: false,
    authBusy: false,
    status: "local",
    statusMessage: "この端末だけに保存されています。",
    user: null,
    lastSyncedAt: "",
  },
  dragState: null,
};

const elements = {
  dbSourceCount: document.getElementById("dbSourceCount"),
  dbStamp: document.getElementById("dbStamp"),
  themeToggleButton: document.getElementById("themeToggleButton"),
  searchInput: document.getElementById("searchInput"),
  resetFiltersButton: document.getElementById("resetFiltersButton"),
  quickAddTarget: document.getElementById("quickAddTarget"),
  catalogSort: document.getElementById("catalogSort"),
  showExtraCards: document.getElementById("showExtraCards"),
  packageFilters: document.getElementById("packageFilters"),
  colorFilters: document.getElementById("colorFilters"),
  typeFilters: document.getElementById("typeFilters"),
  levelFilters: document.getElementById("levelFilters"),
  costFilters: document.getElementById("costFilters"),
  apFilters: document.getElementById("apFilters"),
  hpFilters: document.getElementById("hpFilters"),
  titleFilters: document.getElementById("titleFilters"),
  rarityFilters: document.getElementById("rarityFilters"),
  traitFilters: document.getElementById("traitFilters"),
  workspace: document.querySelector(".workspace"),
  filtersPanel: document.querySelector(".filters-panel"),
  catalogPanel: document.querySelector(".catalog-panel"),
  sidePanel: document.querySelector(".side-panel"),
  cardCatalog: document.getElementById("cardCatalog"),
  resultCount: document.getElementById("resultCount"),
  resultLabel: document.getElementById("resultLabel"),
  activeFilterSummary: document.getElementById("activeFilterSummary"),
  mainDeckCounter: document.getElementById("mainDeckCounter"),
  tokenDeckCounter: document.getElementById("tokenDeckCounter"),
  colorCounter: document.getElementById("colorCounter"),
  validationCounter: document.getElementById("validationCounter"),
  mobileFilterButton: document.getElementById("mobileFilterButton"),
  mobileFilterFab: document.getElementById("mobileFilterFab"),
  desktopFilterButton: document.getElementById("desktopFilterButton"),
  closeFiltersButton: document.getElementById("closeFiltersButton"),
  mobileDrawerBackdrop: document.getElementById("mobileDrawerBackdrop"),
  mobileBottomFilterButton: document.getElementById("mobileBottomFilterButton"),
  mobileDeckFab: document.getElementById("mobileDeckFab"),
  mobileCompareFab: document.getElementById("mobileCompareFab"),
  mobileCompareCount: document.getElementById("mobileCompareCount"),
  mobileTopFab: document.getElementById("mobileTopFab"),
  backToTopButton: document.getElementById("backToTopButton"),
  deckNameInput: document.getElementById("deckNameInput"),
  deckNoteInput: document.getElementById("deckNoteInput"),
  mainDeckList: document.getElementById("mainDeckList"),
  mainZoneSummary: document.getElementById("mainZoneSummary"),
  tokenDeckList: document.getElementById("tokenDeckList"),
  deckZoneTabs: [...document.querySelectorAll("[data-deck-zone]")],
  deckInsights: document.getElementById("deckInsights"),
  deckDiagnosticSummary: document.getElementById("deckDiagnosticSummary"),
  curveChart: document.getElementById("curveChart"),
  curveTypeChart: document.getElementById("curveTypeChart"),
  curvePages: document.getElementById("curvePages"),
  inspectorPanel: document.querySelector(".inspector-panel"),
  selectedCardDetails: document.getElementById("selectedCardDetails"),
  detailModal: null,
  detailModalContent: null,
  detailModalClose: null,
  detailDrawerClose: null,
  favoriteOnlyToggle: null,
  favoriteCount: null,
  compareSummary: null,
  openCompareButton: null,
  clearCompareButton: null,
  compareModal: null,
  compareModalContent: null,
  compareModalClose: null,
  imagePreviewModal: document.getElementById("imagePreviewModal"),
  imagePreviewClose: document.getElementById("imagePreviewClose"),
  imagePreviewImage: document.getElementById("imagePreviewImage"),
  imagePreviewTitle: document.getElementById("imagePreviewTitle"),
  imagePreviewCode: document.getElementById("imagePreviewCode"),
  drawOpeningHandButton: document.getElementById("drawOpeningHandButton"),
  openingHand: document.getElementById("openingHand"),
  checkPreset: document.getElementById("checkPreset"),
  focusCards: document.getElementById("focusCards"),
  focusRequireAll: document.getElementById("focusRequireAll"),
  requireBaseToggle: document.getElementById("requireBaseToggle"),
  runCheckButton: document.getElementById("runCheckButton"),
  checkResult: document.getElementById("checkResult"),
  sortDeckButton: document.getElementById("sortDeckButton"),
  sortDeckMenu: document.getElementById("sortDeckMenu"),
  sortDeckByLevelButton: document.getElementById("sortDeckByLevelButton"),
  sortDeckByTypeButton: document.getElementById("sortDeckByTypeButton"),
  copyDecklistButton: document.getElementById("copyDecklistButton"),
  clearDeckButton: document.getElementById("clearDeckButton"),
  toggleReferenceDecksButton: document.getElementById("toggleReferenceDecksButton"),
  referenceDeckCountBadge: document.getElementById("referenceDeckCountBadge"),
  referenceDecksBox: document.getElementById("referenceDecksBox"),
  referenceModal: null,
  referenceModalDialog: null,
  referenceModalClose: null,
  referenceDecksModalCount: null,
  referenceDecksFetchedAt: document.getElementById("referenceDecksFetchedAt"),
  referenceDecksList: document.getElementById("referenceDecksList"),
  runAiDiagnosisButton: document.getElementById("runAiDiagnosisButton"),
  aiDiagnosisResult: document.getElementById("aiDiagnosisResult"),
  aiDiagnosisTitle: document.querySelector(".ai-diagnosis-head h3"),
  saveDeckButton: document.getElementById("saveDeckButton"),
  duplicateDeckButton: document.getElementById("duplicateDeckButton"),
  copyShareButton: document.getElementById("copyShareButton"),
  exportDeckButton: document.getElementById("exportDeckButton"),
  importDeckInput: document.getElementById("importDeckInput"),
  cloudSyncBadge: document.getElementById("cloudSyncBadge"),
  cloudSyncMessage: document.getElementById("cloudSyncMessage"),
  cloudUserMeta: document.getElementById("cloudUserMeta"),
  cloudUserEmail: document.getElementById("cloudUserEmail"),
  cloudLastSyncText: document.getElementById("cloudLastSyncText"),
  cloudEmailInput: document.getElementById("cloudEmailInput"),
  cloudPasswordInput: document.getElementById("cloudPasswordInput"),
  cloudSignInButton: document.getElementById("cloudSignInButton"),
  cloudRegisterButton: document.getElementById("cloudRegisterButton"),
  cloudSignOutButton: document.getElementById("cloudSignOutButton"),
  cloudDeckCount: document.getElementById("cloudDeckCount"),
  cloudFavoriteCount: document.getElementById("cloudFavoriteCount"),
  cloudHistoryCount: document.getElementById("cloudHistoryCount"),
  savedDeckList: document.getElementById("savedDeckList"),
  starterList: document.getElementById("starterList"),
  confirmModal: document.getElementById("confirmModal"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmMessage: document.getElementById("confirmMessage"),
  confirmCancelButton: document.getElementById("confirmCancelButton"),
  confirmAcceptButton: document.getElementById("confirmAcceptButton"),
};

function setupDeckZoneUI() {
  if (elements.quickAddTarget) {
    elements.quickAddTarget.innerHTML = `
      <option value="main">メインデッキ</option>
      <option value="token">トークン</option>
    `;
  }

  const heroBadges = document.querySelectorAll(".hero-badges span");
  if (heroBadges[2]) {
    heroBadges[2].textContent = "Token / EX support";
  }

  const mainDeckSection = elements.mainDeckList?.closest(".deck-zone");
  const mainDeckHead = mainDeckSection?.querySelector(".deck-zone-head");
  const mainDeckTitle = mainDeckHead?.querySelector("h3");
  const resourceDeckSection = document.getElementById("resourceDeckList")?.closest(".deck-zone");

  if (mainDeckSection && mainDeckHead && mainDeckTitle && !mainDeckHead.querySelector(".deck-zone-tabbar")) {
    const tabbar = document.createElement("div");
    tabbar.className = "deck-zone-tabbar";
    tabbar.setAttribute("role", "tablist");
    tabbar.setAttribute("aria-label", "Deck zones");
    tabbar.innerHTML = `
      <button class="deck-zone-tab is-active" data-deck-zone="main" type="button">メイン</button>
      <button class="deck-zone-tab" data-deck-zone="token" type="button">トークン</button>
    `;
    mainDeckTitle.replaceWith(tabbar);
  }

  if (mainDeckSection && !document.getElementById("tokenDeckList")) {
    const tokenDeckList = document.createElement("div");
    tokenDeckList.id = "tokenDeckList";
    tokenDeckList.className = "deck-list deck-zone-panel";
    tokenDeckList.dataset.zonePanel = "token";
    mainDeckSection.appendChild(tokenDeckList);
    elements.tokenDeckList = tokenDeckList;
  }

  if (elements.mainDeckList) {
    elements.mainDeckList.classList.add("deck-zone-panel");
    elements.mainDeckList.dataset.zonePanel = "main";
  }

  if (mainDeckSection && elements.mainDeckList && elements.tokenDeckList && !mainDeckSection.querySelector(".deck-zone-pages")) {
    const pages = document.createElement("div");
    pages.className = "deck-zone-pages";
    pages.dataset.deckZone = "main";
    const track = document.createElement("div");
    track.className = "deck-zone-pages-track";
    elements.mainDeckList.replaceWith(pages);
    track.appendChild(elements.mainDeckList);
    track.appendChild(elements.tokenDeckList);
    pages.appendChild(track);
    mainDeckSection.appendChild(pages);
  }

  resourceDeckSection?.remove();
  elements.deckZoneTabs = [...document.querySelectorAll("[data-deck-zone]")];
}

function setupDetailUI() {
  if (!document.getElementById("detailModal")) {
    const modal = document.createElement("div");
    modal.id = "detailModal";
    modal.className = "detail-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="detail-modal-dialog" role="dialog" aria-modal="true" aria-label="カード詳細">
        <button id="detailModalClose" class="detail-modal-close" type="button" aria-label="詳細を閉じる">
          &times;
        </button>
        <div id="detailModalContent" class="detail-modal-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  elements.detailModal = document.getElementById("detailModal");
  elements.detailModalContent = document.getElementById("detailModalContent");
  elements.detailModalClose = document.getElementById("detailModalClose");

  const inspectorHead = elements.inspectorPanel?.querySelector(".panel-head");
  if (inspectorHead && !document.getElementById("detailDrawerClose")) {
    const actions = document.createElement("div");
    actions.className = "panel-head-actions";
    actions.innerHTML = `
      <button id="detailDrawerClose" class="ghost-button mobile-only-button" type="button">
        閉じる
      </button>
    `;
    inspectorHead.appendChild(actions);
  }

  elements.detailDrawerClose = document.getElementById("detailDrawerClose");
  if (elements.detailDrawerClose) {
    elements.detailDrawerClose.textContent = "戻る";
    elements.detailDrawerClose.setAttribute("aria-label", "前の画面に戻る");
    elements.detailDrawerClose.setAttribute("title", "前の画面に戻る");
  }
}

function setupEnhancementUI() {
  elements.starterList?.closest(".save-subsection")?.remove();
  elements.backToTopButton?.remove();
  elements.closeFiltersButton?.remove();
  if (elements.searchInput) {
    elements.searchInput.placeholder = getSearchPlaceholder(state.theme);
  }
  if (elements.resetFiltersButton) {
    elements.resetFiltersButton.textContent = "リセット";
  }
  if (elements.desktopFilterButton) {
    elements.desktopFilterButton.textContent = "⌕";
    elements.desktopFilterButton.setAttribute("aria-label", "カード検索を開く");
    elements.desktopFilterButton.setAttribute("title", "カード検索を開く");
  }
  if (elements.mobileFilterFab) {
    elements.mobileFilterFab.textContent = "⌕";
    elements.mobileFilterFab.setAttribute("aria-label", "カード検索を開く");
    elements.mobileFilterFab.setAttribute("title", "カード検索を開く");
  }
  if (elements.mobileTopFab) {
    elements.mobileTopFab.textContent = "↑";
    elements.mobileTopFab.setAttribute("aria-label", "TOPに戻る");
    elements.mobileTopFab.setAttribute("title", "TOPに戻る");
  }
  if (elements.mobileDeckFab) {
    elements.mobileDeckFab.innerHTML = `
      <svg class="mobile-fab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="11" cy="11" r="5.5" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M15.4 15.4 20 20" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
      </svg>
    `;
    elements.mobileDeckFab.setAttribute("aria-label", "カード一覧を開く");
    elements.mobileDeckFab.setAttribute("title", "カード一覧を開く");
  }
  if (elements.mobileCompareFab) {
    elements.mobileCompareFab.setAttribute("aria-label", "カード比較を開く");
    elements.mobileCompareFab.setAttribute("title", "カード比較を開く");
  }
  document.querySelectorAll(".catalog-panel .kicker, .filters-panel .kicker, .deck-panel-head .kicker, .compare-modal-head .kicker").forEach((node) => node.remove());
  document.querySelectorAll('.view-button[data-view="grid"]').forEach((button) => {
    button.textContent = "グリッド";
  });
  document.querySelectorAll('.view-button[data-view="list"]').forEach((button) => {
    button.textContent = "リスト";
  });

  const savePanelTitle = document.querySelector('#tab-save .panel-head.compact h2');
  if (savePanelTitle) {
    savePanelTitle.textContent = "保存 / 共有";
  }

  const cloudTitle = document.querySelector(".cloud-sync-head h3");
  if (cloudTitle) {
    cloudTitle.textContent = "クラウド同期";
  }
  if (elements.cloudSyncMessage) {
    elements.cloudSyncMessage.textContent =
      "Supabase を設定すると、保存デッキ・お気に入り・テーマ・参考デッキ履歴をユーザーごとに同期できます。";
  }
  if (elements.cloudSyncBadge) {
    elements.cloudSyncBadge.textContent = "ローカル";
  }
  if (elements.cloudUserEmail) {
    elements.cloudUserEmail.textContent = "未ログイン";
  }
  if (elements.cloudLastSyncText) {
    elements.cloudLastSyncText.textContent = "最終同期 --";
  }
  if (elements.cloudEmailInput) {
    elements.cloudEmailInput.placeholder = "name@example.com";
    const label = elements.cloudEmailInput.closest(".field")?.querySelector("span");
    if (label) label.textContent = "メールアドレス";
  }
  if (elements.cloudPasswordInput) {
    elements.cloudPasswordInput.placeholder = "6文字以上";
    const label = elements.cloudPasswordInput.closest(".field")?.querySelector("span");
    if (label) label.textContent = "パスワード";
  }
  if (elements.cloudSignInButton) {
    elements.cloudSignInButton.textContent = "ログイン";
  }
  if (elements.cloudRegisterButton) {
    elements.cloudRegisterButton.textContent = "新規登録";
  }
  if (elements.cloudSignOutButton) {
    elements.cloudSignOutButton.textContent = "ログアウト";
  }
  const cloudStatLabels = document.querySelectorAll(".cloud-sync-stat span");
  if (cloudStatLabels[0]) cloudStatLabels[0].textContent = "保存デッキ";
  if (cloudStatLabels[1]) cloudStatLabels[1].textContent = "お気に入り";
  if (cloudStatLabels[2]) cloudStatLabels[2].textContent = "参考履歴";
  if (elements.saveDeckButton) {
    elements.saveDeckButton.textContent = "ローカル保存";
  }
  if (elements.duplicateDeckButton) {
    elements.duplicateDeckButton.textContent = "複製保存";
  }
  if (elements.copyShareButton) {
    elements.copyShareButton.textContent = "共有URLをコピー";
  }
  if (elements.exportDeckButton) {
    elements.exportDeckButton.textContent = "JSONを書き出し";
  }
  const importButton = elements.importDeckInput?.closest(".import-button");
  if (importButton) {
    importButton.childNodes[0].textContent = "JSON読込";
  }

  const searchField = elements.searchInput?.closest(".field");
  document.getElementById("searchHint")?.remove();

  if (elements.filtersPanel && !document.getElementById("favoriteTools")) {
    const controls = document.createElement("section");
    controls.id = "favoriteTools";
    controls.className = "favorite-tools";
    controls.innerHTML = `
      <label class="toggle-row favorite-toggle-row">
        <span class="toggle-wrap">
          <input id="favoriteOnlyToggle" type="checkbox" />
          <span>お気に入りのみ表示</span>
        </span>
        <span id="favoriteCount" class="mini-count">0件</span>
      </label>
    `;
    const target = searchField?.nextElementSibling;
    if (target) {
      target.before(controls);
    } else {
      elements.filtersPanel.appendChild(controls);
    }
  }

  const catalogHead = elements.catalogPanel?.querySelector(".panel-head");
  if (catalogHead && !document.getElementById("catalogCompareBar")) {
    const compareBar = document.createElement("div");
    compareBar.id = "catalogCompareBar";
    compareBar.className = "catalog-comparebar";
    compareBar.innerHTML = `
      <span id="compareSummary">比較 0 / ${COMPARE_LIMIT}</span>
      <div class="panel-head-actions">
        <button id="openCompareButton" class="ghost-button" type="button">比較を見る</button>
        <button id="clearCompareButton" class="ghost-button" type="button">クリア</button>
      </div>
    `;
    catalogHead.insertAdjacentElement("afterend", compareBar);
  }

  if (!document.getElementById("compareModal")) {
    const modal = document.createElement("div");
    modal.id = "compareModal";
    modal.className = "compare-modal";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML = `
        <div class="compare-modal-dialog" role="dialog" aria-modal="true" aria-label="カード比較">
          <div class="compare-modal-head">
            <div>
              <h2>カード比較</h2>
            </div>
            <button id="compareModalClose" class="compare-modal-close" type="button" aria-label="比較を閉じる">&times;</button>
          </div>
        <div id="compareModalContent" class="compare-modal-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  if (!document.getElementById("referenceModal")) {
    const modal = document.createElement("div");
    modal.id = "referenceModal";
    modal.className = "compare-modal reference-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="compare-modal-dialog reference-modal-dialog" role="dialog" aria-modal="true" aria-label="大会入賞デッキ参考">
        <div class="compare-modal-head reference-modal-head">
          <div class="reference-modal-title">
            <p class="kicker">Reference</p>
            <div class="reference-modal-title-row">
              <h2>大会入賞デッキ参考</h2>
              <span id="referenceDecksModalCount" class="reference-modal-count">0件</span>
            </div>
            <p class="reference-modal-meta">データ取得日時 <strong id="referenceDecksFetchedAt">--</strong></p>
          </div>
          <button id="referenceModalClose" class="compare-modal-close reference-modal-close" type="button" aria-label="参考デッキを閉じる">&times;</button>
        </div>
        <div id="referenceDecksList" class="reference-list reference-modal-content"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  elements.referenceDecksBox?.remove();

  elements.favoriteOnlyToggle = document.getElementById("favoriteOnlyToggle");
  elements.favoriteCount = document.getElementById("favoriteCount");
  elements.compareSummary = document.getElementById("compareSummary");
  elements.openCompareButton = document.getElementById("openCompareButton");
  elements.clearCompareButton = document.getElementById("clearCompareButton");
  elements.compareModal = document.getElementById("compareModal");
  elements.compareModalContent = document.getElementById("compareModalContent");
  elements.compareModalClose = document.getElementById("compareModalClose");
  elements.referenceModal = document.getElementById("referenceModal");
  elements.referenceModalDialog = elements.referenceModal?.querySelector(".reference-modal-dialog") || null;
  elements.referenceModalClose = document.getElementById("referenceModalClose");
  elements.referenceDecksModalCount = document.getElementById("referenceDecksModalCount");
  elements.referenceDecksFetchedAt = document.getElementById("referenceDecksFetchedAt");
  elements.referenceDecksList = document.getElementById("referenceDecksList");
  setupFilterAccordions();
  setupAccordionUI();

  [
    { selector: ".filters-panel", key: "filters" },
    { selector: ".catalog-panel", key: "catalog" },
    { selector: "#tab-sim", key: "side" },
    { selector: "#tab-save", key: "side" },
    { selector: ".inspector-panel", key: "detail" },
  ].forEach(({ selector, key }) => {
    const container = document.querySelector(selector);
    if (!container || container.querySelector(".section-top-button-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "section-top-button-wrap";
    container.appendChild(wrap);
    const topButton = document.createElement("button");
    topButton.className = "section-top-button";
    topButton.dataset.scrollTarget = key;
    wrap.replaceChildren(topButton);
    if (topButton) {
      topButton.setAttribute("aria-label", "Back to top");
      topButton.setAttribute("title", "Back to top");
      topButton.setAttribute("type", "button");
      topButton.textContent = "↑";
    }
  });
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function closeFilterDrawer() {
  state.isFilterDrawerOpen = false;
}

function openFilterDrawer() {
  if (isMobileViewport()) {
    closeDetailDrawer();
    state.mobileView = "catalog";
    state.isSideDrawerOpen = true;
    elements.filtersPanel?.scrollTo({ top: 0, behavior: "auto" });
  }
  state.isFilterDrawerOpen = true;
}

function closeSideDrawer() {
  state.isSideDrawerOpen = false;
  if (isMobileViewport()) {
    state.mobileView = "side";
  }
}

function openSideDrawer() {
  if (!isMobileViewport()) return;
  closeFilterDrawer();
  closeDetailDrawer();
  state.mobileView = "catalog";
  state.isSideDrawerOpen = true;
  elements.catalogPanel?.scrollTo({ top: 0, behavior: "auto" });
}

function closeDetailDrawer() {
  state.isDetailDrawerOpen = false;
}

function openDetailDrawer() {
  if (!isMobileViewport()) return;
  closeFilterDrawer();
  closeSideDrawer();
  state.isDetailDrawerOpen = true;
}

function rememberDetailReturn(view = "catalog", tab = state.activeTab) {
  state.detailReturnView = view;
  state.detailReturnTab = tab;
}

function restoreFromDetailDrawer() {
  if (!isMobileViewport()) {
    closeDetailDrawer();
    return;
  }
  const returnView = state.detailReturnView || "side";
  const returnTab = state.detailReturnTab || "deck";
  state.isDetailDrawerOpen = false;
  closeFilterDrawer();
  if (returnView === "side") {
    state.mobileView = "side";
    state.activeTab = returnTab;
    closeSideDrawer();
    renderTabs();
    renderMobileState();
    return;
  }
  state.mobileView = "catalog";
  state.isSideDrawerOpen = true;
  renderTabs();
  renderMobileState();
}

function setMobileView(view) {
  state.mobileView = view;
  if (view !== "filters") {
    closeFilterDrawer();
  }
  if (view !== "catalog") {
    closeSideDrawer();
  } else if (isMobileViewport()) {
    state.isSideDrawerOpen = true;
  }
  if (view !== "detail") {
    closeDetailDrawer();
  }
}

function setActiveDeckZone(zone, { syncTarget = true } = {}) {
  state.activeDeckZone = zone;
  if (syncTarget) {
    state.quickAddTarget = zone;
  }
}

function openImagePreview(card, variant = getCardVariant(card)) {
  if (!card || !variant?.imageUrl || !elements.imagePreviewModal || !elements.imagePreviewImage) return;
  elements.imagePreviewImage.src = variant.imageUrl;
  elements.imagePreviewImage.alt = card.name;
  if (elements.imagePreviewTitle) {
    elements.imagePreviewTitle.textContent = card.name;
  }
  if (elements.imagePreviewCode) {
    elements.imagePreviewCode.textContent = card.number || "";
  }
  elements.imagePreviewModal.classList.add("is-open");
  elements.imagePreviewModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-image-preview-open");
}

function closeImagePreview() {
  if (!elements.imagePreviewModal) return;
  elements.imagePreviewModal.classList.remove("is-open");
  elements.imagePreviewModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-image-preview-open");
}

function openDetailModal() {
  if (!elements.detailModal || isMobileViewport()) return;
  elements.detailModal.classList.add("is-open");
  elements.detailModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-detail-modal-open");
}

function closeDetailModal() {
  if (!elements.detailModal) return;
  elements.detailModal.classList.remove("is-open");
  elements.detailModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-detail-modal-open");
}

function setupAccordionUI() {
  document.querySelectorAll(".accordion-box").forEach((details) => {
    if (details.dataset.accordionReady === "true") return;
    const summary = details.querySelector(".accordion-summary");
    const body = details.querySelector(".accordion-body");
    if (!summary || !body) return;

    const syncBodyState = (expanded) => {
      details.dataset.expanded = expanded ? "true" : "false";
      body.style.height = expanded ? "auto" : "0px";
    };

    const animateAccordion = (expanded) => {
      if (details.dataset.animating === "true") return;
      details.dataset.animating = "true";
      body.style.overflow = "hidden";

      if (expanded) {
        details.open = true;
        details.dataset.expanded = "true";
        body.style.height = "0px";
        void body.offsetHeight;
        requestAnimationFrame(() => {
          const targetHeight = body.scrollHeight;
          requestAnimationFrame(() => {
            body.style.height = `${targetHeight}px`;
          });
        });
      } else {
        body.style.height = `${body.scrollHeight}px`;
        void body.offsetHeight;
        requestAnimationFrame(() => {
          details.dataset.expanded = "false";
          body.style.height = "0px";
        });
      }

      const handleEnd = (event) => {
        if (event.propertyName !== "height") return;
        body.removeEventListener("transitionend", handleEnd);
        if (!expanded) {
          details.open = false;
        }
        body.style.height = expanded ? "auto" : "0px";
        body.style.overflow = "";
        details.dataset.animating = "false";
      };

      body.addEventListener("transitionend", handleEnd);
    };

    summary.addEventListener("click", (event) => {
      event.preventDefault();
      animateAccordion(!details.open);
    });

    syncBodyState(details.open);
    details.dataset.accordionReady = "true";
  });
}

function openConfirmModal({
  title = "確認",
  message = "この操作を実行しますか？",
  acceptLabel = "実行",
  onAccept = null,
} = {}) {
  if (!elements.confirmModal) return;
  if (elements.confirmTitle) elements.confirmTitle.textContent = title;
  if (elements.confirmMessage) elements.confirmMessage.textContent = message;
  if (elements.confirmAcceptButton) elements.confirmAcceptButton.textContent = acceptLabel;
  confirmAcceptHandler = onAccept;
  elements.confirmModal.classList.add("is-open");
  elements.confirmModal.setAttribute("aria-hidden", "false");
}

function closeConfirmModal() {
  if (!elements.confirmModal) return;
  elements.confirmModal.classList.remove("is-open");
  elements.confirmModal.setAttribute("aria-hidden", "true");
  confirmAcceptHandler = null;
}

function scrollToTopTarget(target, behavior = "smooth") {
  if (!target) return;
  if (target === window) {
    window.scrollTo({ top: 0, behavior });
    return;
  }
  if (typeof target.scrollTo !== "function") return;
  target.scrollTo({ top: 0, behavior });
}

function scrollAllViewsToTop() {
  const activeSidePanel = elements.sidePanel?.querySelector(".tab-panel.is-active");
  [
    activeSidePanel,
    elements.sidePanel,
    elements.filtersPanel,
    elements.catalogPanel,
    elements.inspectorPanel,
    elements.detailModalContent,
    elements.compareModalContent,
    elements.referenceModalDialog,
  ].forEach((target) => scrollToTopTarget(target));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getSectionScrollTarget(key) {
  switch (key) {
    case "catalog":
      return isMobileViewport() ? window : elements.catalogPanel;
    case "filters":
      return elements.filtersPanel;
    case "side":
      return elements.sidePanel;
    case "detail":
      return isMobileViewport() ? elements.inspectorPanel : window;
    default:
      return window;
  }
}

function getScrollTopForTarget(target) {
  if (!target) return 0;
  if (target === window) {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }
  return target.scrollTop || 0;
}

function getActiveMobileTopTarget() {
  if (!isMobileViewport()) return window;
  if (document.body.classList.contains("is-compare-modal-open")) return elements.compareModalContent || window;
  if (document.body.classList.contains("is-reference-modal-open")) return elements.referenceModalDialog || window;
  if (document.body.classList.contains("is-detail-modal-open")) return elements.detailModalContent || window;
  if (state.isDetailDrawerOpen) return elements.inspectorPanel || window;
  if (state.isSideDrawerOpen) return elements.catalogPanel || window;
  if (state.isFilterDrawerOpen) return elements.filtersPanel || window;
  return window;
}

function isSectionButtonContextVisible(button) {
  const tabPanel = button.closest(".tab-panel");
  if (tabPanel && !tabPanel.classList.contains("is-active")) return false;

  if (button.closest(".filters-panel")) {
    return !isMobileViewport() ? state.isFilterDrawerOpen : state.isFilterDrawerOpen;
  }

  if (isMobileViewport()) {
    if (button.closest(".side-panel")) return !state.isFilterDrawerOpen && !state.isDetailDrawerOpen;
    if (button.closest(".inspector-panel")) return state.isDetailDrawerOpen;
    if (button.closest(".catalog-panel")) {
      return state.isSideDrawerOpen;
    }
  }

  return true;
}

function updateSectionTopButtons() {
  document.querySelectorAll(".section-top-button").forEach((button) => {
    const target = getSectionScrollTarget(button.dataset.scrollTarget || "");
    const isVisible = isSectionButtonContextVisible(button) && getScrollTopForTarget(target) > 36;
    button.classList.toggle("is-visible", isVisible);
    button.setAttribute("aria-hidden", isVisible ? "false" : "true");
  });

  if (elements.mobileTopFab) {
    const isVisible = isMobileViewport() && getScrollTopForTarget(getActiveMobileTopTarget()) > 36;
    elements.mobileTopFab.classList.toggle("is-visible", isVisible);
    elements.mobileTopFab.setAttribute("aria-hidden", isVisible ? "false" : "true");
  }
}

function syncDesktopPanelLayout() {
  if (!elements.workspace) return;
  if (isMobileViewport()) {
    elements.workspace.style.removeProperty("--desktop-panel-height");
    return;
  }
  const top = elements.workspace.getBoundingClientRect().top;
  const availableHeight = window.innerHeight - Math.max(12, top) - 12;
  elements.workspace.style.setProperty("--desktop-panel-height", `${Math.max(420, Math.round(availableHeight))}px`);
}

function focusCard(cardId, mobileView = "detail") {
  state.selectedCardId = cardId;
  if (isMobileViewport()) {
    setMobileView(mobileView);
  }
}

function openCardDetails(cardId, sourceView = "catalog", sourceTab = state.activeTab) {
  rememberDetailReturn(sourceView, sourceTab);
  focusCard(cardId, sourceView === "side" ? "side" : "catalog");
  renderSelectedCard();
  if (isMobileViewport()) {
    openDetailDrawer();
    renderMobileState();
    return;
  }
  openDetailModal();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right), "ja"));
}

function compareRarity(left, right) {
  const leftIndex = RARITY_ORDER.indexOf(String(left));
  const rightIndex = RARITY_ORDER.indexOf(String(right));

  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }

  return String(left).localeCompare(String(right), "ja");
}

function countValues(values) {
  const map = new Map();
  values.forEach((value) => {
    if (!value) return;
    map.set(value, (map.get(value) || 0) + 1);
  });
  return map;
}

function loadSavedDecks() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistDecks({ skipCloud = false } = {}) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.savedDecks));
  if (!skipCloud) notifyCloudState("decks");
}

function loadFavorites() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function loadTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "red" ? "red" : "light";
  } catch {
    return "light";
  }
}

function loadReferenceHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REFERENCE_HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistFavorites({ skipCloud = false } = {}) {
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
  if (!skipCloud) notifyCloudState("favorites");
}

function persistTheme({ skipCloud = false } = {}) {
  window.localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  if (!skipCloud) notifyCloudState("theme");
}

function persistReferenceHistory({ skipCloud = false } = {}) {
  window.localStorage.setItem(REFERENCE_HISTORY_STORAGE_KEY, JSON.stringify(state.referenceHistory));
  if (!skipCloud) notifyCloudState("reference-history");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeReferenceHistoryItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      return {
        id: item.id || `reference-${Date.now()}`,
        deckName: item.deckName || "大会参考デッキ",
        eventName: item.eventName || "",
        eventDate: item.eventDate || "",
        loadedAt: item.loadedAt || new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .slice(0, REFERENCE_HISTORY_LIMIT);
}

function getCloudSnapshot() {
  return {
    savedDecks: deepClone(state.savedDecks),
    favorites: [...state.favorites],
    theme: state.theme,
    referenceHistory: deepClone(state.referenceHistory),
    updatedAt: new Date().toISOString(),
  };
}

function notifyCloudState(reason = "update") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("glab:local-state", {
      detail: {
        reason,
        snapshot: getCloudSnapshot(),
      },
    }),
  );
}

function updateCloudState(patch = {}) {
  state.cloud = {
    ...state.cloud,
    ...patch,
  };
  renderCloudSyncPanel();
}

function applyCloudSnapshot(snapshot, { persistLocal = true } = {}) {
  if (!snapshot || typeof snapshot !== "object") return;
  if (Array.isArray(snapshot.savedDecks)) {
    state.savedDecks = deepClone(snapshot.savedDecks);
  }
  if (Array.isArray(snapshot.favorites)) {
    state.favorites = new Set(snapshot.favorites);
  }
  if (snapshot.theme === "red" || snapshot.theme === "light") {
    state.theme = snapshot.theme;
  }
  if (Array.isArray(snapshot.referenceHistory)) {
    state.referenceHistory = normalizeReferenceHistoryItems(snapshot.referenceHistory);
  }
  if (persistLocal) {
    persistDecks({ skipCloud: true });
    persistFavorites({ skipCloud: true });
    persistTheme({ skipCloud: true });
    persistReferenceHistory({ skipCloud: true });
  }
  render();
}

function renderCloudSyncPanel() {
  if (!elements.cloudSyncBadge) return;

  const statusMap = {
    local: { label: "ローカル", className: "is-local" },
    unconfigured: { label: "未設定", className: "is-local" },
    signed_out: { label: "未ログイン", className: "is-local" },
    syncing: { label: "同期中", className: "is-syncing" },
    connected: { label: "同期済み", className: "is-connected" },
    error: { label: "エラー", className: "is-error" },
  };

  const statusInfo = statusMap[state.cloud.status] || statusMap.local;
  elements.cloudSyncBadge.textContent = statusInfo.label;
  elements.cloudSyncBadge.className = `cloud-sync-badge ${statusInfo.className}`;
  elements.cloudSyncMessage.textContent = state.cloud.statusMessage || "この端末だけに保存されています。";

  const hasUser = Boolean(state.cloud.user);
  if (elements.cloudUserMeta) {
    elements.cloudUserMeta.hidden = !hasUser;
  }
  if (elements.cloudUserEmail) {
    elements.cloudUserEmail.textContent = state.cloud.user?.email || state.cloud.user?.id || "ログイン中";
  }
  if (elements.cloudLastSyncText) {
    elements.cloudLastSyncText.textContent = `最終同期 ${state.cloud.lastSyncedAt ? formatDateTimeJa(state.cloud.lastSyncedAt) : "--"}`;
  }

  if (elements.cloudDeckCount) elements.cloudDeckCount.textContent = String(state.savedDecks.length);
  if (elements.cloudFavoriteCount) elements.cloudFavoriteCount.textContent = String(state.favorites.size);
  if (elements.cloudHistoryCount) elements.cloudHistoryCount.textContent = String(state.referenceHistory.length);

  const canUseCloud = state.cloud.configured;
  if (elements.cloudEmailInput) elements.cloudEmailInput.disabled = !canUseCloud || hasUser || state.cloud.authBusy;
  if (elements.cloudPasswordInput) elements.cloudPasswordInput.disabled = !canUseCloud || hasUser || state.cloud.authBusy;
  if (elements.cloudSignInButton) elements.cloudSignInButton.disabled = !canUseCloud || hasUser || state.cloud.authBusy;
  if (elements.cloudRegisterButton) elements.cloudRegisterButton.disabled = !canUseCloud || hasUser || state.cloud.authBusy;
  if (elements.cloudSignOutButton) {
    elements.cloudSignOutButton.hidden = !hasUser;
    elements.cloudSignOutButton.disabled = !hasUser || state.cloud.authBusy;
  }
}

function formatDateTimeJa(value) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString("ja-JP");
}

function toggleFavorite(cardId) {
  if (state.favorites.has(cardId)) {
    state.favorites.delete(cardId);
  } else {
    state.favorites.add(cardId);
  }
  persistFavorites();
  render();
}

function toggleCompare(cardId) {
  if (state.compareIds.includes(cardId)) {
    state.compareIds = state.compareIds.filter((id) => id !== cardId);
  } else if (state.compareIds.length < COMPARE_LIMIT) {
    state.compareIds = [...state.compareIds, cardId];
  }
  render();
}

function clearCompare() {
  state.compareIds = [];
  render();
}

function openCompareModal() {
  if (!elements.compareModal) return;
  if (isMobileViewport()) {
    closeFilterDrawer();
    closeDetailDrawer();
  }
  elements.compareModal.classList.add("is-open");
  elements.compareModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-compare-modal-open");
  renderMobileState();
}

function closeCompareModal() {
  if (!elements.compareModal) return;
  elements.compareModal.classList.remove("is-open");
  elements.compareModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-compare-modal-open");
  renderMobileState();
}

function openReferenceModal() {
  if (!elements.referenceModal) return;
  renderReferenceDecks();
  elements.referenceModal.classList.add("is-open");
  elements.referenceModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-reference-modal-open");
  elements.referenceModalDialog?.scrollTo({ top: 0, behavior: "auto" });
  renderMobileState();
}

function closeReferenceModal() {
  if (!elements.referenceModal) return;
  elements.referenceModal.classList.remove("is-open");
  elements.referenceModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-reference-modal-open");
  renderMobileState();
}

function getCardVariant(card) {
  const variantId = state.selectedVariantByCard[card.id];
  return card.variants.find((variant) => variant.detailId === variantId) || card.variants[0];
}

function setSelectedVariant(cardId, variantDetailId) {
  state.selectedVariantByCard[cardId] = variantDetailId;
}

function getCopies(zone, cardId) {
  return state.deck[zone].find((item) => item.cardId === cardId)?.qty || 0;
}

function canAddCard(card, zone) {
  if (zone === "main") {
    if (!card.isMainDeckCard) return false;
    const copies = getCopies("main", card.id);
    return copies < 4;
  }
  if (zone === "token") {
    if (!card.isExtraCard) return false;
    if ([RESOURCE_TYPE, "EX RESOURCE", "EX BASE"].some((type) => hasCardType(card, type))) return false;
    return true;
  }
  if (zone === "resource") return card.isResourceCard;
  return false;
}

function addCardToDeck(cardId, zone = "main", qty = 1) {
  const card = CARD_LOOKUP.get(cardId);
  if (!card || !canAddCard(card, zone)) return;

  const existing = state.deck[zone].find((item) => item.cardId === cardId);
  const limit = zone === "main" ? 4 : 99;
  if (existing) {
    existing.qty = Math.min(limit, existing.qty + qty);
  } else {
    state.deck[zone].push({ cardId, qty: Math.min(limit, qty) });
  }
  state.selectedCardId = cardId;
  render();
}

function removeCardFromDeck(cardId, zone = "main") {
  const existing = state.deck[zone].find((item) => item.cardId === cardId);
  if (!existing) return;
  existing.qty -= 1;
  if (existing.qty <= 0) {
    state.deck[zone] = state.deck[zone].filter((item) => item.cardId !== cardId);
  }
  render();
}

function setDeckZone(zone, items) {
  state.deck[zone] = items
    .map(([cardId, qty]) => ({ cardId, qty }))
    .filter(({ cardId, qty }) => CARD_LOOKUP.has(cardId) && qty > 0);
}

function expandDeck(zone) {
  const expanded = [];
  state.deck[zone].forEach((entry) => {
    for (let index = 0; index < entry.qty; index += 1) {
      expanded.push(entry.cardId);
    }
  });
  return expanded;
}

function shuffle(array) {
  const clone = [...array];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function featuredScore(card) {
  let score = 0;
  const packageIndex = PACKAGE_ORDER.get(card.packageId) ?? 99;
  score += Math.max(0, 30 - packageIndex);
  if (card.isMainDeckCard) score += 18;
  if (hasCardType(card, "UNIT") && (card.level || 99) <= 3) score += 10;
  if (card.links.length) score += 8;
  if (hasCardType(card, "BASE")) score += 5;
  if (hasCardType(card, "PILOT")) score += 5;
  if (card.text.includes("ドロー")) score += 4;
  if (card.text.includes("リソース")) score += 4;
  if (card.isResourceCard) score -= 8;
  return score;
}

function matchesPreset(card) {
  if (!state.preset) return true;
  if (state.preset === "starter") return /^ST\d+/i.test(card.number);
  if (state.preset === "booster") return /^(GD|EB)\d+/i.test(card.number);
  if (state.preset === "lowcurve") return hasCardType(card, "UNIT") && (card.level || 99) <= 3;
  if (state.preset === "link") return card.links.length > 0;
  return true;
}

function tokenizeSearchQuery(query) {
  return (query.match(/(?:[^\s"]+:"[^"]+"|"[^"]+"|\S+)/g) || [])
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesComparison(value, operator, expected) {
  if (value === null || value === undefined) return false;
  if (operator === "<") return value < expected;
  if (operator === "<=") return value <= expected;
  if (operator === ">") return value > expected;
  if (operator === ">=") return value >= expected;
  return value === expected;
}

function normalizeSearchField(field) {
  const normalized = normalizeSearchText(field).replace(/\s+/g, "");
  if (["text", "テキスト", "効果"].includes(normalized)) return "text";
  if (["trait", "traits", "特徴"].includes(normalized)) return "trait";
  if (["link", "links", "リンク"].includes(normalized)) return "link";
  if (["name", "名前", "カード名"].includes(normalized)) return "name";
  if (["title", "作品", "タイトル"].includes(normalized)) return "title";
  if (["number", "番号", "カード番号"].includes(normalized)) return "number";
  if (["color", "色"].includes(normalized)) return "color";
  if (["type", "種類", "タイプ"].includes(normalized)) return "type";
  if (["rarity", "レア", "レアリティ"].includes(normalized)) return "rarity";
  if (["lv", "level", "レベル"].includes(normalized)) return "lv";
  if (["cost", "コスト"].includes(normalized)) return "cost";
  if (normalized === "ap") return "ap";
  if (normalized === "hp") return "hp";
  return normalized;
}

function matchesSearchQuery(card, rawQuery) {
  const query = rawQuery.trim();
  if (!query) return true;

  const tokens = tokenizeSearchQuery(query);
  const textHaystack = card.searchHaystack;

  return tokens.every((token) => {
    const numericMatch = token.match(/^([^:<>=]+)(<=|>=|=|<|>)(\d+)$/);
    if (numericMatch) {
      const [, rawField, operator, expectedRaw] = numericMatch;
      const field = normalizeSearchField(rawField);
      const expected = Number(expectedRaw);
      if (!["lv", "cost", "ap", "hp"].includes(field)) return false;
      const numericValue =
        field === "cost"
          ? card.cost
          : field === "ap"
            ? card.ap
            : field === "hp"
              ? card.hp
              : card.level;
      return matchesComparison(numericValue, operator, expected);
    }

    const prefixedMatch = token.match(/^([^:]+):(.+)$/);
    if (prefixedMatch) {
      const [, rawField, value] = prefixedMatch;
      const field = normalizeSearchField(rawField);
      const needle = normalizeSearchText(value.trim().replace(/^"|"$/g, ""));
      if (!needle) return true;
      if (field === "text") return card.normalizedText.includes(needle);
      if (field === "name") return card.normalizedName.includes(needle);
      if (field === "trait") return [...card.normalizedTraits, ...card.normalizedLinks].some((trait) => trait.includes(needle));
      if (field === "link") return card.normalizedLinks.some((link) => link.includes(needle));
      if (field === "title") return card.normalizedTitle.includes(needle);
      if (field === "number") return card.normalizedNumber.includes(needle);
      if (field === "color") return card.normalizedColor.includes(needle);
      if (field === "type") return card.normalizedTypes.some((type) => type.includes(needle));
      if (field === "rarity") return card.normalizedRarity.includes(needle);
      return false;
    }

    if (token.includes("|")) {
      return token
        .split("|")
        .map((part) => normalizeSearchText(part))
        .filter(Boolean)
        .some((part) => textHaystack.includes(part));
    }

    return textHaystack.includes(normalizeSearchText(token));
  });
}

function applyCardTagFilter(group, value) {
  if (!group || !value || !state.filters[group]) return;
  if (state.filters[group].has(value)) {
    state.filters[group].delete(value);
  } else {
    state.filters[group].add(value);
  }
  render();
}

function focusCatalogWithTagFilter(group, value) {
  if (!group || !value || !state.filters[group]) return;
  state.filters[group].add(value);
  if (elements.searchInput) {
    elements.searchInput.value = state.query;
  }
  closeDetailModal();
  closeDetailDrawer();
  closeFilterDrawer();
  state.mobileView = "catalog";
  state.isSideDrawerOpen = isMobileViewport();
  render();
  if (isMobileViewport()) {
    elements.catalogPanel?.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    elements.catalogPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function focusCatalogWithQueryToken(token) {
  if (!token) return;
  const tokens = tokenizeSearchQuery(state.query);
  if (!tokens.includes(token)) {
    tokens.push(token);
  }
  state.query = tokens.join(" ").trim();
  if (elements.searchInput) {
    elements.searchInput.value = state.query;
  }
  closeDetailModal();
  closeDetailDrawer();
  closeFilterDrawer();
  state.mobileView = "catalog";
  state.isSideDrawerOpen = isMobileViewport();
  render();
  if (isMobileViewport()) {
    elements.catalogPanel?.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    elements.catalogPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function normalizeReferenceEntries(entries = []) {
  return (entries || [])
    .map(([number, qty]) => {
      const normalizedNumber = String(number || "").trim().toUpperCase();
      const resolvedCard = CARD_BY_NUMBER.get(normalizedNumber) || null;
      return {
        number: normalizedNumber,
        qty: Number(qty) || 0,
        card: resolvedCard,
      };
    })
    .filter((entry) => entry.number && entry.qty > 0);
}

function getReferenceDecks() {
  const parseDeckDate = (value = "") => {
    const match = String(value).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!match) return 0;
    const [, year, month, day] = match;
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  };

  return (RAW_REFERENCE_DECKS.decks || [])
    .map((deck) => ({
      ...deck,
      mainEntries: normalizeReferenceEntries(deck.main),
      tokenEntries: normalizeReferenceEntries(deck.token),
    }))
    .sort((left, right) => {
      const dateGap = parseDeckDate(right.eventDate) - parseDeckDate(left.eventDate);
      if (dateGap !== 0) return dateGap;
      return String(right.deckName || "").localeCompare(String(left.deckName || ""), "ja");
    });
}

function getReferenceDeckCardCount(entries = []) {
  return entries.reduce((total, entry) => total + (Number(entry.qty) || 0), 0);
}

function buildReferenceDeckNote(deck) {
  return [deck.eventName, deck.eventDate].filter(Boolean).join(" / ");
}

function recordReferenceHistory(deck) {
  if (!deck) return;
  const entry = {
    id: deck.id || `reference-${Date.now()}`,
    deckName: deck.deckName || "大会参考デッキ",
    eventName: deck.eventName || "",
    eventDate: deck.eventDate || "",
    loadedAt: new Date().toISOString(),
  };
  state.referenceHistory = normalizeReferenceHistoryItems([
    entry,
    ...state.referenceHistory.filter((item) => item.id !== entry.id),
  ]);
  persistReferenceHistory();
}

function applyReferenceDeck(deck) {
  if (!deck) return;
  const normalizeZone = (entries = []) =>
    entries
      .map((entry) => (entry.card ? [entry.card.id, Number(entry.qty) || 0] : null))
      .filter(Boolean);

  state.deck.id = `reference-${deck.id || Date.now()}-${Date.now()}`;
  state.deck.name = deck.deckName || "大会参考デッキ";
  state.deck.note = buildReferenceDeckNote(deck);
  setDeckZone("main", normalizeZone(deck.mainEntries));
  setDeckZone("token", normalizeZone(deck.tokenEntries));
  setDeckZone("resource", []);
  state.aiDiagnosis = createEmptyAiDiagnosis();
  state.lastCheck = null;
  setActiveDeckZone("main");
  recordReferenceHistory(deck);
  closeReferenceModal();
  render();
}

function buildDetailTagEntries(card) {
  const entries = [];
  const seen = new Set();
  const pushEntry = (group, value, label = value) => {
    if (!group || !value) return;
    const key = `${group}::${value}::${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ group, value, label });
  };

  (card.typeTokens || [card.type]).filter(Boolean).forEach((type) => pushEntry("types", type));
  card.traits.forEach((trait) => pushEntry("traits", trait));
  card.links.forEach((link) => pushEntry("traits", link, `Link: ${link}`));
  card.zones.forEach((zone) => pushEntry("traits", zone));
  return entries;
}

function buildDetailBadgeEntries(card) {
  const entries = [];
  if (card.rarity) entries.push({ label: card.rarity, filterGroup: "rarities", filterValue: card.rarity });
  if (card.displayColor && card.displayColor !== "Colorless") {
    entries.push({ label: card.displayColor, filterGroup: "colors", filterValue: card.displayColor });
  }
  if (card.level !== null) entries.push({ label: `Lv ${card.level}`, filterGroup: "levels", filterValue: String(card.level) });
  if (card.cost !== null) entries.push({ label: `Cost ${card.cost}`, filterGroup: "costs", filterValue: String(card.cost) });
  if (card.ap !== null) entries.push({ label: `AP ${card.ap}`, filterGroup: "aps", filterValue: String(card.ap) });
  if (card.hp !== null) entries.push({ label: `HP ${card.hp}`, filterGroup: "hps", filterValue: String(card.hp) });
  return entries;
}

function setupFilterAccordions() {
  if (!elements.filtersPanel) return;
  const titleMap = {
    Rarity: "レアリティ",
  };
  elements.filtersPanel.querySelectorAll(".filter-block").forEach((section) => {
    const reset = section.querySelector(".mini-reset");
    const heading = section.querySelector(".filter-heading");
    const rawTitle = heading?.querySelector("h3")?.textContent?.trim();
    const title = titleMap[rawTitle] || rawTitle;
    const group = reset?.dataset.filterGroup;
    if (!reset || !heading || !title || !group || section.dataset.accordionified === "true") return;

    const details = document.createElement("details");
    details.className = "accordion-box filter-block filter-accordion";
    details.dataset.filterGroup = group;
    details.dataset.expanded = "false";
    details.open = false;

    const summary = document.createElement("summary");
    summary.className = "accordion-summary filter-accordion-summary";
    summary.innerHTML = `
      <span class="accordion-title">${escapeHtml(title)}</span>
      <span class="accordion-status filter-selection-count" data-filter-count-for="${escapeHtml(group)}" hidden>0</span>
    `;

    const body = document.createElement("div");
    body.className = "accordion-body";

    const bodyHead = document.createElement("div");
    bodyHead.className = "filter-heading filter-heading--inside";
    const titlePlaceholder = document.createElement("span");
    titlePlaceholder.className = "filter-heading-spacer";
    bodyHead.appendChild(titlePlaceholder);
    bodyHead.appendChild(reset);
    body.appendChild(bodyHead);

    [...section.children].forEach((child) => {
      if (child === heading) return;
      body.appendChild(child);
    });

    details.appendChild(summary);
    details.appendChild(body);
    section.replaceWith(details);
    details.dataset.accordionified = "true";
  });
}

function renderFilterAccordionCounts() {
  document.querySelectorAll("[data-filter-count-for]").forEach((badge) => {
    const group = badge.dataset.filterCountFor;
    const count = group && state.filters[group] ? state.filters[group].size : 0;
    badge.textContent = String(count);
    badge.hidden = count <= 0;
  });
}

function buildActiveFilterTokens() {
  const tokens = [];
  if (state.query.trim()) {
    tokens.push({
      label: `検索: ${state.query.trim()}`,
      kind: "query",
    });
  }

  const labelMap = {
    packages: "収録",
    colors: "色",
    types: "種類",
    levels: "Lv",
    costs: "Cost",
    aps: "AP",
    hps: "HP",
    titles: "作品",
    rarities: "レア",
    traits: "タグ",
  };

  Object.entries(labelMap).forEach(([group, label]) => {
    const values = [...state.filters[group]];
    if (!values.length) return;
    values.forEach((value) => {
      tokens.push({
        label: `${label}: ${value}`,
        kind: "filter",
        group,
        value,
      });
    });
  });

  if (state.onlyFavorites) {
    tokens.push({
      label: "お気に入りのみ",
      kind: "favoriteOnly",
    });
  }

  if (state.showExtras) {
    tokens.push({
      label: "トークン/EX表示",
      kind: "showExtras",
    });
  }

  return tokens;
}

function renderActiveFilterSummary() {
  if (!elements.activeFilterSummary) return;
  const tokens = buildActiveFilterTokens();
  if (!tokens.length) {
    elements.activeFilterSummary.innerHTML = "";
    elements.activeFilterSummary.hidden = true;
    return;
  }

  elements.activeFilterSummary.hidden = false;
  elements.activeFilterSummary.innerHTML = tokens
    .map(
      (token, index) => `
        <span class="active-filter-chip">
          <span class="active-filter-label">${escapeHtml(token.label)}</span>
          <button
            type="button"
            class="active-filter-remove"
            data-filter-token-index="${index}"
            aria-label="${escapeHtml(`${token.label} を解除`)}"
            title="${escapeHtml(`${token.label} を解除`)}"
          >
            ×
          </button>
        </span>
      `,
    )
    .join("");

  elements.activeFilterSummary.querySelectorAll("[data-filter-token-index]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const token = tokens[Number(button.dataset.filterTokenIndex)];
      if (!token) return;
      if (token.kind === "query") {
        state.query = "";
      } else if (token.kind === "filter" && token.group && token.value) {
        state.filters[token.group]?.delete(token.value);
      } else if (token.kind === "favoriteOnly") {
        state.onlyFavorites = false;
      } else if (token.kind === "showExtras") {
        state.showExtras = false;
      }
      render();
    });
  });
}

function filterCards() {
  let cards = ALL_CARDS.filter((card) => {
    if (state.quickAddTarget === "main" && !card.isMainDeckCard) return false;
    if (state.quickAddTarget === "token" && !card.isExtraCard) return false;
    if (state.quickAddTarget === "resource" && !card.isResourceCard) return false;
    if (state.quickAddTarget !== "token" && !state.showExtras && card.isExtraCard) return false;
    if (state.onlyFavorites && !state.favorites.has(card.id)) return false;
    if (!matchesPreset(card)) return false;
    if (state.filters.packages.size && !state.filters.packages.has(card.packageName)) return false;
    if (state.filters.colors.size && !state.filters.colors.has(card.displayColor)) return false;
    if (state.filters.types.size && !(card.typeTokens || [card.type]).some((type) => state.filters.types.has(type))) return false;
    if (state.filters.levels.size && !state.filters.levels.has(String(card.level ?? ""))) return false;
    if (state.filters.costs.size && !state.filters.costs.has(String(card.cost ?? ""))) return false;
    if (state.filters.aps.size && !state.filters.aps.has(String(card.ap ?? ""))) return false;
    if (state.filters.hps.size && !state.filters.hps.has(String(card.hp ?? ""))) return false;
    if (state.filters.titles.size && !state.filters.titles.has(card.title)) return false;
    if (state.filters.rarities.size && !state.filters.rarities.has(card.rarity)) return false;
    if (
      state.filters.traits.size &&
      ![...state.filters.traits].every(
        (trait) =>
          card.traits.includes(trait) ||
          card.links.includes(trait) ||
          card.zones.includes(trait) ||
          card.text.includes(trait) ||
          card.name.includes(trait),
      )
    ) {
      return false;
    }

    return matchesSearchQuery(card, state.query);
  });

  cards.sort((left, right) => {
    if (state.sort === "package") {
      return (
        (PACKAGE_ORDER.get(left.packageId) ?? 99) - (PACKAGE_ORDER.get(right.packageId) ?? 99) ||
        left.number.localeCompare(right.number, "ja")
      );
    }
    if (state.sort === "level") {
      return (left.level ?? 99) - (right.level ?? 99) || (left.cost ?? 99) - (right.cost ?? 99) || left.number.localeCompare(right.number, "ja");
    }
    if (state.sort === "cost") {
      return (left.cost ?? 99) - (right.cost ?? 99) || (left.level ?? 99) - (right.level ?? 99) || left.number.localeCompare(right.number, "ja");
    }
    if (state.sort === "ap") {
      return (right.ap ?? -1) - (left.ap ?? -1) || (right.hp ?? -1) - (left.hp ?? -1) || left.number.localeCompare(right.number, "ja");
    }
    if (state.sort === "name") {
      return left.name.localeCompare(right.name, "ja");
    }
    return featuredScore(right) - featuredScore(left) || left.number.localeCompare(right.number, "ja");
  });

  return cards;
}

function computeStats() {
  const mainExpanded = expandDeck("main");
  const tokenExpanded = expandDeck("token");
  const resourceExpanded = expandDeck("resource");
  const mainCards = state.deck.main
    .map((entry) => ({ ...CARD_LOOKUP.get(entry.cardId), qty: entry.qty }))
    .filter(Boolean);
  const titleWeights = new Map();
  const traitWeights = new Map();
  const levelCounts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6+": 0 };

  const colors = [...new Set(mainCards.map((card) => card.displayColor).filter((color) => color && color !== "Colorless"))];
  const typeCounts = mainCards.reduce((accumulator, card) => {
    (card.typeTokens || [card.type]).forEach((type) => {
      accumulator[type] = (accumulator[type] || 0) + card.qty;
    });
    return accumulator;
  }, {});
  mainCards.forEach((card) => {
    if (card.title && card.title !== "未分類") {
      titleWeights.set(card.title, (titleWeights.get(card.title) || 0) + card.qty);
    }
    card.traits.forEach((trait) => {
      if (!trait) return;
      traitWeights.set(trait, (traitWeights.get(trait) || 0) + card.qty);
    });
    if (hasCardType(card, "UNIT") && Number.isInteger(card.level)) {
      const bucket = card.level >= 6 ? "6+" : String(card.level);
      if (levelCounts[bucket] !== undefined) {
        levelCounts[bucket] += card.qty;
      }
    }
  });
  const lowUnits = mainCards
    .filter((card) => hasCardType(card, "UNIT") && (card.level || 99) <= 3)
    .reduce((sum, card) => sum + card.qty, 0);
  const bases = typeCounts.BASE || 0;
  const copyViolations = mainCards.filter((card) => card.qty > 4);
  return {
    mainCount: mainExpanded.length,
    tokenCount: tokenExpanded.length,
    resourceCount: resourceExpanded.length,
    colors,
    typeCounts,
    lowUnits,
    bases,
    copyViolations,
    levelCounts,
    primaryTitle: getTopWeightedLabel(titleWeights),
    primaryTrait: getTopWeightedLabel(traitWeights),
  };
}

function buildDiagnostics(stats) {
  const diagnostics = [];
  diagnostics.push(
    stats.mainCount === 50
      ? ["ok", "メインデッキ50枚", "公式の構築条件を満たしています。"]
      : ["bad", "メインデッキ枚数", `現在 ${stats.mainCount} 枚です。50枚に調整してください。`],
  );

  diagnostics.push(
    stats.resourceCount === 10
      ? ["ok", "リソース10枚", "リソース枚数は適正です。"]
      : ["bad", "リソース枚数", `現在 ${stats.resourceCount} 枚です。10枚にそろえてください。`],
  );

  diagnostics.push(
    stats.colors.length <= 2
      ? ["ok", "色数", stats.colors.length ? `${stats.colors.join(" / ")} の ${stats.colors.length} 色です。` : "色なしです。"]
      : ["bad", "色数", `現在 ${stats.colors.length} 色です。2色以内に調整してください。`],
  );

  diagnostics.push(
    stats.lowUnits >= 12
      ? ["ok", "Lv3以下", `Lv3以下のUNITが ${stats.lowUnits} 枚あります。`]
      : ["warn", "Lv3以下", `Lv3以下のUNITが ${stats.lowUnits} 枚です。序盤札を増やす余地があります。`],
  );

  diagnostics.push(
    stats.bases >= 3 && stats.bases <= 6
      ? ["ok", "ベース", `BASEが ${stats.bases} 枚で適正範囲です。`]
      : ["warn", "ベース", `BASEが ${stats.bases} 枚です。目安は3〜6枚です。`],
  );

  diagnostics.push([
    "warn",
    "内訳",
    `UNIT ${stats.typeCounts.UNIT || 0} / PILOT ${stats.typeCounts.PILOT || 0} / COMMAND ${stats.typeCounts.COMMAND || 0} / BASE ${stats.typeCounts.BASE || 0}`,
  ]);

  if (stats.copyViolations.length) {
    diagnostics.push([
      "bad",
      "同名上限超過",
      `${stats.copyViolations.map((card) => card.name).join(" / ")} が4枚を超えています。`,
    ]);
  }

  return diagnostics;
}

function buildCompactDiagnostics(stats) {
  const formatGap = (count, target) => {
    if (count === target) return "適正";
    if (count < target) return `あと${target - count}`;
    return `${count - target}超過`;
  };

  const colors = stats.colors.length ? stats.colors.join(" / ") : "なし";

  return [
    {
      status: stats.mainCount === 50 ? "ok" : "bad",
      label: "メイン",
      value: `${stats.mainCount}/50`,
      detail: formatGap(stats.mainCount, 50),
    },
    {
      status: stats.tokenCount > 0 ? "ok" : "info",
      label: "トークン",
      value: `${stats.tokenCount}枚`,
      detail: stats.tokenCount > 0 ? "登録あり" : "未登録",
    },
    {
      status: stats.colors.length <= 2 ? "ok" : "bad",
      label: "色数",
      value: `${stats.colors.length}/2`,
      detail: colors,
    },
    {
      status: stats.lowUnits >= 12 ? "ok" : "warn",
      label: "Lv3以下",
      value: stats.lowUnits >= 12 ? "✓" : `${stats.lowUnits}枚`,
      rawValue: `${stats.lowUnits}枚`,
      detail: stats.lowUnits >= 12 ? "UNIT / 12枚以上" : `UNIT / あと${12 - stats.lowUnits}枚`,
      isCheckValue: stats.lowUnits >= 12,
    },
    {
      status: stats.bases >= 3 && stats.bases <= 6 ? "ok" : "warn",
      label: "ベース",
      value: stats.bases >= 3 ? "✓" : `${stats.bases}枚`,
      rawValue: `${stats.bases}枚`,
      detail: stats.bases >= 3 ? "3枚以上" : `あと${3 - stats.bases}枚`,
      isCheckValue: stats.bases >= 3,
    },
  ];
}

function getTopWeightedLabel(weightMap) {
  return [...weightMap.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))[0]?.[0] || "";
}

function getDeckSnapshotSignature() {
  return JSON.stringify({
    main: state.deck.main.map((item) => [item.cardId, item.qty]),
    token: state.deck.token.map((item) => [item.cardId, item.qty]),
    resource: state.deck.resource.map((item) => [item.cardId, item.qty]),
  });
}

function abbreviateColorName(color) {
  const map = {
    Blue: "青",
    White: "白",
    Green: "緑",
    Red: "赤",
    Purple: "紫",
    Black: "黒",
    Yellow: "黄",
    Colorless: "無",
  };
  return map[color] || color;
}

function buildAiSuggestedCards(stats) {
  const mode = getDiagnosisMode(state.theme);
  const deckCardIds = new Set(state.deck.main.map((entry) => entry.cardId));
  const deckColorSet = new Set(stats.colors);
  const needLowUnits = stats.lowUnits < 12;
  const needBase = stats.bases < 3;
  const needCommand = (stats.typeCounts.COMMAND || 0) < 6;
  const needPilot = (stats.typeCounts.PILOT || 0) < 4 && (stats.typeCounts.UNIT || 0) >= 12;

  const candidates = ALL_CARDS.filter((card) => {
    if (!card.isMainDeckCard) return false;
    if (deckCardIds.has(card.id)) return false;
    if (stats.colors.length && !deckColorSet.has(card.displayColor)) return false;
    return true;
  })
    .map((card) => {
      let score = featuredScore(card);
      const reasons = [];

      if (stats.primaryTitle && card.title === stats.primaryTitle) {
        score += 20;
        reasons.push("title");
      }
      if (stats.primaryTrait && (card.traits || []).includes(stats.primaryTrait)) {
        score += 16;
        reasons.push("trait");
      }
      if (needLowUnits && hasCardType(card, "UNIT") && (card.level || 99) <= 3) {
        score += 34;
        reasons.push("low");
      }
      if (needBase && hasCardType(card, "BASE")) {
        score += 34;
        reasons.push("base");
      }
      if (needCommand && hasCardType(card, "COMMAND")) {
        score += 24;
        reasons.push("command");
      }
      if (needPilot && hasCardType(card, "PILOT")) {
        score += 22;
        reasons.push("pilot");
      }
      if ((card.links || []).length) {
        score += 6;
      }
      if (stats.colors.length === 1 && card.displayColor === stats.colors[0]) {
        score += 8;
      }

      return {
        card,
        score,
        reason: formatAiSuggestionReason(mode, reasons),
      };
    })
    .sort((left, right) => right.score - left.score || left.card.name.localeCompare(right.card.name, "ja"));

  const selected = [];
  const usedNames = new Set();
  for (const entry of candidates) {
    if (usedNames.has(entry.card.name)) continue;
    usedNames.add(entry.card.name);
    selected.push({
      cardId: entry.card.id,
      reason: entry.reason,
    });
    if (selected.length >= 3) break;
  }

  return selected;
}

function formatAiSuggestionReason(mode, reasons = []) {
  const primary = reasons[0] || "general";
  const colonelMap = {
    title: "主軸に連なる札だ。採っておいて損はない。",
    trait: "君の構想に沿う札だ。輪郭を濁らせずに済む。",
    low: "序盤の穴を埋める役だ。立ち上がりを曖昧にするな。",
    base: "基盤を補う札だ。この薄さを放置するのは感心せん。",
    command: "受けの幅を増やせる。選択肢は備えておくべきだ。",
    pilot: "連携役として働く。主役を孤立させるわけにはいかん。",
    general: "編成に自然に収まる候補だ。試してみる価値はある。",
  };
  const captainMap = {
    title: "主軸に噛み合う。まず試してくれ。",
    trait: "テーマに沿っている。動きがぶれにくい。",
    low: "序盤を補いやすい。立ち上がりの安定につながる。",
    base: "ベース不足を埋めやすい。中盤の支えになる。",
    command: "受けの選択肢を増やせる。無駄にはならん。",
    pilot: "連携役として見込みがある。打点の伸びが変わる。",
    general: "今の編成に入れやすい候補だ。確認してくれ。",
  };
  const map = mode === "colonel" ? colonelMap : captainMap;
  return map[primary] || map.general;
}

function buildAiDiagnosis(stats, theme = state.theme) {
  const labels = getDiagnosisLabels(theme);
  if (!stats.mainCount) {
    if (labels.mode === "colonel") {
      return {
        badge: labels.badge,
        status: "info",
        persona: labels.mode,
        good: "私の見るところ、まだ盤上に論ずるだけの骨格がない。",
        caution: "だが、空のままでは評価も戦略も成立せん。",
        suggestion: "君が主役と定める一枚を置け。話はそれからだ。",
        suggestedCards: [],
      };
    }

    return {
      badge: labels.badge,
      status: "info",
      persona: labels.mode,
      good: "方針さえ定まれば、立て直しはできる。",
      caution: "だが、まだカードが入っていない。このままでは診断にならん。",
      suggestion: "まず主役に据えるカードを入れろ。それから私に見せてくれ。",
      suggestedCards: [],
    };
  }

  const earlyUnits = (stats.levelCounts["1"] || 0) + (stats.levelCounts["2"] || 0) + (stats.levelCounts["3"] || 0);
  const lateUnits = (stats.levelCounts["5"] || 0) + (stats.levelCounts["6+"] || 0);
  const unitCount = stats.typeCounts.UNIT || 0;
  const pilotCount = stats.typeCounts.PILOT || 0;
  const commandCount = stats.typeCounts.COMMAND || 0;
  const themeLead = stats.primaryTitle ? `${stats.primaryTitle}軸` : stats.primaryTrait ? `${stats.primaryTrait}寄り` : "このデッキ";
  const colorLead =
    stats.colors.length === 0
      ? "色はまだ未確定"
      : stats.colors.length === 1
        ? `${abbreviateColorName(stats.colors[0])}単色`
        : `${stats.colors.map(abbreviateColorName).join(" / ")}の${stats.colors.length}色`;

  const positives = [];
  const cautions = [];

  if (stats.colors.length === 1) {
    positives.push("色事故を抑えやすい");
  } else if (stats.colors.length === 2) {
    positives.push("2色の役割分担がしやすい");
  } else if (stats.colors.length > 2) {
    cautions.push(`${stats.colors.length}色でやや散っている`);
  }

  if (stats.lowUnits >= 12) {
    positives.push("序盤札は見えている");
  } else {
    cautions.push(`Lv3以下が${stats.lowUnits}枚で序盤が薄い`);
  }

  if (stats.bases >= 3 && stats.bases <= 6) {
    positives.push("ベース枚数も扱いやすい範囲だ");
  } else if (stats.bases < 3) {
    cautions.push(`ベースが${stats.bases}枚で薄い`);
  } else {
    cautions.push(`ベースが${stats.bases}枚でやや多い`);
  }

  if (commandCount >= 10) {
    positives.push("コマンドが多く受けに厚みがある");
  }

  if (pilotCount >= 8) {
    positives.push("パイロット多めで連携を伸ばしやすい");
  }

  if (stats.tokenCount > 0) {
    positives.push("トークン込みで展開の幅もある");
  }

  if (stats.mainCount < 50) {
    cautions.unshift(`まだ${stats.mainCount}/50で最終評価は早い`);
  }

  const positiveLine = positives[0] || "方向性は見えている";
  const cautionLine = cautions[0] || "大きな破綻はないが、まだ詰めは甘い";
  let suggestionLine = "役割が重なっている枠を2〜3枚見直せ。全体を締めるべきだ。";
  let colonelSuggestionLine = "役割が重なった枠を2〜3枚見直すことだ。君の美点は、まだ磨ける。";

  if (stats.colors.length > 2) {
    suggestionLine = "色は2色以内に絞れ。輪郭を曖昧にするわけにはいかん。";
    colonelSuggestionLine = "色は2色以内に絞ることだ。欲を出せば輪郭が濁るだけだ。";
  } else if (stats.lowUnits < 12) {
    suggestionLine = "Lv3以下を2〜4枚増やせ。序盤を疎かにするのでは困る。";
    colonelSuggestionLine = "Lv3以下を2〜4枚増やせ。序盤を曖昧にするのは愚策にすぎん。";
  } else if (stats.bases < 3) {
    suggestionLine = "ベースをあと1〜2枚試してくれ。中盤の支えを欠くわけにはいかん。";
    colonelSuggestionLine = "ベースをあと1〜2枚試すことだ。中盤の支えを欠くのは得策ではない。";
  } else if (commandCount === 0) {
    suggestionLine = "軽いコマンドを数枚入れろ。受けの選択肢が細いのでは困る。";
    colonelSuggestionLine = "軽いコマンドを数枚差し込め。君の選択肢は、まだ細い。";
  } else if (pilotCount === 0 && unitCount >= 16) {
    suggestionLine = "主役ユニットを支えるパイロットも試してくれ。打点の伸びを確保すべきだ。";
    colonelSuggestionLine = "主役を支えるパイロットも試すことだ。打点の伸び方が変わるだろう。";
  } else if (lateUnits >= 10) {
    suggestionLine = "終盤札は1〜2枠ほど軽くしろ。重さに寄せすぎるべきではない。";
    colonelSuggestionLine = "終盤札は1〜2枠ほど軽くしろ。重さは美徳ではない。";
  } else if (stats.mainCount < 50) {
    suggestionLine = "残り枠は序盤札かベースに充てろ。骨格を先に固めるべきだ。";
    colonelSuggestionLine = "残り枠は序盤札かベースに寄せろ。骨格を固めるのが先だ。";
  }

  if (labels.mode === "colonel") {
    return {
      badge: labels.badge,
      status: stats.mainCount === 50 && stats.colors.length <= 2 && stats.lowUnits >= 12 ? "ok" : stats.mainCount >= 36 ? "warn" : "info",
      persona: labels.mode,
      good: `私の見るところ、${themeLead}としての骨格は見えている。${colorLead}で、${positiveLine}というわけだ。`,
      caution: `だが、${cautionLine}。そのままでは君の構えに甘さが残る。`,
      suggestion: colonelSuggestionLine,
      suggestedCards: buildAiSuggestedCards(stats),
    };
  }

  return {
    badge: labels.badge,
    status: stats.mainCount === 50 && stats.colors.length <= 2 && stats.lowUnits >= 12 ? "ok" : stats.mainCount >= 36 ? "warn" : "info",
    persona: labels.mode,
    good: `私の見るところ、${themeLead}として骨格は見えている。${colorLead}で、${positiveLine}。`,
    caution: `だが、${cautionLine}。そのまま進めるのでは困る。`,
    suggestion: suggestionLine,
    suggestedCards: buildAiSuggestedCards(stats),
  };
}

function renderAiDiagnosis() {
  if (!elements.aiDiagnosisResult) return;

  const labels = getDiagnosisLabels(state.theme);
  if (elements.aiDiagnosisTitle) {
    elements.aiDiagnosisTitle.textContent = labels.title;
  }

  let diagnosis = { ...createEmptyAiDiagnosis(state.theme), ...(state.aiDiagnosis || {}) };
  const deckSignature = getDeckSnapshotSignature();
  if (diagnosis.persona !== labels.mode) {
    diagnosis = {
      ...buildAiDiagnosis(computeStats(), state.theme),
      signature: diagnosis.signature || deckSignature,
      createdAt: diagnosis.createdAt || new Date().toISOString(),
    };
    state.aiDiagnosis = diagnosis;
  }

  const hasComment = Boolean(diagnosis.good || diagnosis.caution || diagnosis.suggestion);
  const isFresh = hasComment && diagnosis.signature === deckSignature;

  if (elements.runAiDiagnosisButton) {
    elements.runAiDiagnosisButton.textContent = hasComment ? "再診断" : "診断する";
  }

  if (!hasComment) {
    elements.aiDiagnosisResult.className = "ai-diagnosis-result is-empty";
    elements.aiDiagnosisResult.innerHTML = `
      <p>${escapeHtml(labels.emptyTitle)}</p>
      <span>${escapeHtml(labels.emptyBody)}</span>
    `;
    return;
  }

  const combinedText = [diagnosis.good, diagnosis.caution, diagnosis.suggestion].filter(Boolean).join(" ");
  const suggestionCards = (diagnosis.suggestedCards || [])
    .map((entry) => {
      const card = CARD_LOOKUP.get(entry.cardId);
      if (!card) return "";
      const variant = getCardVariant(card);
      return `
        <button type="button" class="ai-suggestion-card" data-ai-card-id="${escapeHtml(card.id)}">
          <span class="ai-suggestion-thumb">
            <img src="${variant.imageUrl}" alt="${escapeHtml(card.name)}" loading="lazy" />
          </span>
          <span class="ai-suggestion-copy">
            <strong>${escapeHtml(card.name)}</strong>
            <span>${escapeHtml(entry.reason || "相性が良い候補")}</span>
          </span>
        </button>
      `;
    })
    .filter(Boolean)
    .join("");
  elements.aiDiagnosisResult.className = `ai-diagnosis-result is-${diagnosis.status || "info"} ${isFresh ? "is-fresh" : "is-stale"}`;
  elements.aiDiagnosisResult.innerHTML = `
    <div class="ai-diagnosis-meta">
      <span class="ai-diagnosis-note">${escapeHtml(
        isFresh ? labels.freshNote : labels.staleNote,
      )}</span>
    </div>
    <p>${escapeHtml(combinedText)}</p>
    ${
      suggestionCards
        ? `<div class="ai-suggestion-list-wrap">
            <h4>${escapeHtml(labels.suggestionTitle || "提案カード")}</h4>
            <div class="ai-suggestion-list">${suggestionCards}</div>
          </div>`
        : ""
    }
  `;
  elements.aiDiagnosisResult.querySelectorAll("[data-ai-card-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openCardDetails(button.dataset.aiCardId || "", "side", "deck");
    });
  });
}

function runAiDiagnosis() {
  state.aiDiagnosis = {
    ...buildAiDiagnosis(computeStats(), state.theme),
    signature: getDeckSnapshotSignature(),
    createdAt: new Date().toISOString(),
  };
  renderAiDiagnosis();
}

function createChip(container, value, group) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `chip ${state.filters[group].has(value) ? "is-active" : ""}`;
  button.textContent = value;
  button.addEventListener("click", () => {
    if (state.filters[group].has(value)) {
      state.filters[group].delete(value);
    } else {
      state.filters[group].add(value);
    }
    render();
  });
  container.appendChild(button);
}

function renderFilterGroups() {
  elements.packageFilters.innerHTML = "";
  RAW_DB.packages.forEach((pkg) => createChip(elements.packageFilters, pkg.name, "packages"));

  elements.colorFilters.innerHTML = "";
  COLORS.forEach((color) => createChip(elements.colorFilters, color, "colors"));

  elements.typeFilters.innerHTML = "";
  TYPES.forEach((type) => createChip(elements.typeFilters, type, "types"));

  if (elements.levelFilters) {
    elements.levelFilters.innerHTML = "";
    LEVEL_VALUES.forEach((value) => createChip(elements.levelFilters, value, "levels"));
  }

  if (elements.costFilters) {
    elements.costFilters.innerHTML = "";
    COST_VALUES.forEach((value) => createChip(elements.costFilters, value, "costs"));
  }

  if (elements.apFilters) {
    elements.apFilters.innerHTML = "";
    AP_VALUES.forEach((value) => createChip(elements.apFilters, value, "aps"));
  }

  if (elements.hpFilters) {
    elements.hpFilters.innerHTML = "";
    HP_VALUES.forEach((value) => createChip(elements.hpFilters, value, "hps"));
  }

  elements.titleFilters.innerHTML = "";
  TITLES.forEach((title) => createChip(elements.titleFilters, title, "titles"));

  elements.rarityFilters.innerHTML = "";
  RARITIES.forEach((rarity) => createChip(elements.rarityFilters, rarity, "rarities"));

  elements.traitFilters.innerHTML = "";
  TRAITS.forEach((trait) => createChip(elements.traitFilters, trait, "traits"));
}

function renderFavoriteControls() {
  if (elements.favoriteOnlyToggle) {
    elements.favoriteOnlyToggle.checked = state.onlyFavorites;
  }
  if (elements.favoriteCount) {
    elements.favoriteCount.textContent = `${state.favorites.size}件`;
  }
}

function renderCompareModal() {
  if (!elements.compareModalContent) return;
  const compareCards = state.compareIds.map((id) => CARD_LOOKUP.get(id)).filter(Boolean);
  if (compareCards.length < 2) {
    elements.compareModalContent.innerHTML = `
      <div class="empty-state">
        <p>比較するカードを2枚以上選んでください。</p>
        <span>一覧の「比較」ボタンから最大3枚まで選べます。</span>
      </div>
    `;
    return;
  }

  elements.compareModalContent.innerHTML = compareCards
    .map((card) => {
      const variant = getCardVariant(card);
      const detailTags = buildDetailTagEntries(card);
      return `
        <article class="compare-card">
          <div class="compare-card-head">
            <strong>${escapeHtml(card.name)}</strong>
            <button type="button" class="tool-chip is-active" data-compare-remove="${escapeHtml(card.id)}">外す</button>
          </div>
          <div class="compare-card-art" role="button" tabindex="0" data-compare-image="${escapeHtml(card.id)}" aria-label="${escapeHtml(card.name)} の拡大画像を開く">
            <img src="${variant.imageUrl}" alt="${escapeHtml(card.name)}" loading="lazy" />
          </div>
          <div class="compare-card-stats">
            <span class="detail-pill">${escapeHtml(card.number)}</span>
            <span class="detail-pill">${escapeHtml(card.rarity)}</span>
            <span class="detail-pill">${escapeHtml(card.displayColor)}</span>
            ${card.level !== null ? `<span class="detail-pill">Lv ${card.level}</span>` : ""}
            ${card.cost !== null ? `<span class="detail-pill">Cost ${card.cost}</span>` : ""}
            ${card.ap !== null ? `<span class="detail-pill">AP ${card.ap}</span>` : ""}
            ${card.hp !== null ? `<span class="detail-pill">HP ${card.hp}</span>` : ""}
          </div>
          ${
            detailTags.length
              ? `<div class="detail-tag-strip">
                  ${detailTags.map((tag) => `<span class="detail-pill detail-pill--soft">${escapeHtml(tag.label)}</span>`).join("")}
                </div>`
              : ""
          }
          <p class="selected-copy">${escapeHtml(card.text || "テキストなし")}</p>
        </article>
      `;
    })
    .join("");

  elements.compareModalContent.querySelectorAll("[data-compare-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleCompare(button.dataset.compareRemove || "");
    });
  });
  elements.compareModalContent.querySelectorAll("[data-compare-image]").forEach((button) => {
    const openPreview = () => {
      const card = CARD_LOOKUP.get(button.dataset.compareImage || "");
      if (!card) return;
      openImagePreview(card, getCardVariant(card));
    };
    button.addEventListener("click", openPreview);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openPreview();
    });
  });
}

function renderCompareBar() {
  if (elements.compareSummary) {
    elements.compareSummary.textContent = `比較 ${state.compareIds.length} / ${COMPARE_LIMIT}`;
  }
  if (elements.openCompareButton) {
    elements.openCompareButton.disabled = state.compareIds.length < 2;
  }
  if (elements.clearCompareButton) {
    elements.clearCompareButton.disabled = state.compareIds.length === 0;
  }
  if (elements.mobileCompareCount) {
    const count = state.compareIds.length;
    elements.mobileCompareCount.hidden = count === 0;
    elements.mobileCompareCount.textContent = String(count);
  }
  if (elements.mobileCompareFab) {
    elements.mobileCompareFab.classList.toggle("has-count", state.compareIds.length > 0);
    elements.mobileCompareFab.setAttribute(
      "aria-label",
      state.compareIds.length > 0 ? `カード比較を開く (${state.compareIds.length})` : "カード比較を開く",
    );
    elements.mobileCompareFab.setAttribute(
      "title",
      state.compareIds.length > 0 ? `カード比較を開く (${state.compareIds.length})` : "カード比較を開く",
    );
  }
  renderCompareModal();
}

function formatCardStats(card) {
  const parts = [card.displayColor, card.type];
  if (card.level !== null) parts.push(`Lv ${card.level}`);
  if (card.cost !== null) parts.push(`Cost ${card.cost}`);
  if (card.ap !== null) parts.push(`AP ${card.ap}`);
  if (card.hp !== null) parts.push(`HP ${card.hp}`);
  return parts.join(" / ");
}

function renderCatalog() {
  const cards = filterCards();
  elements.cardCatalog.innerHTML = "";
  elements.cardCatalog.classList.toggle("is-list", state.view === "list");
  elements.resultCount.textContent = String(cards.length);
  elements.resultLabel.textContent = cards.length === 1 ? "card" : "cards";
  renderActiveFilterSummary();

  if (!cards.length) {
    const template = document.getElementById("emptyStateTemplate");
    elements.cardCatalog.appendChild(template.content.cloneNode(true));
    return;
  }

  cards.forEach((card) => {
    const selectedVariant = getCardVariant(card);
    const copiesInZone = getCopies(state.quickAddTarget, card.id);
    const canAddToZone = canAddCard(card, state.quickAddTarget);
    const isFavorite = state.favorites.has(card.id);
    const isCompared = state.compareIds.includes(card.id);
    const compareDisabled = !isCompared && state.compareIds.length >= COMPARE_LIMIT;
    const article = document.createElement("article");
    article.className = "catalog-card";
    article.innerHTML = `
      <div class="card-art is-previewable" role="button" tabindex="0" aria-label="${escapeHtml(card.name)} の詳細を開く">
        <img src="${selectedVariant.imageUrl}" alt="${escapeHtml(card.name)}" loading="lazy" />
        <div class="art-badges art-badges--end">
          <span class="card-rarity">${escapeHtml(card.rarity)}</span>
        </div>
      </div>
      <div class="card-body">
        <h3>${escapeHtml(card.name)}</h3>
        <p class="card-code-line">${escapeHtml(card.number)}</p>
        <p class="card-subline">${escapeHtml(card.packageName)}</p>
        <div class="card-meta">
          ${
            card.title
              ? `<button type="button" class="detail-pill is-filterable" data-tag-filter-group="titles" data-tag-filter-value="${escapeHtml(card.title)}">${escapeHtml(card.title)}</button>`
              : ""
          }
        </div>
        <div class="card-tools-row">
          <button type="button" data-action="compare" class="tool-chip card-compare-chip ${isCompared ? "is-active" : ""}" ${compareDisabled ? "disabled" : ""}>
            ${isCompared ? "比較中" : "比較"}
          </button>
        </div>
        <div class="catalog-actions">
          <div class="catalog-qty-actions">
            <button type="button" data-action="remove" ${copiesInZone > 0 ? "" : 'class="is-disabled" disabled aria-disabled="true"'}>-1</button>
            <button type="button" data-action="add" ${canAddToZone ? "" : 'class="is-disabled" disabled aria-disabled="true"'}>+1</button>
          </div>
          <span class="card-copy">Deck ${copiesInZone}</span>
          <button
            type="button"
            data-action="favorite"
            class="favorite-star ${isFavorite ? "is-active" : ""}"
            aria-label="${isFavorite ? "お気に入り解除" : "お気に入り追加"}"
            title="${isFavorite ? "お気に入り解除" : "お気に入り追加"}"
          >
            ${isFavorite ? "★" : "☆"}
          </button>
        </div>
      </div>
    `;

    article.querySelectorAll("[data-tag-filter-group]").forEach((pill) => {
      pill.addEventListener("click", (event) => {
        event.stopPropagation();
        applyCardTagFilter(pill.dataset.tagFilterGroup, pill.dataset.tagFilterValue || "");
      });
    });

    const artButton = article.querySelector(".card-art");
    artButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      openCardDetails(card.id, "catalog", state.activeTab);
    });
    artButton?.addEventListener("dblclick", (event) => {
      event.stopPropagation();
    });
    artButton?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openCardDetails(card.id, "catalog", state.activeTab);
    });
    article.querySelector('[data-action="remove"]').addEventListener("click", () => {
      if (copiesInZone > 0) removeCardFromDeck(card.id, state.quickAddTarget);
    });
    article.querySelector('[data-action="favorite"]').addEventListener("click", () => {
      toggleFavorite(card.id);
    });
    article.querySelector('[data-action="compare"]').addEventListener("click", () => {
      toggleCompare(card.id);
    });
    article.querySelector('[data-action="add"]').addEventListener("click", () => {
      if (canAddToZone) addCardToDeck(card.id, state.quickAddTarget, 1);
    });
    article.addEventListener("dblclick", () => {
      if (canAddToZone) addCardToDeck(card.id, state.quickAddTarget, 1);
    });

    elements.cardCatalog.appendChild(article);
  });
}

function renderDeckList(zone, container) {
  if (!container) return;
  container.innerHTML = "";
  container.dataset.zone = zone;
  if (!state.deck[zone].length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<p>${zone === "main" ? "メインデッキは空です。" : "トークンは未登録です。"}</p><span>カード一覧から追加してください。</span>`;
    container.appendChild(empty);
    return;
  }

  state.deck[zone].forEach((entry, index) => {
    const card = CARD_LOOKUP.get(entry.cardId);
    if (!card) return;
    const variant = getCardVariant(card);

    const row = document.createElement("article");
    row.className = "deck-tile";
    row.draggable = zone === "main";
    row.title = `${card.name}\n${card.number} / ${formatCardStats(card)}`;
    row.innerHTML = `
      <div class="deck-tile-thumb">
        <img src="${variant.imageUrl}" alt="${escapeHtml(card.name)}" loading="lazy" />
        <span class="deck-tile-qty">${entry.qty}</span>
        <div class="deck-tile-footer">
          <span class="deck-tile-code">${escapeHtml(card.number)}</span>
          <div class="deck-tile-actions">
            <button type="button" data-action="down" aria-label="Decrease ${escapeHtml(card.name)}">-</button>
            <button type="button" data-action="up" aria-label="Increase ${escapeHtml(card.name)}">+</button>
          </div>
        </div>
      </div>
      <strong class="deck-tile-name">${escapeHtml(card.name)}</strong>
    `;

    row.querySelector('[data-action="down"]').addEventListener("click", (event) => {
      event.stopPropagation();
      removeCardFromDeck(card.id, zone);
    });
    row.querySelector('[data-action="up"]').addEventListener("click", (event) => {
      event.stopPropagation();
      addCardToDeck(card.id, zone, 1);
    });
    row.addEventListener("click", () => {
      openCardDetails(card.id, "side", state.activeTab);
    });

    if (zone === "main") {
      row.addEventListener("dragstart", () => {
        state.dragState = { index };
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", () => {
        state.dragState = null;
        row.classList.remove("is-dragging");
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!state.dragState || state.dragState.index === index) return;
        const next = [...state.deck.main];
        const [moved] = next.splice(state.dragState.index, 1);
        next.splice(index, 0, moved);
        state.deck.main = next;
        render();
      });
    }

    container.appendChild(row);
  });
}

function renderReferenceDecks() {
  if (!elements.referenceDecksList || !elements.referenceDecksModalCount || !elements.referenceDecksFetchedAt) return;

  const referenceDecks = getReferenceDecks();
  if (elements.referenceDeckCountBadge) {
    elements.referenceDeckCountBadge.textContent = `${referenceDecks.length}件`;
  }
  elements.referenceDecksModalCount.textContent = `${referenceDecks.length}件`;
  elements.referenceDecksFetchedAt.textContent = formatDateTimeJa(RAW_REFERENCE_DECKS.generatedAt);
  elements.referenceDecksList.innerHTML = "";

  if (!referenceDecks.length) {
    elements.referenceDecksList.innerHTML = `
      <div class="empty-state">
        <p>大会入賞デッキの参考データがまだありません。</p>
        <span>公式大会結果ページから取得したデータをここに表示します。</span>
      </div>
    `;
    return;
  }

  referenceDecks.forEach((deck) => {
    const activeZone = state.referenceDeckZones[deck.id] || "main";
    const mainCount = getReferenceDeckCardCount(deck.mainEntries);
    const tokenCount = getReferenceDeckCardCount(deck.tokenEntries);
    const activeEntries = activeZone === "token" ? deck.tokenEntries : deck.mainEntries;
    const previewMarkup = activeEntries.length
      ? activeEntries
          .map((entry) => {
            const qtyLabel = `${entry.qty}`;
            if (entry.card) {
              const variant = getCardVariant(entry.card);
              return `
                <button
                  type="button"
                  class="reference-preview-card"
                  data-reference-apply-card="${escapeHtml(deck.id)}"
                  title="${escapeHtml(entry.card.name)} を反映"
                >
                  <span class="reference-preview-thumb">
                    <img src="${variant.imageUrl}" alt="${escapeHtml(entry.card.name)}" loading="lazy" />
                    <span class="reference-preview-qty">${qtyLabel}</span>
                  </span>
                </button>
              `;
            }
            return `
              <div class="reference-preview-card is-unresolved" title="${escapeHtml(entry.number)}">
                <span class="reference-preview-thumb reference-preview-thumb--empty">
                  <span class="reference-preview-qty">${qtyLabel}</span>
                </span>
              </div>
            `;
          })
          .join("")
      : `
        <div class="reference-preview-empty">
          <p>${activeZone === "token" ? "トークン情報は未掲載です。" : "カード情報がありません。"}</p>
          <span>${escapeHtml(deck.tokenNote || "公式大会結果ページにはトークン一覧がありません。")}</span>
        </div>
      `;

    const article = document.createElement("article");
    article.className = "reference-item";
    article.innerHTML = `
      <div class="reference-item-head">
        <div class="reference-title-block">
          <strong>${escapeHtml(deck.deckName || "大会入賞デッキ")}</strong>
        </div>
      </div>
      <div class="reference-meta">
        <span>大会名: ${escapeHtml(deck.eventName || "-")}</span>
        <span>開催日: ${escapeHtml(deck.eventDate || "-")}</span>
      </div>
      <div class="deck-zone-tabbar reference-zone-tabbar">
        <button type="button" class="deck-zone-tab ${activeZone === "main" ? "is-active" : ""}" data-reference-zone="main" data-reference-id="${escapeHtml(deck.id)}">
          メイン ${mainCount}
        </button>
        <button type="button" class="deck-zone-tab ${activeZone === "token" ? "is-active" : ""}" data-reference-zone="token" data-reference-id="${escapeHtml(deck.id)}">
          トークン ${tokenCount}
        </button>
      </div>
      <div class="reference-preview-frame">
        <div class="reference-preview-list">
          ${previewMarkup}
        </div>
      </div>
    `;

    article.querySelectorAll("[data-reference-zone]").forEach((button) => {
      button.addEventListener("click", () => {
        state.referenceDeckZones[deck.id] = button.dataset.referenceZone || "main";
        renderReferenceDecks();
      });
    });
    const applyReferenceDeckWithConfirm = () => {
      openConfirmModal({
        title: "参考デッキを反映",
        message: "現在のデッキをこの参考デッキで上書きします。続行してくれますか？",
        acceptLabel: "反映する",
        onAccept: () => {
          closeConfirmModal();
          applyReferenceDeck(deck);
        },
      });
    };
    article.querySelectorAll("[data-reference-apply-card]").forEach((button) => {
      button.addEventListener("click", () => {
        applyReferenceDeckWithConfirm();
      });
    });

    elements.referenceDecksList.appendChild(article);
  });
}

function renderStats() {
  const stats = computeStats();
  const compactDiagnostics = buildCompactDiagnostics(stats);
  elements.mainDeckCounter.textContent = `${stats.mainCount} / 50`;
  elements.tokenDeckCounter.textContent = `${stats.tokenCount}`;
  elements.colorCounter.textContent = stats.colors.length ? stats.colors.join(" / ") : "-";
  elements.validationCounter.textContent = stats.mainCount === 50 && stats.colors.length <= 2 ? "Ready" : "Needs Fix";
  elements.mainZoneSummary.textContent = state.activeDeckZone === "token" ? `${stats.tokenCount}枚` : `${stats.mainCount} / 50`;

  if (elements.deckDiagnosticSummary) {
    const hasBad = compactDiagnostics.some((diagnostic) => diagnostic.status === "bad");
    const hasWarn = compactDiagnostics.some((diagnostic) => diagnostic.status === "warn");
    const summaryStatus = hasBad ? "bad" : hasWarn ? "warn" : "ok";
    const summaryLabel = summaryStatus === "bad" ? "要修正" : summaryStatus === "warn" ? "注意" : "OK";
    elements.deckDiagnosticSummary.textContent = summaryLabel;
    elements.deckDiagnosticSummary.className = `accordion-status is-${summaryStatus}`;
    elements.deckDiagnosticSummary.setAttribute("aria-label", `構築診断 ${summaryLabel}`);
  }

  elements.deckInsights.innerHTML = "";
  const statusLabels = { ok: "OK", warn: "注意", bad: "要修正", info: "補足" };
  compactDiagnostics.forEach((diagnostic) => {
    const item = document.createElement("div");
    item.className = `diagnostic-item ${diagnostic.status}`;
    item.title = `${diagnostic.label}: ${diagnostic.rawValue || diagnostic.value} / ${diagnostic.detail}`;
    item.innerHTML = `
      <span class="diagnostic-badge">${statusLabels[diagnostic.status] || "INFO"}</span>
      <strong>${escapeHtml(diagnostic.label)}</strong>
      <span class="diagnostic-inline-value ${diagnostic.isCheckValue ? "is-check" : ""}">${escapeHtml(diagnostic.value)}</span>
    `;
    elements.deckInsights.appendChild(item);
  });
}

function renderCurve() {
  const levelBuckets = [
    { label: "Lv1", min: 1, max: 1 },
    { label: "Lv2", min: 2, max: 2 },
    { label: "Lv3", min: 3, max: 3 },
    { label: "Lv4", min: 4, max: 4 },
    { label: "Lv5", min: 5, max: 5 },
    { label: "Lv6+", min: 6, max: 99 },
  ];
  const levelCounts = levelBuckets.map((bucket) =>
    state.deck.main.reduce((sum, entry) => {
      const card = CARD_LOOKUP.get(entry.cardId);
      if (!card || getPrimaryDeckType(card) !== "UNIT" || card.level === null) return sum;
      if (card.level < bucket.min || card.level > bucket.max) return sum;
      return sum + entry.qty;
    }, 0),
  );
  const typeBuckets = [
    { label: "ユニット", type: "UNIT" },
    { label: "パイロット", type: "PILOT" },
    { label: "コマンド", type: "COMMAND" },
    { label: "ベース", type: "BASE" },
  ];
  const typeCounts = typeBuckets.map((bucket) =>
    state.deck.main.reduce((sum, entry) => {
      const card = CARD_LOOKUP.get(entry.cardId);
      if (!card || getPrimaryDeckType(card) !== bucket.type) return sum;
      return sum + entry.qty;
    }, 0),
  );

  const renderChartBars = (target, buckets, counts) => {
    if (!target) return;
    const maxCount = Math.max(1, ...counts);
    target.innerHTML = "";
    buckets.forEach((bucket, index) => {
      const count = counts[index];
      const fillHeight = count === 0 ? 0 : Math.max(6, (count / maxCount) * 100);
      const bar = document.createElement("div");
      bar.className = "curve-bar";
      bar.innerHTML = `
        <div class="curve-bar-visual">
          <div class="curve-bar-fill ${count === 0 ? "is-zero" : ""}" style="height:${fillHeight}%"></div>
        </div>
        <div class="curve-bar-label">${bucket.label}</div>
        <div class="curve-bar-value">${count}</div>
      `;
      target.appendChild(bar);
    });
  };

  renderChartBars(elements.curveChart, levelBuckets, levelCounts);
  renderChartBars(elements.curveTypeChart, typeBuckets, typeCounts);

  document.querySelectorAll("[data-curve-page]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.curvePage === state.curvePage);
  });
  if (elements.curvePages) {
    elements.curvePages.dataset.curvePage = state.curvePage;
  }
}

function setCurvePage(page) {
  state.curvePage = page === "type" ? "type" : "level";
  renderCurve();
}

function bindSelectedCardVariantButtons(container, card) {
  if (!container) return;
  container.querySelectorAll("[data-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedVariant(card.id, button.dataset.variant);
      renderSelectedCard();
      renderCatalog();
      renderDeckList("main", elements.mainDeckList);
      renderDeckList("token", elements.tokenDeckList);
      renderOpeningHand();
    });
  });

  const previewTarget = container.querySelector(".selected-main-art");
  previewTarget?.addEventListener("click", () => {
    openImagePreview(card, getCardVariant(card));
  });
  previewTarget?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openImagePreview(card, getCardVariant(card));
  });

  container.querySelectorAll("[data-detail-filter-group]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      focusCatalogWithTagFilter(button.dataset.detailFilterGroup, button.dataset.detailFilterValue || "");
    });
  });

  container.querySelectorAll("[data-detail-query-token]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      focusCatalogWithQueryToken(button.dataset.detailQueryToken || "");
    });
  });
}

function buildSelectedCardMarkupClean(card) {
  const currentVariant = getCardVariant(card);
  const faqItems = card.faq.slice(0, 3);
  const detailTags = buildDetailTagEntries(card);
  const detailBadges = buildDetailBadgeEntries(card);
  const variantButtons = card.variants
    .map(
      (variant) => `
        <button class="variant-button ${variant.detailId === currentVariant.detailId ? "is-active" : ""}" type="button" data-variant="${escapeHtml(variant.detailId)}">
          <img src="${variant.imageUrl}" alt="${escapeHtml(card.name)} ${escapeHtml(variant.label)}" loading="lazy" />
          <span>${escapeHtml(variant.label)}</span>
        </button>
      `,
    )
    .join("");

  return `
    <article class="selected-card-shell">
      <div class="selected-layout">
        <div class="selected-art">
          <div class="selected-main-art is-previewable" role="button" tabindex="0" aria-label="${escapeHtml(card.name)} の拡大画像を開く">
            <img src="${currentVariant.imageUrl}" alt="${escapeHtml(card.name)}" />
          </div>
          ${card.variants.length > 1 ? `<div class="variant-strip">${variantButtons}</div>` : ""}
        </div>
        <div class="selected-body">
          <div class="selected-section">
            <h3>${escapeHtml(card.name)}</h3>
            <p class="selected-number-line">${escapeHtml(card.number)}</p>
            <div class="detail-badges">
              ${detailBadges
                .map((badge) => {
                  const filterAttrs = badge.filterGroup
                    ? ` data-detail-filter-group="${escapeHtml(badge.filterGroup)}" data-detail-filter-value="${escapeHtml(badge.filterValue)}"`
                    : "";
                  const queryAttrs = badge.queryToken ? ` data-detail-query-token="${escapeHtml(badge.queryToken)}"` : "";
                  const titleText = `${badge.label} でカード検索`;
                  return `<button type="button" class="detail-pill is-filterable" aria-label="${escapeHtml(titleText)}" title="${escapeHtml(titleText)}"${filterAttrs}${queryAttrs}>${escapeHtml(badge.label)}</button>`;
                })
                .join("")}
            </div>
            ${
              detailTags.length
                ? `<div class="detail-tag-strip">
                    ${detailTags
                      .map(
                        (tag) =>
                          `<button type="button" class="detail-pill detail-pill--soft is-filterable" data-detail-filter-group="${escapeHtml(tag.group)}" data-detail-filter-value="${escapeHtml(tag.value)}">${escapeHtml(tag.label)}</button>`,
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>
          <div class="selected-section">
            <p class="selected-copy">${escapeHtml(card.text || "テキストなし")}</p>
          </div>
          ${
            faqItems.length
              ? `<div class="selected-section">
                  <div class="diagnostic-head">
                    <h3>公式Q&amp;A</h3>
                    <span>${card.faq.length}件</span>
                  </div>
                  <div class="faq-list">
                    ${faqItems
                      .map(
                        (faq) => `
                          <div class="faq-item">
                            <strong>${escapeHtml(faq.id)} / ${escapeHtml(faq.date)}</strong>
                            <p>${escapeHtml(faq.question)}</p>
                            <p>${escapeHtml(faq.answer)}</p>
                          </div>
                        `,
                      )
                      .join("")}
                  </div>
                </div>`
              : ""
          }
        </div>
      </div>
    </article>
  `;
}

function renderSelectedCardInto(container, card) {
  if (!container) return;
  if (!card) {
    container.innerHTML = `<div class="empty-state"><p>カードを選択してください。</p></div>`;
    return;
  }
  container.innerHTML = buildSelectedCardMarkupClean(card);
  bindSelectedCardVariantButtons(container, card);
}

function renderSelectedCard() {
  const card = CARD_LOOKUP.get(state.selectedCardId);
  renderSelectedCardInto(elements.selectedCardDetails, card);
  renderSelectedCardInto(elements.detailModalContent, card);
}

function drawOpeningHand() {
  const mainDeck = expandDeck("main");
  if (mainDeck.length < 5) {
    state.openingHand = [];
    renderOpeningHand();
    return;
  }
  state.openingHand = shuffle(mainDeck)
    .slice(0, 5)
    .map((cardId) => CARD_LOOKUP.get(cardId))
    .filter(Boolean);
  renderOpeningHand();
}

function renderOpeningHand() {
  elements.openingHand.innerHTML = "";
  if (!state.openingHand.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<p>まだ初手を引いていません。</p><span>50枚構築後に「5枚引く」を押してください。</span>";
    elements.openingHand.appendChild(empty);
    return;
  }

  state.openingHand.forEach((card) => {
    const variant = getCardVariant(card);
    const article = document.createElement("article");
    article.className = "hand-card";
    article.innerHTML = `
      <div class="card-art is-previewable" role="button" tabindex="0" aria-label="${escapeHtml(card.name)} の詳細を開く">
        <img src="${variant.imageUrl}" alt="${escapeHtml(card.name)}" loading="lazy" />
      </div>
    `;
    const artButton = article.querySelector(".card-art");
    artButton?.addEventListener("click", () => {
      openCardDetails(card.id, "side", "sim");
    });
    artButton?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openCardDetails(card.id, "side", "sim");
    });
    elements.openingHand.appendChild(article);
  });
}

function isSupportCard(card) {
  return (
    hasCardType(card, "PILOT") ||
    hasCardType(card, "BASE") ||
    (hasCardType(card, "COMMAND") && (card.cost ?? 9) <= 2) ||
    /ドロー|サーチ|リソース|回復|レスト/i.test(card.text)
  );
}

function handHasLinkPair(cards) {
  return cards.some((unit) => {
    if (!unit.links.length) return false;
    return cards.some(
      (candidate) =>
        candidate.id !== unit.id &&
        unit.links.some(
          (condition) =>
            candidate.name.includes(condition) ||
            candidate.traits.includes(condition) ||
            candidate.title.includes(condition),
        ),
    );
  });
}

function checkOpeningHand(handCards, preset, focusIds, focusRequireAll, requireBase) {
  const hasLowUnit = handCards.some((card) => hasCardType(card, "UNIT") && (card.level ?? 99) <= 3);
  const hasBase = handCards.some((card) => hasCardType(card, "BASE"));
  const hasSupport = handCards.some(isSupportCard);
  const aggroCount = handCards.filter(
    (card) => (hasCardType(card, "UNIT") && (card.level ?? 99) <= 3) || /ダメージ|速攻|AP\+|レイド/i.test(card.text),
  ).length;
  const linkable = handHasLinkPair(handCards);

  const focusMatched = focusIds.length
    ? focusRequireAll
      ? focusIds.every((focusId) => handCards.some((card) => card.id === focusId))
      : focusIds.some((focusId) => handCards.some((card) => card.id === focusId))
    : true;

  let success = false;
  if (preset === "balanced") success = hasLowUnit && hasSupport;
  if (preset === "link") success = hasLowUnit && linkable;
  if (preset === "aggro") success = aggroCount >= 2;
  if (preset === "focus") success = focusMatched && hasLowUnit;
  if (requireBase) success = success && hasBase;

  return { success, hasLowUnit, hasSupport, hasBase, linkable, focusMatched };
}

function runOpeningCheck() {
  const mainDeck = expandDeck("main");
  if (mainDeck.length !== 50) {
    state.lastCheck = { message: "メインデッキを50枚にしてから初手チェックを実行してください。" };
    renderCheckResult();
    return;
  }

  const focusIds = [...elements.focusCards.selectedOptions].map((option) => option.value);
  const preset = elements.checkPreset.value;
  const focusRequireAll = elements.focusRequireAll.checked;
  const requireBase = elements.requireBaseToggle.checked;
  let successCount = 0;
  let sampleSuccess = null;
  let sampleFailure = null;

  for (let index = 0; index < 2000; index += 1) {
    const handIds = shuffle(mainDeck).slice(0, 5);
    const handCards = handIds.map((cardId) => CARD_LOOKUP.get(cardId)).filter(Boolean);
    const result = checkOpeningHand(handCards, preset, focusIds, focusRequireAll, requireBase);
    if (result.success) {
      successCount += 1;
      if (!sampleSuccess) sampleSuccess = handCards;
    } else if (!sampleFailure) {
      sampleFailure = handCards;
    }
  }

  state.lastCheck = {
    rate: (successCount / 2000) * 100,
    preset,
    focusIds,
    focusRequireAll,
    requireBase,
    sampleSuccess,
    sampleFailure,
  };
  renderCheckResult();
}

function renderCheckResult() {
  if (!state.lastCheck) {
    elements.checkResult.textContent = "メインデッキを50枚にすると、初手チェックを実行できます。";
    return;
  }
  if (state.lastCheck.message) {
    elements.checkResult.textContent = state.lastCheck.message;
    return;
  }

  const focusText = state.lastCheck.focusIds.length
    ? state.lastCheck.focusIds.map((cardId) => CARD_LOOKUP.get(cardId)?.name).filter(Boolean).join(" / ")
    : "なし";
  const successNames = state.lastCheck.sampleSuccess?.map((card) => card.name).join(" / ") || "-";
  const failureNames = state.lastCheck.sampleFailure?.map((card) => card.name).join(" / ") || "-";

  elements.checkResult.innerHTML = `
    <strong>成功率 ${state.lastCheck.rate.toFixed(1)}%</strong>
    <p>プリセット: ${escapeHtml(state.lastCheck.preset)} / 注目カード: ${escapeHtml(focusText)}</p>
    <p>成功例: ${escapeHtml(successNames)}</p>
    <p>失敗例: ${escapeHtml(failureNames)}</p>
  `;
}

function getPrimaryDeckType(card) {
  const tokens = card?.typeTokens || [card?.type];
  return DECK_TYPE_ORDER.find((type) => tokens.includes(type)) || card?.type || "OTHER";
}

function getDeckTypeRank(card) {
  const index = DECK_TYPE_ORDER.indexOf(getPrimaryDeckType(card));
  return index === -1 ? 99 : index;
}

function sortDeckByLevel() {
  state.deck.main.sort((left, right) => {
    const cardA = CARD_LOOKUP.get(left.cardId);
    const cardB = CARD_LOOKUP.get(right.cardId);
    return (
      (cardA?.level ?? 99) - (cardB?.level ?? 99) ||
      (cardA?.cost ?? 99) - (cardB?.cost ?? 99) ||
      getDeckTypeRank(cardA) - getDeckTypeRank(cardB) ||
      String(cardA?.number || "").localeCompare(String(cardB?.number || ""), "ja")
    );
  });
  render();
}

function sortDeckByType() {
  state.deck.main.sort((left, right) => {
    const cardA = CARD_LOOKUP.get(left.cardId);
    const cardB = CARD_LOOKUP.get(right.cardId);
    return (
      getDeckTypeRank(cardA) - getDeckTypeRank(cardB) ||
      (cardA?.level ?? 99) - (cardB?.level ?? 99) ||
      String(cardA?.number || "").localeCompare(String(cardB?.number || ""), "ja")
    );
  });
  render();
}

function getDefaultResourceCard() {
  return (
    ALL_CARDS.find((card) => card.number === "R-001") ||
    ALL_CARDS.find((card) => card.isResourceCard && card.packageId === "615801") ||
    ALL_CARDS.find((card) => card.isResourceCard)
  );
}

function autoFillResources() {
  const resourceCard =
    CARD_LOOKUP.get(state.selectedCardId) && CARD_LOOKUP.get(state.selectedCardId).isResourceCard
      ? CARD_LOOKUP.get(state.selectedCardId)
      : getDefaultResourceCard();

  if (!resourceCard) return;
  state.deck.resource = [{ cardId: resourceCard.id, qty: 10 }];
  render();
}

function performClearDeck() {
  state.deck.main = [];
  state.deck.token = [];
  state.deck.resource = [];
  state.openingHand = [];
  state.lastCheck = null;
  state.aiDiagnosis = createEmptyAiDiagnosis();
  render();
}

function clearDeck() {
  openConfirmModal({
    title: "デッキを消去しますか？",
    message: "現在のメインデッキ、トークン、初手チェック結果を消去します。",
    acceptLabel: "消去する",
    onAccept: () => {
      performClearDeck();
      closeConfirmModal();
    },
  });
}

function serializeCurrentDeck() {
  return {
    version: 4,
    id: state.deck.id,
    name: state.deck.name,
    note: state.deck.note,
    main: state.deck.main.map((item) => [item.cardId, item.qty]),
    token: state.deck.token.map((item) => [item.cardId, item.qty]),
    resource: state.deck.resource.map((item) => [item.cardId, item.qty]),
    aiDiagnosis: state.aiDiagnosis?.text ? state.aiDiagnosis : null,
    updatedAt: new Date().toISOString(),
  };
}

function loadDeck(payload) {
  state.deck.id = payload.id || `deck-${Date.now()}`;
  state.deck.name = payload.name || "Imported Deck";
  state.deck.note = payload.note || "";
  setDeckZone("main", payload.main || []);
  setDeckZone("token", payload.token || []);
  setDeckZone("resource", payload.resource || []);
  state.openingHand = [];
  state.lastCheck = null;
  state.aiDiagnosis = payload.aiDiagnosis ? { ...createEmptyAiDiagnosis(), ...payload.aiDiagnosis } : createEmptyAiDiagnosis();
  render();
}

function saveCurrentDeck({ duplicate = false } = {}) {
  const payload = serializeCurrentDeck();
  const existingIndex = state.savedDecks.findIndex((deck) => deck.id === payload.id);
  if (existingIndex >= 0 && !duplicate) {
    state.savedDecks[existingIndex] = payload;
  } else {
    payload.id = `deck-${Date.now()}`;
    state.deck.id = payload.id;
    state.savedDecks.unshift(payload);
  }
  persistDecks();
  renderSavedDecks();
}

function safeFileName(value) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "gundam-deck";
}

function exportDeck() {
  const blob = new Blob([JSON.stringify(serializeCurrentDeck(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(state.deck.name)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function encodeDeckToHash(payload) {
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeDeckFromHash(value) {
  try {
    const json = decodeURIComponent(escape(atob(value.replace(/-/g, "+").replace(/_/g, "/"))));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function copyShareUrl() {
  const url = `${window.location.href.split("#")[0]}#deck=${encodeDeckToHash(serializeCurrentDeck())}`;
  try {
    await navigator.clipboard.writeText(url);
    const label = elements.copyShareButton.textContent;
    elements.copyShareButton.textContent = "コピー済み";
    window.setTimeout(() => {
      elements.copyShareButton.textContent = label;
    }, 1400);
  } catch {
    window.location.hash = `deck=${encodeDeckToHash(serializeCurrentDeck())}`;
  }
}

function hydrateFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith("deck=")) return;
  const payload = decodeDeckFromHash(hash.slice(5));
  if (payload) loadDeck(payload);
}

function deckToText() {
  const lines = [state.deck.name, state.deck.note, "", "Main Deck"];
  state.deck.main.forEach((entry) => {
    const card = CARD_LOOKUP.get(entry.cardId);
    if (!card) return;
    lines.push(`${entry.qty} ${card.number} ${card.name}`);
  });
  lines.push("", "Token Deck");
  state.deck.token.forEach((entry) => {
    const card = CARD_LOOKUP.get(entry.cardId);
    if (!card) return;
    lines.push(`${entry.qty} ${card.number} ${card.name}`);
  });
  return lines.join("\n");
}

async function copyDecklist() {
  const text = deckToText();
  try {
    await navigator.clipboard.writeText(text);
    const label = elements.copyDecklistButton.textContent;
    elements.copyDecklistButton.textContent = "コピー済み";
    window.setTimeout(() => {
      elements.copyDecklistButton.textContent = label;
    }, 1400);
  } catch {
    window.prompt("デッキリストをコピーしてください。", text);
  }
}

function renderSavedDecks() {
  elements.savedDeckList.innerHTML = "";
  if (!state.savedDecks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<p>まだ保存済みデッキがありません。</p><span>ローカル保存するとここに追加されます。</span>";
    elements.savedDeckList.appendChild(empty);
  } else {
    state.savedDecks.forEach((deck) => {
      const item = document.createElement("div");
      item.className = "saved-item";
      item.innerHTML = `
        <strong>${escapeHtml(deck.name)}</strong>
        <p>${escapeHtml(deck.note || "メモなし")}</p>
        <p>${escapeHtml(new Date(deck.updatedAt).toLocaleString("ja-JP"))}</p>
        <div class="saved-actions">
          <button type="button" data-action="load">読込</button>
          <button type="button" data-action="delete">削除</button>
        </div>
      `;
      item.querySelector('[data-action="load"]').addEventListener("click", () => loadDeck(deck));
      item.querySelector('[data-action="delete"]').addEventListener("click", () => {
        state.savedDecks = state.savedDecks.filter((saved) => saved.id !== deck.id);
        persistDecks();
        renderSavedDecks();
      });
      elements.savedDeckList.appendChild(item);
    });
  }

  if (!elements.starterList?.isConnected) return;
  elements.starterList.innerHTML = "";
  RAW_DB.packages.slice(0, PACKAGE_SHORTCUT_LIMIT).forEach((pkg) => {
    const item = document.createElement("div");
    item.className = "saved-item";
    item.innerHTML = `
      <strong>${escapeHtml(pkg.name)}</strong>
      <p>この商品に絞り込んだカード一覧をすぐに表示できます。</p>
      <div class="saved-actions">
        <button type="button" data-action="filter">一覧を見る</button>
      </div>
    `;
    item.querySelector('[data-action="filter"]').addEventListener("click", () => {
      clearFilters();
      state.filters.packages.add(pkg.name);
      setActiveDeckZone("main");
      state.activeTab = "deck";
      render();
    });
    elements.starterList.appendChild(item);
  });
}

function renderFocusCards() {
  const selectedValues = new Set([...elements.focusCards.selectedOptions].map((option) => option.value));
  const cards = state.deck.main
    .map((entry) => CARD_LOOKUP.get(entry.cardId))
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, "ja"));
  elements.focusCards.innerHTML = "";
  cards.forEach((card) => {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = `${card.name} (${card.number})`;
    option.selected = selectedValues.has(card.id);
    elements.focusCards.appendChild(option);
  });
}

function renderDatabaseMeta() {
  elements.dbSourceCount.textContent = `${RAW_DB.cardCount || ALL_CARDS.length}枚 / ${RAW_DB.packageCount || RAW_DB.packages.length}商品`;
  if (RAW_DB.generatedAt) {
    elements.dbStamp.textContent = `DB更新 ${new Date(RAW_DB.generatedAt).toLocaleString("ja-JP")}`;
  } else {
    elements.dbStamp.textContent = "DB更新 --";
  }
}

function renderThemeToggle() {
  document.body.dataset.theme = state.theme;
  if (elements.searchInput) {
    elements.searchInput.placeholder = getSearchPlaceholder(state.theme);
  }
  const brandName = state.theme === "red" ? "Z-Lab" : "G-Lab";
  const heroLogo = document.querySelector(".hero-logo-image");
  const heroWordmark = document.querySelector(".hero-logo-wordmark text");
  const heroSiteName = document.querySelector(".hero-site-name");
  if (heroLogo) {
    heroLogo.setAttribute("aria-label", `${brandName} Gundam Deck Builder`);
  }
  if (heroWordmark) {
    heroWordmark.textContent = brandName;
  }
  if (heroSiteName) {
    heroSiteName.textContent = brandName;
  }
  if (!elements.themeToggleButton) return;
  const nextTheme = state.theme === "light" ? "red" : "light";
  const nextThemeLabel = nextTheme === "red" ? "赤テーマ" : "白テーマ";
  elements.themeToggleButton.classList.toggle("is-red", state.theme === "red");
  elements.themeToggleButton.setAttribute("aria-label", `${nextThemeLabel}に切り替える`);
  elements.themeToggleButton.setAttribute("title", `${nextThemeLabel}に切り替える`);
}

function renderTabs() {
  document.querySelectorAll(".side-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.activeTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${state.activeTab}`);
  });
  updateSectionTopButtons();
}

function renderDeckZoneTabs() {
  elements.deckZoneTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.deckZone === state.activeDeckZone);
  });
  document.querySelectorAll(".deck-zone-pages").forEach((pages) => {
    pages.dataset.deckZone = state.activeDeckZone;
  });
  document.querySelectorAll("[data-zone-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.zonePanel === state.activeDeckZone);
  });
}

function renderTokenEmptyState() {
  const empty = elements.tokenDeckList?.querySelector(".empty-state");
  if (!empty) return;
  empty.innerHTML = `
    <p>トークンはまだありません。</p>
    <span>カード一覧からトークンやEX系カードを追加してください。</span>
  `;
}

function renderViewButtons() {
  document.querySelectorAll(".view-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function renderMobileState() {
  document.body.dataset.mobileView = state.mobileView;
  const filterDrawerOpen = state.isFilterDrawerOpen;
  const sideDrawerOpen = state.isSideDrawerOpen && isMobileViewport();
  const detailDrawerOpen = state.isDetailDrawerOpen && isMobileViewport();
  const compareModalOpen = document.body.classList.contains("is-compare-modal-open");
  document.body.classList.toggle("is-filter-drawer-open", filterDrawerOpen);
  document.body.classList.toggle("is-side-drawer-open", sideDrawerOpen);
  document.body.classList.toggle("is-detail-drawer-open", detailDrawerOpen);
  document.querySelectorAll("[data-mobile-view-target]").forEach((button) => {
    const target = button.dataset.mobileViewTarget;
    const isActive = target === "detail" ? detailDrawerOpen : target === state.mobileView;
    button.classList.toggle("is-active", isActive);
  });
  if (elements.mobileFilterFab) {
    elements.mobileFilterFab.classList.add("is-hidden");
    elements.mobileFilterFab.classList.remove("is-active");
    elements.mobileFilterFab.setAttribute("aria-hidden", "true");
  }
  if (elements.mobileBottomFilterButton) {
    elements.mobileBottomFilterButton.classList.toggle("is-active", filterDrawerOpen);
  }
  if (elements.desktopFilterButton) {
    elements.desktopFilterButton.classList.toggle("is-active", filterDrawerOpen);
    elements.desktopFilterButton.classList.toggle("is-hidden", filterDrawerOpen);
    elements.desktopFilterButton.setAttribute("aria-expanded", filterDrawerOpen ? "true" : "false");
  }
  if (elements.mobileDeckFab) {
    const catalogControlActive = sideDrawerOpen || filterDrawerOpen;
    elements.mobileDeckFab.classList.toggle("is-active", catalogControlActive);
    elements.mobileDeckFab.setAttribute("aria-expanded", catalogControlActive ? "true" : "false");
    const deckFabLabel = !sideDrawerOpen
      ? "カード一覧を開く"
      : filterDrawerOpen
        ? "検索を閉じる"
        : "検索を開く";
    elements.mobileDeckFab.setAttribute("aria-label", deckFabLabel);
    elements.mobileDeckFab.setAttribute("title", deckFabLabel);
  }
  if (elements.mobileCompareFab) {
    const canShowCompareFab = isMobileViewport() && sideDrawerOpen;
    elements.mobileCompareFab.classList.toggle("is-hidden", !canShowCompareFab && !compareModalOpen);
    elements.mobileCompareFab.classList.toggle("is-active", compareModalOpen);
    elements.mobileCompareFab.setAttribute("aria-hidden", !canShowCompareFab && !compareModalOpen ? "true" : "false");
  }
  updateSectionTopButtons();
}

function clearFilters() {
  state.query = "";
  state.preset = "";
  state.showExtras = false;
  Object.values(state.filters).forEach((set) => set.clear());
}

function render() {
  if (!["main", "token"].includes(state.quickAddTarget)) {
    state.quickAddTarget = state.activeDeckZone;
  }
  syncDesktopPanelLayout();
  renderThemeToggle();
  elements.searchInput.value = state.query;
  elements.quickAddTarget.value = state.quickAddTarget;
  elements.catalogSort.value = state.sort;
  elements.showExtraCards.checked = state.showExtras;
  renderFavoriteControls();
  elements.deckNameInput.value = state.deck.name;
  elements.deckNoteInput.value = state.deck.note;
  renderDatabaseMeta();
  renderViewButtons();
  renderTabs();
  renderDeckZoneTabs();
  renderMobileState();
  renderFilterGroups();
  renderFilterAccordionCounts();
  renderCatalog();
  renderCompareBar();
  renderDeckList("main", elements.mainDeckList);
  renderDeckList("token", elements.tokenDeckList);
  renderTokenEmptyState();
  renderStats();
  renderAiDiagnosis();
  renderReferenceDecks();
  renderCurve();
  renderSelectedCard();
  renderSavedDecks();
  renderCloudSyncPanel();
  renderFocusCards();
  renderOpeningHand();
  renderCheckResult();
  updateSectionTopButtons();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderCatalog();
  });

  elements.quickAddTarget.addEventListener("change", (event) => {
    state.quickAddTarget = event.target.value;
    if (event.target.value === "main" || event.target.value === "token") {
      setActiveDeckZone(event.target.value, { syncTarget: false });
    }
    render();
  });

  elements.catalogSort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderCatalog();
  });

  elements.showExtraCards.addEventListener("change", (event) => {
    state.showExtras = event.target.checked;
    render();
  });

  elements.favoriteOnlyToggle?.addEventListener("change", (event) => {
    state.onlyFavorites = event.target.checked;
    render();
  });

  elements.deckNameInput.addEventListener("input", (event) => {
    state.deck.name = event.target.value;
  });

  elements.deckNoteInput.addEventListener("input", (event) => {
    state.deck.note = event.target.value;
  });

  elements.themeToggleButton?.addEventListener("click", () => {
    if (document.body.classList.contains("is-theme-switching")) return;
    document.body.classList.remove("is-theme-switching-in", "is-theme-switching-bg");
    document.body.classList.add("is-theme-switching", "is-theme-switching-out");
    window.setTimeout(() => {
      document.body.classList.remove("is-theme-switching-out");
      document.body.classList.add("is-theme-switching-bg");
      state.theme = state.theme === "light" ? "red" : "light";
      persistTheme();
      renderThemeToggle();
      renderAiDiagnosis();
      window.setTimeout(() => {
        document.body.classList.add("is-theme-switching-in");
        window.setTimeout(() => {
          document.body.classList.remove("is-theme-switching", "is-theme-switching-bg", "is-theme-switching-in");
        }, THEME_SWITCH_IN_MS);
      }, THEME_SWITCH_BG_MS);
    }, THEME_SWITCH_OUT_MS);
  });

  elements.resetFiltersButton.addEventListener("click", () => {
    clearFilters();
    render();
  });

  elements.mobileFilterFab?.addEventListener("click", () => {
    if (state.isFilterDrawerOpen) {
      closeFilterDrawer();
    } else {
      openFilterDrawer();
    }
    renderMobileState();
  });

  elements.mobileTopFab?.addEventListener("click", () => {
    scrollToTopTarget(getActiveMobileTopTarget());
  });

  elements.mobileBottomFilterButton?.addEventListener("click", () => {
    if (state.isFilterDrawerOpen) {
      closeFilterDrawer();
    } else {
      openFilterDrawer();
    }
    renderMobileState();
  });

  elements.desktopFilterButton?.addEventListener("click", () => {
    if (state.isFilterDrawerOpen) {
      closeFilterDrawer();
    } else {
      openFilterDrawer();
    }
    renderMobileState();
  });

  elements.closeFiltersButton?.addEventListener("click", () => {
    closeFilterDrawer();
    renderMobileState();
  });

  elements.mobileDrawerBackdrop?.addEventListener("click", () => {
    if (state.isDetailDrawerOpen) {
      restoreFromDetailDrawer();
    } else if (state.isFilterDrawerOpen) {
      closeFilterDrawer();
    } else {
      closeSideDrawer();
      closeDetailDrawer();
    }
    renderMobileState();
  });

  elements.mobileDeckFab?.addEventListener("click", () => {
    if (!state.isSideDrawerOpen) {
      openSideDrawer();
    } else if (!state.isFilterDrawerOpen) {
      openFilterDrawer();
    } else {
      closeFilterDrawer();
    }
    renderTabs();
    renderMobileState();
  });

  elements.mobileCompareFab?.addEventListener("click", () => {
    if (document.body.classList.contains("is-compare-modal-open")) {
      closeCompareModal();
    } else {
      openCompareModal();
    }
  });

  document.querySelectorAll(".section-top-button").forEach((button) => {
    button.addEventListener("click", () => {
      scrollToTopTarget(getSectionScrollTarget(button.dataset.scrollTarget || ""));
    });
  });

  [
    window,
    elements.filtersPanel,
    elements.catalogPanel,
    elements.sidePanel,
    elements.inspectorPanel,
    elements.detailModalContent,
    elements.compareModalContent,
  ]
    .filter(Boolean)
    .forEach((target) => {
      const handler = () => updateSectionTopButtons();
      if (target === window) {
        window.addEventListener("scroll", handler, { passive: true });
      } else {
        target.addEventListener("scroll", handler, { passive: true });
      }
    });

  elements.detailDrawerClose?.addEventListener("click", () => {
    restoreFromDetailDrawer();
    renderMobileState();
  });

  elements.detailModalClose?.addEventListener("click", closeDetailModal);
  elements.detailModal?.addEventListener("click", (event) => {
    if (event.target === elements.detailModal) {
      closeDetailModal();
    }
  });

  elements.openCompareButton?.addEventListener("click", openCompareModal);
  elements.clearCompareButton?.addEventListener("click", clearCompare);
  elements.compareModalClose?.addEventListener("click", closeCompareModal);
  elements.compareModal?.addEventListener("click", (event) => {
    if (event.target === elements.compareModal) {
      closeCompareModal();
    }
  });
  elements.referenceModalClose?.addEventListener("click", closeReferenceModal);
  elements.referenceModal?.addEventListener("click", (event) => {
    if (event.target === elements.referenceModal) {
      closeReferenceModal();
    }
  });

  elements.confirmCancelButton?.addEventListener("click", closeConfirmModal);
  elements.confirmModal?.addEventListener("click", (event) => {
    if (event.target === elements.confirmModal) {
      closeConfirmModal();
    }
  });
  elements.confirmAcceptButton?.addEventListener("click", () => {
    if (typeof confirmAcceptHandler === "function") {
      confirmAcceptHandler();
      return;
    }
    closeConfirmModal();
  });

  elements.imagePreviewClose?.addEventListener("click", closeImagePreview);
  elements.imagePreviewModal?.addEventListener("click", (event) => {
    if (event.target === elements.imagePreviewModal) {
      closeImagePreview();
    }
  });

  document.querySelectorAll(".mini-reset").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.filterGroup;
      if (!group || !state.filters[group]) return;
      state.filters[group].clear();
      render();
    });
  });

  document.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.preset = button.dataset.preset || "";
      render();
    });
  });

  document.querySelectorAll(".view-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view || "grid";
      render();
    });
  });

  document.querySelectorAll("[data-mobile-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.mobileViewTarget || "catalog";
      if (target === "detail" && isMobileViewport()) {
        openDetailDrawer();
        renderSelectedCard();
        renderMobileState();
        return;
      }
      setMobileView(target);
      renderMobileState();
    });
  });

  document.querySelectorAll(".side-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab || "deck";
      elements.sidePanel?.scrollTo({ top: 0, behavior: "auto" });
      if (isMobileViewport()) {
        setMobileView("side");
      }
      renderTabs();
      renderMobileState();
    });
  });

  elements.deckZoneTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveDeckZone(button.dataset.deckZone || "main");
      render();
    });
  });

  document.querySelectorAll(".deck-zone-pages").forEach((pages) => {
    let touchStartX = 0;
    let touchEndX = 0;
    pages.addEventListener(
      "touchstart",
      (event) => {
        touchStartX = event.changedTouches[0]?.clientX || 0;
      },
      { passive: true },
    );
    pages.addEventListener(
      "touchend",
      (event) => {
        touchEndX = event.changedTouches[0]?.clientX || 0;
        const delta = touchEndX - touchStartX;
        if (Math.abs(delta) < 40) return;
        if (delta < 0) {
          setActiveDeckZone("token");
        } else {
          setActiveDeckZone("main");
        }
        render();
      },
      { passive: true },
    );
  });

  document.querySelectorAll("#curvePageTabs [data-curve-page]").forEach((button) => {
    button.addEventListener("click", () => {
      setCurvePage(button.dataset.curvePage || "level");
    });
  });

  if (elements.curvePages) {
    let touchStartX = 0;
    let touchEndX = 0;
    elements.curvePages.addEventListener(
      "touchstart",
      (event) => {
        touchStartX = event.changedTouches[0]?.clientX || 0;
      },
      { passive: true },
    );
    elements.curvePages.addEventListener(
      "touchend",
      (event) => {
        touchEndX = event.changedTouches[0]?.clientX || 0;
        const delta = touchEndX - touchStartX;
        if (Math.abs(delta) < 40) return;
        if (delta < 0) {
          setCurvePage("type");
        } else {
          setCurvePage("level");
        }
      },
      { passive: true },
    );
  }

  elements.drawOpeningHandButton.addEventListener("click", drawOpeningHand);
  elements.runCheckButton.addEventListener("click", runOpeningCheck);
  elements.sortDeckByLevelButton?.addEventListener("click", () => {
    sortDeckByLevel();
    elements.sortDeckMenu?.removeAttribute("open");
  });
  elements.sortDeckByTypeButton?.addEventListener("click", () => {
    sortDeckByType();
    elements.sortDeckMenu?.removeAttribute("open");
  });
  elements.copyDecklistButton.addEventListener("click", copyDecklist);
  elements.toggleReferenceDecksButton?.addEventListener("click", openReferenceModal);
  elements.clearDeckButton.addEventListener("click", clearDeck);
  elements.runAiDiagnosisButton?.addEventListener("click", runAiDiagnosis);
  elements.cloudSignInButton?.addEventListener("click", () => {
    window.GLabCloud?.signIn?.({
      email: elements.cloudEmailInput?.value || "",
      password: elements.cloudPasswordInput?.value || "",
    });
  });
  elements.cloudRegisterButton?.addEventListener("click", () => {
    window.GLabCloud?.signUp?.({
      email: elements.cloudEmailInput?.value || "",
      password: elements.cloudPasswordInput?.value || "",
    });
  });
  elements.cloudSignOutButton?.addEventListener("click", () => {
    window.GLabCloud?.signOut?.();
  });
  elements.saveDeckButton.addEventListener("click", () => saveCurrentDeck({ duplicate: false }));
  elements.duplicateDeckButton.addEventListener("click", () => saveCurrentDeck({ duplicate: true }));
  elements.copyShareButton.addEventListener("click", copyShareUrl);
  elements.exportDeckButton.addEventListener("click", exportDeck);

  elements.importDeckInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const payload = JSON.parse(await file.text());
    loadDeck(payload);
    elements.importDeckInput.value = "";
  });

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) {
      closeFilterDrawer();
      closeSideDrawer();
      closeDetailDrawer();
    }
    syncDesktopPanelLayout();
    renderMobileState();
    updateSectionTopButtons();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeConfirmModal();
      closeImagePreview();
      closeDetailModal();
      closeCompareModal();
      closeReferenceModal();
      closeSideDrawer();
      if (state.isDetailDrawerOpen) {
        restoreFromDetailDrawer();
      } else {
        closeDetailDrawer();
      }
      renderMobileState();
    }
  });
}

function seedInitialDeck() {
  const suggestedMain = ALL_CARDS.filter(
    (card) => card.isMainDeckCard && ["Blue", "White"].includes(card.displayColor) && /^ST|^GD/.test(card.number),
  )
    .sort((left, right) => featuredScore(right) - featuredScore(left))
    .slice(0, 18);

  const units = suggestedMain.filter((card) => hasCardType(card, "UNIT")).slice(0, 8);
  const pilots = suggestedMain.filter((card) => hasCardType(card, "PILOT")).slice(0, 4);
  const commands = suggestedMain.filter((card) => hasCardType(card, "COMMAND")).slice(0, 4);
  const bases = suggestedMain.filter((card) => hasCardType(card, "BASE")).slice(0, 2);
  const seedCards = [...units, ...pilots, ...commands, ...bases];

  const zone = [];
  seedCards.forEach((card) => zone.push([card.id, hasCardType(card, "BASE") ? 2 : 3]));

  let count = zone.reduce((sum, [, qty]) => sum + qty, 0);
  const fillers = ALL_CARDS.filter(
    (card) => card.isMainDeckCard && ["Blue", "White"].includes(card.displayColor) && (card.level ?? 99) <= 4,
  ).sort((left, right) => featuredScore(right) - featuredScore(left));

  for (const filler of fillers) {
    if (count >= 50) break;
    const existing = zone.find((item) => item[0] === filler.id);
    if (existing) {
      while (existing[1] < 4 && count < 50) {
        existing[1] += 1;
        count += 1;
      }
    } else {
      zone.push([filler.id, Math.min(4, 50 - count)]);
      count = zone.reduce((sum, [, qty]) => sum + qty, 0);
    }
  }

  state.deck.name = "青白 サンプル構築";
  state.deck.note = "公式JPカードDBを使った初期サンプル。ここから差し替えていけます。";
  setDeckZone("main", zone);
  state.deck.token = [];
  state.deck.resource = [];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.GLabApp = {
  getCloudSnapshot,
  applyCloudSnapshot,
  updateCloudState,
};

seedInitialDeck();
setupDeckZoneUI();
setupDetailUI();
setupEnhancementUI();
bindEvents();
hydrateFromHash();
render();

