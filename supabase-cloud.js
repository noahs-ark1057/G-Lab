const DEFAULT_CONFIG = {
  url: "",
  anonKey: "",
  storageKey: "g-lab-supabase-session",
  table: "user_app_states",
};

const rawConfig = window.__GLAB_SUPABASE__ || {};
const config = {
  ...DEFAULT_CONFIG,
  ...rawConfig,
  url: String(rawConfig.url || DEFAULT_CONFIG.url).replace(/\/+$/, ""),
  anonKey: String(rawConfig.anonKey || DEFAULT_CONFIG.anonKey).trim(),
  storageKey: String(rawConfig.storageKey || DEFAULT_CONFIG.storageKey).trim() || DEFAULT_CONFIG.storageKey,
  table: String(rawConfig.table || DEFAULT_CONFIG.table).trim() || DEFAULT_CONFIG.table,
};

const app = window.GLabApp;

if (!app?.getCloudSnapshot || !app?.applyCloudSnapshot || !app?.updateCloudState) {
  console.warn("G-Lab app context is not ready for Supabase sync.");
} else {
  const state = {
    session: loadStoredSession(),
    syncTimer: null,
    syncBusy: false,
    pendingSnapshot: null,
    remoteRowExists: false,
  };

  window.GLabCloud = {
    signIn,
    signUp,
    signOut,
    syncNow: () => flushPendingSync("manual"),
    config,
  };

  // Backward-compat alias from earlier experiments.
  window.GLabFirebase = window.GLabCloud;

  window.addEventListener("glab:local-state", (event) => {
    if (!isConfigured() || !state.session?.access_token || !event.detail?.snapshot) return;
    queueSync(event.detail.snapshot, event.detail.reason || "local-state");
  });

  window.addEventListener("online", () => {
    if (!isConfigured() || !state.session?.access_token) return;
    queueSync(app.getCloudSnapshot(), "online");
  });

  void bootstrap();

  async function bootstrap() {
    if (!isConfigured()) {
      app.updateCloudState({
        configured: false,
        ready: false,
        status: "unconfigured",
        statusMessage: "Supabase 未設定です。supabase-config.js に URL と anon key を入れてください。",
        user: null,
        lastSyncedAt: "",
      });
      return;
    }

    app.updateCloudState({
      configured: true,
      ready: false,
      status: state.session ? "syncing" : "signed_out",
      statusMessage: state.session
        ? "Supabase セッションを確認しています。"
        : "Supabase にログインすると、保存デッキなどをユーザーごとに同期できます。",
      user: state.session?.user || null,
      lastSyncedAt: "",
    });

    if (!state.session) return;

    try {
      await ensureSession();
      await syncWithServer("restore-session");
    } catch (error) {
      clearStoredSession();
      app.updateCloudState({
        configured: true,
        ready: false,
        status: "error",
        statusMessage: getErrorMessage(error, "Supabase セッションの復元に失敗しました。"),
        user: null,
        lastSyncedAt: "",
      });
    }
  }

  function isConfigured() {
    return /^https?:\/\//.test(config.url) && Boolean(config.anonKey);
  }

  function loadStoredSession() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(config.storageKey) || "null");
      return normalizeSession(parsed);
    } catch {
      return null;
    }
  }

  function normalizeSession(session) {
    if (!session || typeof session !== "object" || !session.access_token) return null;
    return {
      ...session,
      expires_at:
        Number(session.expires_at) ||
        Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
      user: session.user || null,
    };
  }

  function storeSession(session) {
    const normalized = normalizeSession(session);
    state.session = normalized;
    if (!normalized) {
      clearStoredSession();
      return null;
    }
    window.localStorage.setItem(config.storageKey, JSON.stringify(normalized));
    return normalized;
  }

  function clearStoredSession() {
    state.session = null;
    state.remoteRowExists = false;
    window.localStorage.removeItem(config.storageKey);
  }

  function sessionNeedsRefresh(session = state.session) {
    if (!session?.expires_at) return false;
    return session.expires_at <= Math.floor(Date.now() / 1000) + 45;
  }

  async function ensureSession() {
    if (!state.session) return null;

    if (sessionNeedsRefresh(state.session) && state.session.refresh_token) {
      const refreshed = await apiRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        auth: false,
        body: { refresh_token: state.session.refresh_token },
      });
      storeSession(refreshed);
    }

    const user = await apiRequest("/auth/v1/user", { auth: true });
    if (state.session) {
      state.session.user = user;
      storeSession(state.session);
    }
    return state.session;
  }

  function buildHeaders({ auth = true, json = true, extra = {} } = {}) {
    const headers = {
      apikey: config.anonKey,
      ...extra,
    };
    if (json) headers["Content-Type"] = "application/json";
    if (auth && state.session?.access_token) {
      headers.Authorization = `Bearer ${state.session.access_token}`;
    }
    return headers;
  }

  async function readResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function apiRequest(path, { method = "GET", body, auth = true, headers = {} } = {}) {
    const response = await fetch(`${config.url}${path}`, {
      method,
      headers: buildHeaders({ auth, json: body !== undefined, extra: headers }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await readResponse(response);
    if (!response.ok) {
      const message =
        payload?.msg ||
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `Supabase error ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  function parseDate(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeSavedDecks(localDecks = [], remoteDecks = []) {
    const merged = new Map();
    [...remoteDecks, ...localDecks].forEach((deck, index) => {
      if (!deck || typeof deck !== "object") return;
      const id = deck.id || `deck-${index}`;
      const current = merged.get(id);
      if (!current || parseDate(deck.updatedAt) >= parseDate(current.updatedAt)) {
        merged.set(id, clone(deck));
      }
    });
    return [...merged.values()].sort((left, right) => parseDate(right.updatedAt) - parseDate(left.updatedAt));
  }

  function mergeReferenceHistory(localHistory = [], remoteHistory = []) {
    const merged = new Map();
    [...remoteHistory, ...localHistory].forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const id = entry.id || `${entry.deckName || "history"}-${entry.eventDate || ""}-${index}`;
      const current = merged.get(id);
      if (!current || parseDate(entry.loadedAt) >= parseDate(current.loadedAt)) {
        merged.set(id, clone(entry));
      }
    });
    return [...merged.values()]
      .sort((left, right) => parseDate(right.loadedAt) - parseDate(left.loadedAt))
      .slice(0, 24);
  }

  function mergeSnapshots(localSnapshot, remoteSnapshot) {
    return {
      savedDecks: mergeSavedDecks(localSnapshot?.savedDecks || [], remoteSnapshot?.savedDecks || []),
      favorites: [...new Set([...(remoteSnapshot?.favorites || []), ...(localSnapshot?.favorites || [])])],
      theme:
        remoteSnapshot?.theme === "red" || remoteSnapshot?.theme === "light"
          ? remoteSnapshot.theme
          : localSnapshot?.theme === "red"
            ? "red"
            : "light",
      referenceHistory: mergeReferenceHistory(
        localSnapshot?.referenceHistory || [],
        remoteSnapshot?.referenceHistory || [],
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  function snapshotToRow(snapshot) {
    return {
      user_id: state.session?.user?.id,
      email: state.session?.user?.email || null,
      saved_decks: Array.isArray(snapshot?.savedDecks) ? snapshot.savedDecks : [],
      favorites: Array.isArray(snapshot?.favorites) ? snapshot.favorites : [],
      theme: snapshot?.theme === "red" ? "red" : "light",
      reference_history: Array.isArray(snapshot?.referenceHistory) ? snapshot.referenceHistory : [],
      updated_at: new Date().toISOString(),
    };
  }

  function rowToSnapshot(row) {
    if (!row || typeof row !== "object") return null;
    return {
      savedDecks: Array.isArray(row.saved_decks) ? row.saved_decks : [],
      favorites: Array.isArray(row.favorites) ? row.favorites : [],
      theme: row.theme === "red" ? "red" : "light",
      referenceHistory: Array.isArray(row.reference_history) ? row.reference_history : [],
      updatedAt: row.updated_at || "",
    };
  }

  async function fetchRemoteSnapshot() {
    const userId = state.session?.user?.id;
    if (!userId) return null;

    const query =
      `/rest/v1/${encodeURIComponent(config.table)}` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      "&select=user_id,email,saved_decks,favorites,theme,reference_history,updated_at&limit=1";

    const rows = await apiRequest(query, {
      auth: true,
      headers: { Accept: "application/json" },
    });

    const row = Array.isArray(rows) ? rows[0] : null;
    state.remoteRowExists = Boolean(row);
    return rowToSnapshot(row);
  }

  async function saveRemoteSnapshot(snapshot) {
    const row = snapshotToRow(snapshot);
    if (!row.user_id) {
      throw new Error("Supabase user id を取得できません。");
    }

    if (state.remoteRowExists) {
      await apiRequest(
        `/rest/v1/${encodeURIComponent(config.table)}?user_id=eq.${encodeURIComponent(row.user_id)}`,
        {
          method: "PATCH",
          auth: true,
          headers: { Prefer: "return=representation" },
          body: {
            email: row.email,
            saved_decks: row.saved_decks,
            favorites: row.favorites,
            theme: row.theme,
            reference_history: row.reference_history,
            updated_at: row.updated_at,
          },
        },
      );
    } else {
      await apiRequest(`/rest/v1/${encodeURIComponent(config.table)}`, {
        method: "POST",
        auth: true,
        headers: { Prefer: "return=representation" },
        body: row,
      });
      state.remoteRowExists = true;
    }

    app.updateCloudState({
      configured: true,
      ready: true,
      authBusy: false,
      status: "connected",
      statusMessage: "Supabase と同期済みです。",
      user: state.session?.user || null,
      lastSyncedAt: row.updated_at,
    });
  }

  async function syncWithServer(reason = "sync") {
    if (!state.session?.access_token) return;

    await ensureSession();
    app.updateCloudState({
      configured: true,
      ready: false,
      status: "syncing",
      statusMessage:
        reason === "sign-in"
          ? "Supabase から保存内容を読み込んでいます。"
          : "Supabase と同期しています。",
      user: state.session?.user || null,
    });

    const localSnapshot = app.getCloudSnapshot();
    const remoteSnapshot = await fetchRemoteSnapshot();
    const mergedSnapshot = remoteSnapshot ? mergeSnapshots(localSnapshot, remoteSnapshot) : localSnapshot;

    app.applyCloudSnapshot(mergedSnapshot);
    await saveRemoteSnapshot(mergedSnapshot);
  }

  function queueSync(snapshot, reason = "update") {
    if (!snapshot) return;
    state.pendingSnapshot = clone(snapshot);
    window.clearTimeout(state.syncTimer);
    state.syncTimer = window.setTimeout(() => {
      void flushPendingSync(reason);
    }, 450);
  }

  async function flushPendingSync(reason = "update") {
    if (state.syncBusy || !state.pendingSnapshot || !state.session?.access_token) return;

    state.syncBusy = true;
    const snapshot = state.pendingSnapshot;
    state.pendingSnapshot = null;

    try {
      app.updateCloudState({
        configured: true,
        ready: false,
        status: "syncing",
        statusMessage: reason === "manual" ? "Supabase に手動同期しています。" : "Supabase に保存しています。",
        user: state.session?.user || null,
      });

      await ensureSession();
      await saveRemoteSnapshot(snapshot);
    } catch (error) {
      app.updateCloudState({
        configured: true,
        ready: false,
        authBusy: false,
        status: "error",
        statusMessage: getErrorMessage(error, "Supabase との同期に失敗しました。"),
        user: state.session?.user || null,
      });
    } finally {
      state.syncBusy = false;
      if (state.pendingSnapshot) {
        void flushPendingSync(reason);
      }
    }
  }

  async function signIn({ email, password }) {
    if (!isConfigured()) return;

    if (!email || !password) {
      app.updateCloudState({
        configured: true,
        authBusy: false,
        status: "error",
        statusMessage: "メールアドレスとパスワードを入力してください。",
        user: null,
      });
      return;
    }

    app.updateCloudState({
      configured: true,
      authBusy: true,
      status: "syncing",
      statusMessage: "Supabase にログインしています。",
      user: null,
    });

    try {
      const session = await apiRequest("/auth/v1/token?grant_type=password", {
        method: "POST",
        auth: false,
        body: { email, password },
      });

      storeSession(session);
      await syncWithServer("sign-in");
      app.updateCloudState({
        configured: true,
        ready: true,
        authBusy: false,
        status: "connected",
        statusMessage: "ログインしました。保存内容は自動で同期されます。",
        user: state.session?.user || null,
      });
    } catch (error) {
      clearStoredSession();
      app.updateCloudState({
        configured: true,
        ready: false,
        authBusy: false,
        status: "error",
        statusMessage: getErrorMessage(error, "Supabase へのログインに失敗しました。"),
        user: null,
      });
    }
  }

  async function signUp({ email, password }) {
    if (!isConfigured()) return;

    if (!email || !password) {
      app.updateCloudState({
        configured: true,
        authBusy: false,
        status: "error",
        statusMessage: "メールアドレスとパスワードを入力してください。",
        user: null,
      });
      return;
    }

    app.updateCloudState({
      configured: true,
      authBusy: true,
      status: "syncing",
      statusMessage: "Supabase に新規登録しています。",
      user: null,
    });

    try {
      const payload = await apiRequest("/auth/v1/signup", {
        method: "POST",
        auth: false,
        body: { email, password },
      });

      if (payload?.session?.access_token) {
        storeSession(payload.session);
        await syncWithServer("sign-up");
        app.updateCloudState({
          configured: true,
          ready: true,
          authBusy: false,
          status: "connected",
          statusMessage: "新規登録が完了しました。保存内容を同期しています。",
          user: state.session?.user || null,
        });
        return;
      }

      app.updateCloudState({
        configured: true,
        ready: false,
        authBusy: false,
        status: "signed_out",
        statusMessage: "確認メールを送信しました。確認後にログインしてください。",
        user: null,
      });
    } catch (error) {
      app.updateCloudState({
        configured: true,
        ready: false,
        authBusy: false,
        status: "error",
        statusMessage: getErrorMessage(error, "Supabase への新規登録に失敗しました。"),
        user: null,
      });
    }
  }

  async function signOut() {
    if (!state.session?.access_token) return;

    app.updateCloudState({
      configured: true,
      authBusy: true,
      status: "syncing",
      statusMessage: "Supabase からログアウトしています。",
      user: state.session?.user || null,
    });

    try {
      await apiRequest("/auth/v1/logout", {
        method: "POST",
        auth: true,
      });
    } catch {
      // ローカル破棄を優先する。
    }

    clearStoredSession();
    app.updateCloudState({
      configured: true,
      ready: false,
      authBusy: false,
      status: "signed_out",
      statusMessage: "ログアウトしました。この端末のローカル保存はそのまま残ります。",
      user: null,
      lastSyncedAt: "",
    });
  }

  function getErrorMessage(error, fallback) {
    const message = String(error?.message || "").trim();
    return message || fallback;
  }
}
