import {
  memo,
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  isValidElement,
  type CSSProperties,
  type UIEvent,
} from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  TbArrowLeft,
  TbBrandOpenai,
  TbChevronDown,
  TbChevronRight,
  TbCode,
  TbDeviceLaptop,
  TbDownload,
  TbFile,
  TbFolder,
  TbLock,
  TbMessageCircle,
  TbPlus,
  TbRefresh,
  TbSearch,
  TbSettings,
  TbTerminal2,
  TbWifiOff,
  TbX,
} from "react-icons/tb";
import { SiClaude, SiCursor } from "react-icons/si";
import {
  BottomSheet,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  useKeyboard,
} from "./mobile";
import {
  activateGatewayConnection,
  activeConnection,
  loadGatewayConnections,
  readWebGatewayCredentials,
  removeGatewayConnection,
  saveGatewayConnection,
  updateGatewayConnectionName,
  type GatewayConnectionStore,
  type SavedGatewayConnection,
} from "./credential-store";
import { loadAppPreferences, saveAppPreferences } from "./app-preferences";
import { openGatewaySessionEventStream, type GatewaySessionStreamHandle } from "./gateway-session-stream";

type AgentName = "Cursor" | "Claude" | "Codex";
type SessionStatus = "running" | "attention" | "done" | "cancelled" | "failed";
type SessionView = "recent" | "projects";
type SessionSyncState = "idle" | "loading" | "refreshing" | "fresh" | "stale" | "error";
type PermissionMode = "plan" | "ask" | "auto" | "full";

const permissionChoices: Array<{
  id: Exclude<PermissionMode, "plan">;
  title: string;
  description: string;
}> = [
  { id: "ask", title: "受限执行", description: "规划或只读" },
  { id: "auto", title: "自动执行", description: "白名单内可写" },
  { id: "full", title: "完全允许", description: "自动批准工具" },
];

type AgentSession = {
  id: string;
  nativeId?: string;
  source: "gateway" | "native";
  resumable: boolean;
  cwd: string;
  projectId: string;
  agent: AgentName;
  title: string;
  project: string;
  branch: string;
  status: SessionStatus;
  updatedAt: string;
  time: string;
  unread?: boolean;
  cached?: boolean;
};

type ProjectGroup = {
  id: string;
  name: string;
  sessions: AgentSession[];
};

type DetailMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  kind?: "message" | "stream" | "tool" | "diagnostic" | "error";
};

type DetailTurn = {
  id: string;
  hasQuestion: boolean;
  messages: DetailMessage[];
};

type PinnedQuestionMotion = "forward" | "backward";

type RemoteSessionFile = {
  blob: Blob;
  name: string;
  contentType: string;
  size: number;
};

type FilePreviewState = {
  reference: string;
  name: string;
  status: "loading" | "ready" | "error";
  contentType?: string;
  size?: number;
  blob?: Blob;
  url?: string;
  text?: string;
  error?: string;
};

type SessionFileBridge = {
  load: (reference: string) => Promise<RemoteSessionFile>;
  open: (reference: string) => void;
};

const filters: Array<"全部" | AgentName> = ["全部", "Cursor", "Claude", "Codex"];
const SESSION_DISPLAY_LIMIT = 20;
const PROJECT_SESSION_LIMIT = 20;
const ACTIVE_SESSION_POLL_MS = 1_000;
const BACKGROUND_SYNC_MS = 15_000;
const AGENT_USAGE_REFRESH_MS = 60_000;
const SESSION_CACHE_VERSION = 1;
const SESSION_CACHE_KEY = "remote-agent.session-cache.v1";
const PROJECT_EXPANSION_KEY = "remote-agent.project-expansion.v1";
const SESSION_READ_STATE_KEY = "remote-agent.session-read-state.v1";
const MAX_CACHED_SESSIONS = 200;
const MERMAID_MAX_TEXT_SIZE = 20_000;
const initialCredentials = readWebGatewayCredentials();

// Clean up stale caches with mismatched versions on Web platform startup
if (typeof window !== "undefined" && typeof localStorage !== "undefined" && !Capacitor.isNativePlatform()) {
  try {
    const cacheKeys = Object.keys(localStorage).filter(key =>
      key.startsWith("remote-agent.session-cache.") ||
      key.startsWith("remote-agent.project-expansion.")
    );
    for (const key of cacheKeys) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
        if (typeof parsed === "object" && parsed !== null && parsed.version !== SESSION_CACHE_VERSION) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore cache cleanup errors
  }
}

let mermaidLoader: Promise<(typeof import("mermaid"))["default"]> | null = null;

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        maxTextSize: MERMAID_MAX_TEXT_SIZE,
        maxEdges: 200,
        theme: "dark",
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        themeVariables: {
          background: "#080d15",
          primaryColor: "#16213a",
          primaryTextColor: "#edf2ff",
          primaryBorderColor: "#5f82ee",
          secondaryColor: "#111a2b",
          tertiaryColor: "#0d1420",
          lineColor: "#8fa5dc",
          textColor: "#dce5f5",
        },
        flowchart: {
          htmlLabels: false,
          useMaxWidth: true,
        },
      });
      return mermaid;
    });
  }
  return mermaidLoader;
}

function MermaidDiagram({ definition }: { definition: string }) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const source = useMemo(() => definition.trim(), [definition]);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setSvg("");
    setError(false);

    if (!source || source.length > MERMAID_MAX_TEXT_SIZE) {
      setError(true);
      return () => {
        active = false;
      };
    }

    void loadMermaid()
      .then(async (mermaid) => {
        const parsed = await mermaid.parse(source, { suppressErrors: true });
        if (!parsed) throw new Error("Invalid Mermaid diagram");
        const rendered = await mermaid.render(`remote-agent-mermaid-${instanceId}`, source);
        if (active) setSvg(rendered.svg);
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, [instanceId, source]);

  if (error) {
    return (
      <figure className="mermaid-diagram is-error" data-testid="mermaid-fallback">
        <figcaption>图表语法无法解析，已显示源码</figcaption>
        <pre><code className="language-mermaid">{source}</code></pre>
      </figure>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-diagram is-loading" role="status" data-testid="mermaid-loading">
        <i aria-hidden="true" />
        <span>正在渲染图表…</span>
      </div>
    );
  }

  return (
    <figure className="mermaid-diagram" role="img" aria-label="Mermaid 图表" data-testid="mermaid-diagram">
      <div className="mermaid-diagram-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}

const LazyMarkdown = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  return {
    default: function MarkdownRenderer({
      text,
      fileBridge,
    }: {
      text: string;
      fileBridge?: SessionFileBridge;
    }) {
      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          urlTransform={markdownUrlTransform}
          components={{
            a: ({ href, children }) => href && fileBridge && isLocalFileReference(href) ? (
              <a
                href={href}
                className="markdown-local-file"
                onClick={(event) => {
                  event.preventDefault();
                  fileBridge.open(href);
                }}
              >
                <TbFile aria-hidden="true" />
                {children}
              </a>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
            ),
            img: ({ src, alt }) => {
              const reference = typeof src === "string" ? src : "";
              return reference && fileBridge && isLocalFileReference(reference)
                ? <RemoteMarkdownImage reference={reference} alt={alt ?? "会话文件图片"} bridge={fileBridge} />
                : <img src={reference} alt={alt ?? ""} />;
            },
            pre: ({ children }) => {
              const child = Array.isArray(children) ? children[0] : children;
              if (
                isValidElement<{ className?: string; children?: unknown }>(child)
                && child.props.className?.split(/\s+/).includes("language-mermaid")
              ) {
                return <MermaidDiagram definition={String(child.props.children ?? "").replace(/\n$/, "")} />;
              }
              return <pre>{children}</pre>;
            },
          }}
        >
          {text}
        </ReactMarkdown>
      );
    },
  };
});

export default function Prototype() {
  const keyboard = useKeyboard();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionView, setSessionView] = useState<SessionView>("recent");
  const [sessionSyncState, setSessionSyncState] = useState<SessionSyncState>("idle");
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null);
  const [syncRequest, setSyncRequest] = useState(0);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<(typeof filters)[number]>("全部");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [detailMessages, setDetailMessages] = useState<DetailMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailSending, setDetailSending] = useState(false);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [pinnedQuestionId, setPinnedQuestionId] = useState<string | null>(null);
  const [previousPinnedQuestionId, setPreviousPinnedQuestionId] = useState<string | null>(null);
  const [pinnedQuestionMotion, setPinnedQuestionMotion] = useState<PinnedQuestionMotion>("forward");
  const [pinnedQuestionExpanded, setPinnedQuestionExpanded] = useState(false);
  const [pinnedQuestionTruncated, setPinnedQuestionTruncated] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreviewState | null>(null);
  const [fileExporting, setFileExporting] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftAgent, setDraftAgent] = useState<AgentName>("Codex");
  const [draftPermissionMode, setDraftPermissionMode] = useState<Exclude<PermissionMode, "plan">>("ask");
  const [detailReply, setDetailReply] = useState("");
  const [alwaysConfirm, setAlwaysConfirm] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [gatewayUrl, setGatewayUrl] = useState(initialCredentials.url);
  const [gatewayToken, setGatewayToken] = useState(initialCredentials.token);
  const [savedConnections, setSavedConnections] = useState<SavedGatewayConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState("");
  const [pairingMode, setPairingMode] = useState(!initialCredentials.token);
  const [pairingUrl, setPairingUrl] = useState(initialCredentials.url);
  const [pairingCode, setPairingCode] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [deviceName, setDeviceName] = useState("Mac");
  const [pendingRevokeDevice, setPendingRevokeDevice] = useState<PairedDeviceApi | null>(null);
  const [detailCancelling, setDetailCancelling] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDeviceApi[]>([]);
  const [agentUsages, setAgentUsages] = useState<AgentUsageApi[] | null>(null);
  const [remoteOnline, setRemoteOnline] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const detailEventCursor = useRef(0);
  const detailStreamRef = useRef<HTMLDivElement | null>(null);
  const detailEndRef = useRef<HTMLDivElement | null>(null);
  const detailFollowOutputRef = useRef(true);
  const detailScrollTopRef = useRef(0);
  const detailPendingScrollRestoreRef = useRef<number | null>(null);
  const pinnedQuestionIdRef = useRef<string | null>(null);
  const detailPinFrameRef = useRef<number | null>(null);
  const pinnedQuestionLayerRef = useRef<HTMLDivElement | null>(null);
  const filePreviewObjectUrlRef = useRef<string | null>(null);
  const sessionFileCacheRef = useRef(new Map<string, Promise<RemoteSessionFile>>());
  const projectExpansionScope = useRef("");
  const selectedSessionRef = useRef<AgentSession | null>(null);

  useEffect(() => {
    document.title = "Remote Agent — 移动端控制台";
  }, []);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    if (!deviceOpen) setPendingRevokeDevice(null);
  }, [deviceOpen]);

  useEffect(() => {
    let active = true;
    loadAppPreferences()
      .then((preferences) => {
        if (!active) return;
        setAlwaysConfirm(preferences.defaultRestrictedExecution);
        setNotifications(preferences.agentStatusNotifications);
      })
      .catch(() => {
        // Preferences are optional UI state and must not block startup.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadGatewayConnections()
      .then((store) => {
        if (!active) return;
        const selected = activeConnection(store);
        setSavedConnections(store.connections);
        setActiveConnectionId(selected?.id ?? "");
        setGatewayUrl(selected?.url ?? initialCredentials.url);
        setGatewayToken(selected?.token ?? "");
        setPairingUrl(selected?.url ?? initialCredentials.url);
        setDeviceName(selected?.name ?? "Mac");
        setPairingMode(!selected);
      })
      .catch(() => {
        if (active) setNotice("无法读取设备安全存储");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const url = normalizeGatewayUrl(gatewayUrl);
    if (!url || !gatewayToken) {
      setRemoteOnline(false);
      setSessions([]);
      setSessionSyncState("idle");
      setCacheSavedAt(null);
      return;
    }
    const cached = readSessionCache(url);
    setRemoteOnline(false);
    if (cached) {
      setSessions(applySessionReadState(
        url,
        deduplicateSessions(cached.sessions),
        selectedSessionRef.current,
      ));
      setDeviceName(cached.hostname || "Mac");
      setCacheSavedAt(cached.savedAt);
      setSessionSyncState("refreshing");
    } else {
      setSessions([]);
      setCacheSavedAt(null);
      setSessionSyncState("loading");
    }
    let active = true;
    const synchronize = async (initial: boolean) => {
      if (initial) setConnectionBusy(true);
      try {
        const state = await loadRemoteState(url, gatewayToken);
        if (!active) return;
        const sessionsWithReadState = applySessionReadState(url, state.sessions, selectedSessionRef.current);
        setSessions((current) => sameSessions(current, sessionsWithReadState) ? current : sessionsWithReadState);
        setDeviceName(state.hostname);
        setPairedDevices((current) => samePairedDevices(current, state.devices) ? current : state.devices);
        setWorkingDirectory((current) => current || state.allowedRoots[0] || "");
        setRemoteOnline(true);
        const savedAt = new Date().toISOString();
        writeSessionCache(url, state.hostname, savedAt, sessionsWithReadState);
        setCacheSavedAt(savedAt);
        setSessionSyncState("fresh");
      } catch {
        if (active && initial) {
          setRemoteOnline(false);
          setSessionSyncState(cached ? "stale" : "error");
        }
      } finally {
        if (active && initial) setConnectionBusy(false);
      }
    };
    void synchronize(true);
    const timer = window.setInterval(() => void synchronize(false), BACKGROUND_SYNC_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [gatewayToken, gatewayUrl, syncRequest]);

  useEffect(() => {
    const url = normalizeGatewayUrl(gatewayUrl);
    setAgentUsages(null);
    if (!url || !gatewayToken || !remoteOnline) return;
    let active = true;
    const synchronizeUsage = async () => {
      try {
        const usages = await gatewayRequest<unknown>(url, "/v1/agents/usage", {
          token: gatewayToken,
        });
        if (active) setAgentUsages(normalizeAgentUsages(usages));
      } catch {
        if (active) setAgentUsages(unavailableAgentUsages("网关暂不支持额度读取"));
      }
    };
    void synchronizeUsage();
    const timer = window.setInterval(() => void synchronizeUsage(), AGENT_USAGE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [gatewayToken, gatewayUrl, remoteOnline]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!remoteOnline) return;
    const current = savedConnections.find((connection) => connection.id === activeConnectionId);
    if (!current || current.url !== normalizeGatewayUrl(gatewayUrl) || current.name === deviceName) return;
    let active = true;
    updateGatewayConnectionName(current.url, deviceName)
      .then((store) => {
        if (active) setSavedConnections(store.connections);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeConnectionId, deviceName, gatewayUrl, remoteOnline, savedConnections]);

  const deferredQuery = useDeferredValue(query);
  const visibleSessions = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    const filtered = sessions.filter((session) => {
      const agentMatches = filter === "全部" || session.agent === filter;
      const textMatches =
        !normalized ||
        `${session.title} ${session.project} ${session.branch} ${session.agent}`
          .toLocaleLowerCase()
          .includes(normalized);
      return agentMatches && textMatches;
    });
    return limitSessionsPerProject(filtered, PROJECT_SESSION_LIMIT);
  }, [deferredQuery, filter, sessions]);

  const displayedSessions = useMemo(
    () => visibleSessions.slice(0, SESSION_DISPLAY_LIMIT),
    [visibleSessions],
  );

  const projectGroups = useMemo(() => {
    const grouped = new Map<string, ProjectGroup>();
    for (const session of visibleSessions) {
      const existing = grouped.get(session.projectId);
      if (existing) {
        existing.sessions.push(session);
        continue;
      }
      grouped.set(session.projectId, {
        id: session.projectId,
        name: session.project,
        sessions: [session],
      });
    }
    return [...grouped.values()];
  }, [visibleSessions]);

  const knownProjects = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; cwd: string }>();
    for (const session of sessions) {
      const cwd = session.cwd.trim();
      if (!cwd || byId.has(session.projectId)) continue;
      byId.set(session.projectId, {
        id: session.projectId,
        name: session.project,
        cwd,
      });
    }
    return [...byId.values()];
  }, [sessions]);

  const selectedProjectId = useMemo(() => {
    const cwd = workingDirectory.trim();
    if (!cwd) return "";
    return knownProjects.find((project) => project.cwd === cwd)?.id ?? "__custom__";
  }, [knownProjects, workingDirectory]);

  const statusSummary = useMemo(() => ({
    running: visibleSessions.filter(
      (session) => session.status === "running" || session.status === "attention",
    ).length,
    unread: visibleSessions.filter((session) => session.status === "done" && session.unread).length,
  }), [visibleSessions]);
  const detailTurns = useMemo(() => groupDetailTurns(detailMessages), [detailMessages]);
  const pinnedQuestion = useMemo(
    () => detailMessages.find((message) => message.id === pinnedQuestionId && message.role === "user") ?? null,
    [detailMessages, pinnedQuestionId],
  );
  const previousPinnedQuestion = useMemo(
    () => detailMessages.find(
      (message) => message.id === previousPinnedQuestionId && message.role === "user",
    ) ?? null,
    [detailMessages, previousPinnedQuestionId],
  );

  useEffect(() => {
    const url = normalizeGatewayUrl(gatewayUrl);
    const stored = readExpandedProjects(url);
    setExpandedProjects(stored.ids);
    projectExpansionScope.current = stored.initialized ? url : "";
  }, [gatewayUrl]);

  useEffect(() => {
    if (sessionView !== "projects" || !projectGroups.length) return;
    const url = normalizeGatewayUrl(gatewayUrl);
    if (projectExpansionScope.current === url) return;
    projectExpansionScope.current = url;
    setExpandedProjects((current) => {
      const next = new Set(current);
      const first = projectGroups[0];
      if (first) next.add(first.id);
      writeExpandedProjects(url, next);
      return next;
    });
  }, [gatewayUrl, projectGroups, sessionView]);

  const toggleSearch = () => {
    if (searchOpen) {
      keyboard.hide();
      setSearchOpen(false);
      setQuery("");
      return;
    }
    setSearchOpen(true);
  };

  const selectAgentFilter = (nextFilter: (typeof filters)[number]) => {
    keyboard.hide();
    setFilter(nextFilter);
    if (nextFilter !== "全部") setDraftAgent(nextFilter);
  };

  const openNewSession = () => {
    keyboard.hide();
    if (filter !== "全部") setDraftAgent(filter);
    setDraftPermissionMode(alwaysConfirm ? "ask" : "auto");
    setNewSessionOpen(true);
  };

  const applyConnectionStore = useCallback((store: GatewayConnectionStore) => {
    const selected = activeConnection(store);
    setSavedConnections(store.connections);
    setActiveConnectionId(selected?.id ?? "");
    setGatewayUrl(selected?.url ?? "");
    setGatewayToken(selected?.token ?? "");
    setDeviceName(selected?.name ?? "Mac");
    setPairingUrl(selected?.url ?? "");
    setPairingMode(!selected);
    setPairedDevices([]);
    setAgentUsages(null);
    setWorkingDirectory("");
    setRemoteOnline(false);
    setSessions([]);
    setSessionSyncState(selected ? "loading" : "idle");
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    const url = normalizeGatewayUrl(gatewayUrl);
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      writeExpandedProjects(url, next);
      return next;
    });
  }, [gatewayUrl]);

  const createSessionInProject = useCallback((group: ProjectGroup) => {
    const cwd = group.sessions.find((session) => session.cwd)?.cwd;
    if (!remoteOnline || !cwd) {
      setNotice("正在连接 Mac，请同步完成后再发起会话");
      return;
    }
    keyboard.hide();
    setWorkingDirectory(cwd);
    setDraftPermissionMode(alwaysConfirm ? "ask" : "auto");
    setNewSessionOpen(true);
  }, [alwaysConfirm, keyboard, remoteOnline]);

  const releaseFilePreviewUrl = useCallback(() => {
    if (!filePreviewObjectUrlRef.current) return;
    URL.revokeObjectURL(filePreviewObjectUrlRef.current);
    filePreviewObjectUrlRef.current = null;
  }, []);

  const closeFilePreview = useCallback(() => {
    releaseFilePreviewUrl();
    setFileExporting(false);
    setFilePreview(null);
  }, [releaseFilePreviewUrl]);

  const loadSessionFile = useCallback((reference: string): Promise<RemoteSessionFile> => {
    const session = selectedSessionRef.current;
    if (!session) return Promise.reject(new Error("当前没有打开的会话"));
    if (!remoteOnline || !gatewayToken) return Promise.reject(new Error("Mac 未连接，暂时无法读取文件"));
    const cacheKey = `${normalizeGatewayUrl(gatewayUrl)}:${session.source}:${session.agent}:${session.id}:${reference}`;
    const cached = sessionFileCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const route = session.source === "gateway"
      ? `/v1/sessions/${encodeURIComponent(session.id)}/files/read`
      : `/v1/history/${agentToKind(session.agent)}/${encodeURIComponent(session.id)}/files/read`;
    const request = gatewayFileRequest(gatewayUrl, route, gatewayToken, reference).catch((error) => {
      sessionFileCacheRef.current.delete(cacheKey);
      throw error;
    });
    sessionFileCacheRef.current.set(cacheKey, request);
    return request;
  }, [gatewayToken, gatewayUrl, remoteOnline]);

  const openFilePreview = useCallback((reference: string) => {
    keyboard.hide();
    releaseFilePreviewUrl();
    setFilePreview({
      reference,
      name: fileNameFromReference(reference),
      status: "loading",
    });
    void loadSessionFile(reference)
      .then(async (file) => {
        const url = URL.createObjectURL(file.blob);
        const text = isTextPreview(file.contentType) && file.size <= 2 * 1024 * 1024
          ? await file.blob.text()
          : undefined;
        setFilePreview((current) => {
          if (current?.reference !== reference) {
            URL.revokeObjectURL(url);
            return current;
          }
          filePreviewObjectUrlRef.current = url;
          return {
            reference,
            name: file.name,
            status: "ready",
            contentType: file.contentType,
            size: file.size,
            blob: file.blob,
            url,
            ...(text !== undefined ? { text } : {}),
          };
        });
      })
      .catch((error) => {
        setFilePreview((current) => current?.reference === reference
          ? {
              ...current,
              status: "error",
              error: errorMessage(error),
            }
          : current);
      });
  }, [keyboard, loadSessionFile, releaseFilePreviewUrl]);

  const sessionFileBridge = useMemo<SessionFileBridge | undefined>(() => selectedSession ? ({
    load: loadSessionFile,
    open: openFilePreview,
  }) : undefined, [loadSessionFile, openFilePreview, selectedSession?.id]);

  const filePreviewMarkdownBridge = useMemo<SessionFileBridge | undefined>(() => (
    sessionFileBridge && filePreview
      ? {
          load: (reference) => sessionFileBridge.load(
            resolveNestedFileReference(filePreview.reference, reference),
          ),
          open: (reference) => sessionFileBridge.open(
            resolveNestedFileReference(filePreview.reference, reference),
          ),
        }
      : undefined
  ), [filePreview?.reference, sessionFileBridge]);

  const exportFilePreview = useCallback(async (preview: FilePreviewState) => {
    if (!preview.blob || fileExporting) return;
    setFileExporting(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const [{ Directory, Filesystem }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        const result = await Filesystem.writeFile({
          path: `remote-agent-exports/${Date.now()}-${safeExportFileName(preview.name)}`,
          data: await blobToBase64(preview.blob),
          directory: Directory.Cache,
          recursive: true,
        });
        await Share.share({
          title: preview.name,
          url: result.uri,
          dialogTitle: `导出 ${preview.name}`,
        });
        setNotice("已打开系统分享，可选择存储到文件或用其他应用打开");
      } else if (preview.url) {
        triggerWebDownload(preview.url, preview.name);
        setNotice("文件下载已开始");
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setFileExporting(false);
    }
  }, [fileExporting]);

  useEffect(() => {
    sessionFileCacheRef.current.clear();
    closeFilePreview();
  }, [activeConnectionId, closeFilePreview, selectedSession?.id]);

  const closeSessionDetail = useCallback(() => {
    keyboard.hide();
    closeFilePreview();
    detailFollowOutputRef.current = true;
    detailScrollTopRef.current = 0;
    detailPendingScrollRestoreRef.current = null;
    selectedSessionRef.current = null;
    setSelectedSession(null);
    setDetailReply("");
    setDetailError(null);
  }, [closeFilePreview, keyboard]);

  const openSession = useCallback(async (session: AgentSession) => {
    keyboard.hide();
    if (session.cached && !remoteOnline) {
      setNotice("正在同步最新数据，完成后即可打开会话");
      return;
    }
    const url = normalizeGatewayUrl(gatewayUrl);
    const openedSession = session.status === "done" && session.unread
      ? { ...session, unread: false }
      : session;
    detailFollowOutputRef.current = true;
    detailScrollTopRef.current = 0;
    detailPendingScrollRestoreRef.current = null;
    if (openedSession.status === "done" || openedSession.status === "cancelled") {
      markSessionRead(url, openedSession);
    }
    selectedSessionRef.current = openedSession;
    setSelectedSession(openedSession);
    if (openedSession !== session) {
      setSessions((current) => current.map((item) => (
        sessionIdentity(item) === sessionIdentity(session) ? openedSession : item
      )));
    }
    setDetailMessages([]);
    setDetailError(null);
    detailEventCursor.current = 0;
    if (!remoteOnline || !gatewayToken) return;
    setDetailLoading(true);
  }, [gatewayToken, gatewayUrl, keyboard, remoteOnline]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
    const listener = CapacitorApp.addListener("backButton", () => {
      if (keyboard.height > 0) {
        keyboard.hide();
        return;
      }
      if (filePreview) {
        closeFilePreview();
        return;
      }
      if (newSessionOpen) {
        setNewSessionOpen(false);
        return;
      }
      if (deviceOpen) {
        setDeviceOpen(false);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (selectedSession) {
        closeSessionDetail();
        return;
      }
      if (searchOpen) {
        setSearchOpen(false);
        setQuery("");
        return;
      }
      void CapacitorApp.minimizeApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [
    closeSessionDetail,
    closeFilePreview,
    deviceOpen,
    keyboard,
    filePreview,
    newSessionOpen,
    searchOpen,
    selectedSession,
    settingsOpen,
  ]);

  useEffect(() => {
    const session = selectedSession;
    if (!session || session.source !== "gateway" || !remoteOnline || !gatewayToken) return;
    let active = true;
    let pollTimer: number | undefined;
    let metadataTimer: number | undefined;
    let stream: GatewaySessionStreamHandle | null = null;
    let pollFallback = false;
    const url = normalizeGatewayUrl(gatewayUrl);
    const sessionPath = `/v1/sessions/${encodeURIComponent(session.id)}`;
    const eventsPath = `${sessionPath}/events?after=${detailEventCursor.current}`;

    const isLiveStatus = (status: SessionStatus | undefined) => (
      status === "running" || status === "attention"
    );

    const applySessionSnapshot = (remoteSession: GatewaySessionApi) => {
      const mapped = mapGatewaySession(remoteSession);
      const viewedSession = mapped.status === "done" || mapped.status === "cancelled"
        ? { ...mapped, unread: false }
        : mapped;
      if (viewedSession.status === "done" || viewedSession.status === "cancelled") {
        markSessionRead(url, viewedSession);
      }
      selectedSessionRef.current = viewedSession;
      setSelectedSession((current) => current?.id === viewedSession.id
        ? sameAgentSession(current, viewedSession) ? current : viewedSession
        : current);
      setSessions((current) => upsertSessionAtFront(current, viewedSession));
      return viewedSession;
    };

    const applyGatewayEvents = (events: GatewayEventApi[]) => {
      const fresh = events.filter((event) => event.seq > detailEventCursor.current);
      if (!fresh.length) return false;
      detailEventCursor.current = Math.max(
        detailEventCursor.current,
        ...fresh.map((event) => event.seq),
      );
      if (!detailFollowOutputRef.current && detailStreamRef.current) {
        detailPendingScrollRestoreRef.current = detailStreamRef.current.scrollTop;
      }
      setDetailMessages((current) => appendGatewayEvents(current, fresh));
      return fresh.some((event) => (
        event.type === "status" || event.type === "completed" || event.type === "error"
      ));
    };

    const refreshSessionSnapshot = async () => {
      const remoteSession = await gatewayRequest<GatewaySessionApi>(
        gatewayUrl,
        sessionPath,
        { token: gatewayToken },
      );
      if (!active) return null;
      return applySessionSnapshot(remoteSession);
    };

    const pollSynchronize = async () => {
      try {
        const [events, remoteSession] = await Promise.all([
          gatewayRequest<GatewayEventApi[]>(
            gatewayUrl,
            `${sessionPath}/events?after=${detailEventCursor.current}`,
            { token: gatewayToken },
          ),
          gatewayRequest<GatewaySessionApi>(gatewayUrl, sessionPath, { token: gatewayToken }),
        ]);
        if (!active) return;
        applyGatewayEvents(events);
        const viewedSession = applySessionSnapshot(remoteSession);
        setDetailError(null);
        if (active && pollFallback && isLiveStatus(viewedSession.status)) {
          pollTimer = window.setTimeout(() => void pollSynchronize(), ACTIVE_SESSION_POLL_MS);
        }
      } catch (error) {
        if (active) setDetailError(errorMessage(error));
        if (active && pollFallback) {
          pollTimer = window.setTimeout(() => void pollSynchronize(), ACTIVE_SESSION_POLL_MS);
        }
      } finally {
        if (active) setDetailLoading(false);
      }
    };

    const startPollingFallback = () => {
      if (pollFallback) return;
      pollFallback = true;
      if (metadataTimer !== undefined) {
        window.clearInterval(metadataTimer);
        metadataTimer = undefined;
      }
      stream?.close();
      stream = null;
      void pollSynchronize();
    };

    const startSessionMetadataPolling = () => {
      if (metadataTimer !== undefined) window.clearInterval(metadataTimer);
      metadataTimer = window.setInterval(() => {
        if (!active || pollFallback) return;
        void refreshSessionSnapshot().catch(() => undefined);
      }, ACTIVE_SESSION_POLL_MS);
    };

    const startEventStream = () => {
      if (pollFallback || !active) return;
      stream?.close();
      startSessionMetadataPolling();
      stream = openGatewaySessionEventStream({
        baseUrl: url,
        sessionId: session.id,
        token: gatewayToken,
        getAfterSeq: () => detailEventCursor.current,
        shouldContinue: () => active
          && selectedSessionRef.current?.id === session.id
          && isLiveStatus(selectedSessionRef.current?.status),
        callbacks: {
          onGatewayEvent: (payload) => {
            const event = payload as GatewayEventApi;
            if (!event || typeof event.seq !== "number") return;
            const needsSnapshot = applyGatewayEvents([event]);
            if (needsSnapshot) void refreshSessionSnapshot().catch(() => undefined);
          },
          onStreamError: () => {
            // Transient SSE errors are retried; persistent failures fall back to polling.
          },
          onStreamClosed: () => {
            if (!active) return;
            startPollingFallback();
          },
        },
      });
    };

    const bootstrap = async () => {
      try {
        if (isLiveStatus(session.status)) {
          const remoteSession = await gatewayRequest<GatewaySessionApi>(
            gatewayUrl,
            sessionPath,
            { token: gatewayToken },
          );
          if (!active) return;
          const viewedSession = applySessionSnapshot(remoteSession);
          setDetailError(null);
          if (isLiveStatus(viewedSession.status)) startEventStream();
        } else {
          const [events, remoteSession] = await Promise.all([
            gatewayRequest<GatewayEventApi[]>(gatewayUrl, eventsPath, { token: gatewayToken }),
            gatewayRequest<GatewaySessionApi>(gatewayUrl, sessionPath, { token: gatewayToken }),
          ]);
          if (!active) return;
          applyGatewayEvents(events);
          applySessionSnapshot(remoteSession);
          setDetailError(null);
        }
      } catch (error) {
        if (!active) return;
        setDetailError(errorMessage(error));
        if (isLiveStatus(session.status)) startPollingFallback();
      } finally {
        if (active) setDetailLoading(false);
      }
    };

    void bootstrap();
    return () => {
      active = false;
      stream?.close();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      if (metadataTimer !== undefined) window.clearInterval(metadataTimer);
    };
  }, [
    gatewayToken,
    gatewayUrl,
    remoteOnline,
    selectedSession?.id,
    selectedSession?.source,
    selectedSession?.status,
    detailRefreshToken,
  ]);

  useEffect(() => {
    const session = selectedSession;
    if (!session || session.source !== "native" || !remoteOnline || !gatewayToken) return;
    let active = true;
    let timer: number | undefined;
    let continuePolling = session.status === "running" || session.status === "attention";

    const synchronize = async () => {
      try {
        const snapshot = await gatewayRequest<NativeHistorySnapshotApi>(
          gatewayUrl,
          `/v1/history/${agentToKind(session.agent)}/${encodeURIComponent(session.id)}/snapshot?limit=100`,
          { token: gatewayToken },
        );
        if (!active) return;
        const nextMessages = snapshot.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          kind: "message" as const,
        }));
        setDetailMessages((current) => {
          if (sameDetailMessages(current, nextMessages)) return current;
          if (!detailFollowOutputRef.current && detailStreamRef.current) {
            detailPendingScrollRestoreRef.current = detailStreamRef.current.scrollTop;
          }
          return nextMessages;
        });
        const mapped = mapNativeSession(snapshot.session);
        const viewedSession = mapped.status === "done"
          ? { ...mapped, unread: false }
          : { ...mapped, unread: session.unread };
        if (viewedSession.status === "done") {
          markSessionRead(normalizeGatewayUrl(gatewayUrl), viewedSession);
        }
        selectedSessionRef.current = viewedSession;
        continuePolling = viewedSession.status === "running" || viewedSession.status === "attention";
        setSelectedSession((current) => current && sessionIdentity(current) === sessionIdentity(viewedSession)
          ? sameAgentSession(current, viewedSession) ? current : viewedSession
          : current);
        setSessions((current) => upsertSessionAtFront(current, viewedSession));
        setDetailError(null);
      } catch (error) {
        if (active) setDetailError(errorMessage(error));
      } finally {
        if (active) setDetailLoading(false);
        if (active && continuePolling) {
          timer = window.setTimeout(() => void synchronize(), ACTIVE_SESSION_POLL_MS);
        }
      }
    };

    void synchronize();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    gatewayToken,
    gatewayUrl,
    remoteOnline,
    selectedSession?.id,
    selectedSession?.source,
    selectedSession?.status,
    detailRefreshToken,
  ]);

  const updatePinnedQuestion = useCallback((
    nextQuestionId: string | null,
    motion: PinnedQuestionMotion = "forward",
  ) => {
    if (pinnedQuestionIdRef.current === nextQuestionId) return;
    const previousQuestionId = pinnedQuestionIdRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPreviousPinnedQuestionId(
      nextQuestionId && previousQuestionId && !reducedMotion ? previousQuestionId : null,
    );
    setPinnedQuestionMotion(motion);
    setPinnedQuestionExpanded(false);
    setPinnedQuestionTruncated(false);
    pinnedQuestionIdRef.current = nextQuestionId;
    setPinnedQuestionId(nextQuestionId);
  }, []);

  const syncPinnedQuestion = useCallback((stream: HTMLDivElement) => {
    const questions = Array.from(
      stream.querySelectorAll<HTMLElement>('[data-testid^="user-question-"]:not(.is-pinned-copy)'),
    );
    if (!questions.length) {
      updatePinnedQuestion(null);
      return;
    }

    const streamRect = stream.getBoundingClientRect();
    const pinTopOffset = Number.parseFloat(
      getComputedStyle(stream).getPropertyValue("--detail-question-pin-top"),
    );
    const pinTop = streamRect.top + (Number.isFinite(pinTopOffset) ? pinTopOffset : 14);
    const currentSource = questions.find(
      (question) => question.dataset.questionId === pinnedQuestionIdRef.current,
    );
    const pinHeight = currentSource?.getBoundingClientRect().height
      ?? questions[0].getBoundingClientRect().height;
    const activationLine = pinTop + pinHeight + 10;
    let nextQuestionId: string | null = null;

    for (const question of questions) {
      if (question.getBoundingClientRect().top > activationLine) break;
      nextQuestionId = question.dataset.questionId ?? null;
    }

    const firstQuestionTop = questions[0].getBoundingClientRect().top;
    const firstQuestionId = questions[0].dataset.questionId ?? null;
    if (nextQuestionId === firstQuestionId && firstQuestionTop > pinTop + 1) {
      nextQuestionId = null;
    }
    const currentIndex = questions.findIndex(
      (question) => question.dataset.questionId === pinnedQuestionIdRef.current,
    );
    const nextIndex = questions.findIndex(
      (question) => question.dataset.questionId === nextQuestionId,
    );
    const motion: PinnedQuestionMotion = currentIndex >= 0 && nextIndex >= 0 && nextIndex < currentIndex
      ? "backward"
      : "forward";
    updatePinnedQuestion(nextQuestionId, motion);
  }, [updatePinnedQuestion]);

  const schedulePinnedQuestionSync = useCallback((stream = detailStreamRef.current) => {
    if (!stream || detailPinFrameRef.current !== null) return;
    detailPinFrameRef.current = window.requestAnimationFrame(() => {
      detailPinFrameRef.current = null;
      syncPinnedQuestion(stream);
    });
  }, [syncPinnedQuestion]);

  useEffect(() => () => {
    if (detailPinFrameRef.current !== null) {
      window.cancelAnimationFrame(detailPinFrameRef.current);
    }
  }, []);

  useEffect(() => {
    pinnedQuestionIdRef.current = null;
    setPinnedQuestionId(null);
    setPreviousPinnedQuestionId(null);
    setPinnedQuestionExpanded(false);
    setPinnedQuestionTruncated(false);
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!previousPinnedQuestionId) return;
    const timer = window.setTimeout(() => setPreviousPinnedQuestionId(null), 280);
    return () => window.clearTimeout(timer);
  }, [pinnedQuestionId, previousPinnedQuestionId]);

  useLayoutEffect(() => {
    const layer = pinnedQuestionLayerRef.current;
    const markdown = layer?.querySelector<HTMLElement>(".detail-markdown");
    if (!markdown || pinnedQuestionExpanded) return;
    const measure = () => {
      setPinnedQuestionTruncated(markdown.scrollHeight > markdown.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(markdown);
    return () => observer.disconnect();
  }, [pinnedQuestion?.id, pinnedQuestionExpanded]);

  useLayoutEffect(() => {
    const stream = detailStreamRef.current;
    if (!stream) return;
    const pendingScrollRestore = detailPendingScrollRestoreRef.current;
    if (pendingScrollRestore !== null) {
      stream.scrollTop = pendingScrollRestore;
      const frame = window.requestAnimationFrame(() => {
        if (detailFollowOutputRef.current || !detailStreamRef.current) {
          detailPendingScrollRestoreRef.current = null;
          return;
        }
        detailStreamRef.current.scrollTop = pendingScrollRestore;
        detailScrollTopRef.current = pendingScrollRestore;
        detailPendingScrollRestoreRef.current = null;
        schedulePinnedQuestionSync(detailStreamRef.current);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (!detailFollowOutputRef.current) {
      stream.scrollTop = detailScrollTopRef.current;
      schedulePinnedQuestionSync(stream);
      return;
    }
    detailEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    detailScrollTopRef.current = stream.scrollTop;
    schedulePinnedQuestionSync(stream);
  }, [detailMessages, schedulePinnedQuestionSync]);

  useLayoutEffect(() => {
    schedulePinnedQuestionSync();
  }, [schedulePinnedQuestionSync, selectedSession?.status]);

  const trackDetailScrollPosition = useCallback((event: UIEvent<HTMLDivElement>) => {
    const stream = event.currentTarget;
    if (detailPendingScrollRestoreRef.current !== null) return;
    const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    detailScrollTopRef.current = stream.scrollTop;
    detailFollowOutputRef.current = distanceFromBottom <= 72;
    schedulePinnedQuestionSync(stream);
  }, [schedulePinnedQuestionSync]);

  const createSession = async () => {
    const title = draft.trim();
    if (!title) {
      setNotice("先输入一条任务指令");
      return;
    }

    if (!remoteOnline || !gatewayToken) {
      setNewSessionOpen(false);
      setDeviceOpen(true);
      setNotice("请先连接 Mac");
      return;
    }
    if (!workingDirectory.trim()) {
      setNotice("先填写 Mac 上的工作目录");
      return;
    }
    setConnectionBusy(true);
    try {
      const created = await gatewayRequest<GatewaySessionApi>(gatewayUrl, "/v1/sessions", {
        method: "POST",
        token: gatewayToken,
        body: {
          agent: agentToKind(draftAgent),
          prompt: title,
          cwd: workingDirectory.trim(),
          permissionMode: draftPermissionMode,
        },
      });
      const mapped = mapGatewaySession(created);
      setSessions((current) => [mapped, ...current.filter((item) => item.id !== mapped.id)]);
      detailFollowOutputRef.current = true;
      detailScrollTopRef.current = 0;
      detailPendingScrollRestoreRef.current = null;
      setDetailMessages([]);
      setDetailError(null);
      detailEventCursor.current = 0;
      selectedSessionRef.current = mapped;
      setSelectedSession(mapped);
    } catch (error) {
      setNotice(errorMessage(error));
      setConnectionBusy(false);
      return;
    }
    setConnectionBusy(false);
    keyboard.hide();
    setFilter("全部");
    setDraft("");
    setNewSessionOpen(false);
    setNotice(`${draftAgent} 会话已启动，正在读取输出`);
  };

  const sendDetailReply = async () => {
    if (!detailReply.trim()) return;
    const currentSession = selectedSession;
    if (!currentSession) return;
    if (!remoteOnline || !gatewayToken) return;
    if (currentSession.source === "native" && !currentSession.resumable) {
      setDetailError("此原生历史仅支持浏览，无法继续会话");
      return;
    }
    if (
      currentSession.source === "gateway"
      && currentSession.status !== "done"
      && currentSession.status !== "cancelled"
      && currentSession.status !== "failed"
    ) {
      setDetailError("当前 Agent 仍在运行，请等待本轮完成后继续输入");
      return;
    }
    if (currentSession.source === "gateway" && !currentSession.nativeId) {
      setDetailError("Agent 尚未返回原生会话 ID，暂时无法继续");
      return;
    }

    const prompt = detailReply.trim();
    detailFollowOutputRef.current = true;
    setDetailSending(true);
    setDetailError(null);
    keyboard.hide();
    try {
      const path = currentSession.source === "native"
        ? `/v1/history/${agentToKind(currentSession.agent)}/${encodeURIComponent(currentSession.id)}/resume`
        : `/v1/sessions/${encodeURIComponent(currentSession.id)}/messages`;
      const updated = await gatewayRequest<GatewaySessionApi>(gatewayUrl, path, {
        method: "POST",
        token: gatewayToken,
        body: currentSession.source === "native"
          ? { prompt, permissionMode: alwaysConfirm ? "ask" : "auto" }
          : { prompt },
      });
      const mapped = mapGatewaySession(updated);
      if (currentSession.source === "native") detailEventCursor.current = 0;
      selectedSessionRef.current = mapped;
      setSelectedSession(mapped);
      setSessions((current) => [
        mapped,
        ...current.filter((item) => item.id !== mapped.id && item.id !== currentSession.id),
      ]);
      setDetailReply("");
      setDetailRefreshToken((current) => current + 1);
      setNotice("指令已发送，正在读取 Agent 输出");
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally {
      setDetailSending(false);
    }
  };

  const cancelRunningSession = async () => {
    const currentSession = selectedSession;
    if (!currentSession || currentSession.source !== "gateway") return;
    if (!remoteOnline || !gatewayToken) return;
    if (currentSession.status !== "running" && currentSession.status !== "attention") return;
    setDetailCancelling(true);
    setDetailError(null);
    try {
      const remoteSession = await gatewayRequest<GatewaySessionApi>(
        gatewayUrl,
        `/v1/sessions/${encodeURIComponent(currentSession.id)}/cancel`,
        { method: "POST", token: gatewayToken },
      );
      const mapped = mapGatewaySession(remoteSession);
      const viewedSession = { ...mapped, unread: false };
      markSessionRead(normalizeGatewayUrl(gatewayUrl), viewedSession);
      selectedSessionRef.current = viewedSession;
      setSelectedSession(viewedSession);
      setSessions((current) => upsertSessionAtFront(current, viewedSession));
      setDetailRefreshToken((current) => current + 1);
      setNotice("会话已取消");
    } catch (error) {
      setDetailError(errorMessage(error));
    } finally {
      setDetailCancelling(false);
    }
  };

  const pairDevice = async () => {
    const url = normalizeGatewayUrl(pairingUrl);
    if (!url) {
      setNotice("请输入 Mac 网关地址");
      return;
    }
    if (!/^\d{8}$/.test(pairingCode.trim())) {
      setNotice("请输入 Mac 上显示的 8 位配对码");
      return;
    }
    setConnectionBusy(true);
    try {
      const paired = await gatewayRequest<{ token: string; deviceName: string }>(
        url,
        "/v1/pairing/confirm",
        {
          method: "POST",
          body: { code: pairingCode.trim(), deviceName: mobileDeviceName() },
        },
      );
      const hostname = new URL(url).hostname || "Mac";
      const store = await saveGatewayConnection(url, paired.token, hostname);
      applyConnectionStore(store);
      setPairingCode("");
      setPairingMode(false);
      setNotice("Mac 配对成功");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const switchGatewayConnection = async (connection: SavedGatewayConnection) => {
    if (connection.id === activeConnectionId) {
      setPairingMode(false);
      return;
    }
    setConnectionBusy(true);
    try {
      const store = await activateGatewayConnection(connection.id);
      applyConnectionStore(store);
      setPairingMode(false);
      setDeviceOpen(false);
      setNotice(`正在连接 ${connection.name}`);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const disconnectDevice = async () => {
    if (!activeConnectionId) return;
    setConnectionBusy(true);
    try {
      const store = await removeGatewayConnection(activeConnectionId);
      const next = activeConnection(store);
      applyConnectionStore(store);
      setDeviceOpen(Boolean(next));
      setNotice(next ? `已移除当前 Mac，正在连接 ${next.name}` : "已从本机移除 Mac 连接");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const revokePairedDevice = async (device: PairedDeviceApi) => {
    if (!gatewayToken) return;
    setPendingRevokeDevice(null);
    setConnectionBusy(true);
    try {
      await gatewayRequest<{ id: string; revoked: boolean }>(
        gatewayUrl,
        `/v1/devices/${encodeURIComponent(device.id)}/revoke`,
        { method: "POST", token: gatewayToken },
      );
      if (device.current) {
        const store = activeConnectionId
          ? await removeGatewayConnection(activeConnectionId)
          : { version: 1 as const, activeId: "", connections: [] };
        const next = activeConnection(store);
        applyConnectionStore(store);
        setDeviceOpen(Boolean(next));
        setNotice(next ? `授权已撤销，正在连接 ${next.name}` : "当前设备授权已撤销");
      } else {
        setPairedDevices((current) => current.filter((item) => item.id !== device.id));
        setNotice(`已撤销 ${device.name}`);
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const activeSavedConnection = savedConnections.find(
    (connection) => connection.id === activeConnectionId,
  );
  const secureConnection = remoteOnline && normalizeGatewayUrl(gatewayUrl).startsWith("https://");
  const showingCachedSessions = sessions.some((session) => session.cached);
  const detailCanSend = Boolean(
    selectedSession && remoteOnline && gatewayToken && (
      selectedSession.source === "native"
        ? selectedSession.resumable
          && selectedSession.status !== "running"
          && selectedSession.status !== "attention"
        : Boolean(selectedSession.nativeId) && (
          selectedSession.status === "done"
          || selectedSession.status === "cancelled"
          || selectedSession.status === "failed"
        )
    ),
  );
  const detailHasLiveIndicator = Boolean(
    selectedSession?.status === "running",
  );
  const detailReplyPlaceholder = !selectedSession
    ? "继续输入指令…"
    : selectedSession.source === "native" && !selectedSession.resumable
      ? "仅查看"
      : !remoteOnline || !gatewayToken
        ? "Mac 未连接，暂时无法输入"
        : selectedSession.status === "running" || selectedSession.status === "attention"
          ? "Agent 运行中，完成后可继续"
          : selectedSession.source === "gateway" && !selectedSession.nativeId
            ? "仅查看"
            : detailSending
              ? "正在发送…"
              : "继续输入指令…";

  return (
    <div className="remote-app" data-testid="remote-app">
      <MobileScroll className="remote-scroll">
        <main className="remote-screen" aria-label="远程 Agent 会话">
          <header className="product-header">
            <h1>远程 Agent</h1>
            <button
              className="connection-status-button"
              type="button"
              onClick={() => setDeviceOpen(true)}
              aria-label="查看 Mac 连接状态"
              title={connectionBusy ? "正在同步" : remoteOnline ? "已连接" : "尚未连接"}
              data-testid="device-status"
            >
              <span className={`online-dot ${remoteOnline ? "is-online" : "is-offline"}`} />
              <span className="connection-name">
                {remoteOnline || showingCachedSessions
                  ? deviceName
                  : activeSavedConnection?.name ?? "未连接"}
              </span>
            </button>
          </header>

          <section className="session-section" aria-labelledby="recent-title">
            <div className="section-heading">
              <h2 id="recent-title">{sessionView === "recent" ? "最近会话" : "项目会话"}</h2>
              <div className="section-heading-actions">
                <div className="session-view-switch" role="tablist" aria-label="会话浏览方式">
                  <button
                    type="button"
                    className={sessionView === "recent" ? "is-selected" : ""}
                    onClick={() => setSessionView("recent")}
                    role="tab"
                    aria-selected={sessionView === "recent"}
                    data-testid="view-recent"
                  >
                    最近
                  </button>
                  <button
                    type="button"
                    className={sessionView === "projects" ? "is-selected" : ""}
                    onClick={() => setSessionView("projects")}
                    role="tab"
                    aria-selected={sessionView === "projects"}
                    data-testid="view-projects"
                  >
                    项目
                  </button>
                </div>
                <button
                  className={`search-trigger ${searchOpen ? "is-active" : ""}`}
                  type="button"
                  onClick={toggleSearch}
                  aria-expanded={searchOpen}
                  aria-label={searchOpen ? "关闭历史搜索" : "搜索历史会话"}
                  data-testid="search-toggle"
                >
                  {searchOpen ? <TbX aria-hidden="true" /> : <TbSearch aria-hidden="true" />}
                  <span>{searchOpen ? "关闭" : "搜索历史会话"}</span>
                </button>
              </div>
            </div>

            {searchOpen ? (
              <div className="search-field">
                <TbSearch aria-hidden="true" />
                <KeyboardInput
                  id="history-search"
                  value={query}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder="输入标题、项目或分支"
                  aria-label="搜索历史会话"
                  autoFocus
                  data-testid="history-search"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="清空搜索"
                    data-testid="search-clear"
                  >
                    <TbX aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div
              className="agent-filters"
              aria-label="按 Agent 筛选会话"
              role="tablist"
            >
              {filters.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? "is-selected" : ""}
                  onClick={() => selectAgentFilter(item)}
                  aria-pressed={filter === item}
                  aria-selected={filter === item}
                  role="tab"
                  data-testid={`filter-${item}`}
                >
                  <span className="agent-filter-copy">
                    <span>{item}</span>
                    {item === "全部" ? null : (
                      <AgentUsageStatus
                        agent={item}
                        usage={agentUsages?.find((usage) => kindToAgent(usage.agent) === item) ?? null}
                        connected={remoteOnline}
                      />
                    )}
                  </span>
                </button>
              ))}
            </div>

            <div className="filter-feedback" data-testid="filter-feedback">
              <div className="status-summary-group" role="status" aria-live="polite">
                <span className="status-summary-item is-running">
                  <i aria-hidden="true" />
                  <span>进行中</span>
                  <strong>{query !== deferredQuery ? "…" : statusSummary.running}</strong>
                </span>
                <span className="status-summary-item is-unread">
                  <i aria-hidden="true" />
                  <span>已完成 · 未读</span>
                  <strong>{query !== deferredQuery ? "…" : statusSummary.unread}</strong>
                </span>
              </div>
              {!selectedSession && remoteOnline ? (
                <button
                  className="new-session-button"
                  type="button"
                  onClick={openNewSession}
                  aria-label={filter === "全部" ? "发起新会话" : `发起 ${filter} 新会话`}
                  data-testid="new-session"
                  data-scroll-drag="ignore"
                >
                  <TbPlus aria-hidden="true" />
                  新会话
                </button>
              ) : null}
            </div>

            {sessionSyncState === "loading" || sessionSyncState === "refreshing" ? (
              <div className="session-sync-state is-loading" role="status" data-testid="session-sync-state">
                <i aria-hidden="true" />
                <span>
                  {sessionSyncState === "refreshing"
                    ? `正在同步最新会话 · 当前显示${formatCacheAge(cacheSavedAt)}缓存`
                    : "正在从 Mac 加载会话…"}
                </span>
              </div>
            ) : sessionSyncState === "stale" || sessionSyncState === "error" ? (
              <div className="session-sync-state is-stale" role="status" data-testid="session-sync-state">
                <span>
                  {sessionSyncState === "stale"
                    ? `同步失败 · 当前显示${formatCacheAge(cacheSavedAt)}缓存`
                    : "暂时无法加载 Mac 会话"}
                </span>
                <button type="button" onClick={() => setSyncRequest((current) => current + 1)}>
                  <TbRefresh aria-hidden="true" />重试
                </button>
              </div>
            ) : null}

            <div className="session-list" data-testid="session-list">
              {visibleSessions.length ? (
                sessionView === "projects" ? (
                  <div className="project-list" data-testid="project-list">
                    {projectGroups.map((group) => (
                      <ProjectGroupCard
                        key={group.id}
                        group={group}
                        expanded={Boolean(deferredQuery.trim()) || expandedProjects.has(group.id)}
                        canCreate={remoteOnline && !searchOpen}
                        onToggle={toggleProject}
                        onCreate={createSessionInProject}
                        onOpen={openSession}
                      />
                    ))}
                  </div>
                ) : (
                  displayedSessions.map((session) => (
                    <SessionRow
                      key={`${session.source}-${session.agent}-${session.id}`}
                      session={session}
                      onOpen={openSession}
                    />
                  ))
                )
              ) : (
                <div className={`empty-state ${remoteOnline ? "" : "is-disconnected"}`} role="status">
                  {sessionSyncState === "loading"
                    ? <TbRefresh className="loading-icon" aria-hidden="true" />
                    : remoteOnline
                      ? <TbSearch aria-hidden="true" />
                      : <TbWifiOff aria-hidden="true" />}
                  <strong>
                    {sessionSyncState === "loading"
                      ? "正在加载会话"
                      : remoteOnline
                        ? "没有找到会话"
                        : "连接 Mac 后查看真实会话"}
                  </strong>
                  <span>
                    {sessionSyncState === "loading"
                      ? "首次连接需要从 Mac 读取 Cursor、Claude 和 Codex 历史。"
                      : remoteOnline
                      ? "换一个关键词或 Agent 试试"
                      : "不会再显示模拟数据；配对成功后自动同步 Cursor、Claude 和 Codex。"}
                  </span>
                  {!remoteOnline && sessionSyncState !== "loading" ? (
                    <button type="button" onClick={() => setDeviceOpen(true)} data-testid="empty-connect">
                      连接 Mac
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </main>
      </MobileScroll>

      {!selectedSession ? (
        <nav className="bottom-nav" aria-label="主导航">
          <button className="is-active" type="button" aria-current="page">
            <TbMessageCircle aria-hidden="true" />
            <span>会话</span>
          </button>
          <button type="button" onClick={() => setDeviceOpen(true)} data-testid="nav-devices">
            <TbDeviceLaptop aria-hidden="true" />
            <span>设备</span>
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} data-testid="nav-settings">
            <TbSettings aria-hidden="true" />
            <span>设置</span>
          </button>
        </nav>
      ) : null}

      {notice ? <div className="toast" role="status">{notice}</div> : null}

      <BottomSheet
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        title="发起新会话"
        description="任务将在 Yuqi’s MacBook Pro 上执行"
        snap={0.76}
      >
        <div className="sheet-form">
          <label htmlFor="new-session-prompt">任务指令</label>
          <KeyboardTextarea
            id="new-session-prompt"
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="描述你希望 Agent 完成的工作…"
            data-testid="new-session-prompt"
          />
          {remoteOnline ? (
            <>
              {knownProjects.length > 0 ? (
                <>
                  <label htmlFor="new-session-project">项目</label>
                  <select
                    id="new-session-project"
                    value={selectedProjectId}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "" || value === "__custom__") return;
                      const project = knownProjects.find((item) => item.id === value);
                      if (project) setWorkingDirectory(project.cwd);
                    }}
                    data-testid="new-session-project"
                  >
                    <option value="">选择已有项目…</option>
                    {knownProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                    <option value="__custom__">手动输入路径…</option>
                  </select>
                </>
              ) : null}
              <label htmlFor="working-directory">Mac 工作目录</label>
              <KeyboardInput
                id="working-directory"
                value={workingDirectory}
                onChange={(event) => setWorkingDirectory(event.target.value)}
                placeholder="/Users/name/projects/app"
                data-testid="working-directory"
              />
            </>
          ) : null}
          <span className="field-caption">Agent</span>
          <div className="sheet-agent-picker" aria-label="选择 Agent">
            {(["Cursor", "Claude", "Codex"] as AgentName[]).map((agent) => (
              <button
                key={agent}
                type="button"
                className={draftAgent === agent ? "is-selected" : ""}
                onClick={() => setDraftAgent(agent)}
                aria-pressed={draftAgent === agent}
              >
                <AgentIcon agent={agent} />
                {agent}
              </button>
            ))}
          </div>
          <span className="field-caption">权限</span>
          <div className="sheet-permission-picker" aria-label="选择权限" data-testid="new-session-permission">
            {permissionChoices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={draftPermissionMode === choice.id ? "is-selected" : ""}
                onClick={() => setDraftPermissionMode(choice.id)}
                aria-pressed={draftPermissionMode === choice.id}
                data-testid={`permission-${choice.id}`}
              >
                <strong>{choice.title}</strong>
                <small>{choice.description}</small>
              </button>
            ))}
          </div>
          <button className="sheet-primary" type="button" onClick={createSession}>
            {connectionBusy ? "正在启动…" : "启动会话"}
          </button>
        </div>
      </BottomSheet>

      {selectedSession ? (
        <section
          className="session-detail-page"
          data-testid="session-detail"
          style={{ "--detail-keyboard-height": `${keyboard.height}px` } as CSSProperties}
        >
          <header className="session-detail-header">
            <button
              type="button"
              onClick={closeSessionDetail}
              aria-label="返回会话列表"
              data-testid="session-detail-back"
            >
              <TbArrowLeft aria-hidden="true" />
            </button>
            <span className="session-detail-heading">
              <strong>{selectedSession.title}</strong>
              <span className="session-detail-subline">
                <small>
                  {selectedSession.agent} · {selectedSession.project}
                  {selectedSession.source === "gateway" && selectedSession.branch
                    ? ` · ${selectedSession.branch}`
                    : ""}
                </small>
                <span className="session-detail-subline-meta">
                  <SessionStateIndicator session={selectedSession} placement="detail" />
                  {selectedSession.status === "cancelled" ? (
                    <span className="session-detail-status" data-testid="session-status-cancelled">已取消</span>
                  ) : null}
                  <time>{selectedSession.time}</time>
                </span>
              </span>
            </span>
            {selectedSession.source === "gateway"
              && (selectedSession.status === "running" || selectedSession.status === "attention") ? (
              <button
                type="button"
                className="session-detail-cancel"
                onClick={() => void cancelRunningSession()}
                disabled={detailCancelling || !remoteOnline}
                aria-label="取消运行中的会话"
                data-testid="session-cancel"
              >
                {detailCancelling ? <TbRefresh aria-hidden="true" /> : "取消"}
              </button>
            ) : null}
            <AgentIcon agent={selectedSession.agent} framed />
          </header>

          <div className={`session-detail-stream-shell ${detailHasLiveIndicator ? "has-live-indicator" : ""}`}>
            <div
              ref={detailStreamRef}
              className={`session-detail-stream ${detailHasLiveIndicator ? "has-live-indicator" : ""}`}
              aria-live="polite"
              data-testid="session-stream"
              onScroll={trackDetailScrollPosition}
            >
              {detailHasLiveIndicator ? (
                <div className="stream-live-indicator">
                  <TbRefresh aria-hidden="true" />
                  <span><strong>Agent 正在工作</strong><small>持续同步最新输出</small></span>
                </div>
              ) : null}

              {detailLoading && !detailMessages.length ? (
                <div className="detail-empty">正在读取会话内容…</div>
              ) : detailMessages.length ? (
                detailTurns.map((turn) => (
                  <div
                    className={`detail-turn ${turn.hasQuestion ? "has-question" : "is-intro"}`}
                    key={turn.id}
                  >
                    {turn.messages.map((message) => (
                      <DetailMessageCard
                        key={message.id}
                        message={message}
                        agent={selectedSession.agent}
                        fileBridge={sessionFileBridge}
                        pinnedSource={message.role === "user" && message.id === pinnedQuestionId}
                      />
                    ))}
                  </div>
                ))
              ) : (
                <div className="detail-message is-assistant">
                  <span className="detail-avatar"><AgentIcon agent={selectedSession.agent} /></span>
                  <p>
                    会话位于 <strong>{selectedSession.project}</strong>，工作目录为 <code>{selectedSession.cwd}</code>。
                    {selectedSession.source === "native"
                      ? selectedSession.resumable
                        ? " 当前历史没有可展示的文本，可在下方继续该会话。"
                        : " 当前历史没有可展示的文本，只能查看记录摘要。"
                      : " 正在等待 Agent 返回工作内容。"}
                  </p>
                </div>
              )}

              {detailError ? (
                <div className="detail-inline-error" role="alert" data-testid="detail-error">
                  {detailError}
                </div>
              ) : null}
              <div ref={detailEndRef} />
            </div>

            {pinnedQuestion ? (
              <div
                className={`detail-question-pin is-${pinnedQuestionMotion} ${
                  pinnedQuestionExpanded ? "is-expanded" : "is-collapsed"
                }${pinnedQuestionTruncated ? " is-collapsible" : ""}`}
                data-testid="pinned-question"
                data-motion={pinnedQuestionMotion}
                key={pinnedQuestion.id}
              >
                <div className="detail-question-pin-stage">
                  <div
                    ref={pinnedQuestionLayerRef}
                    className="detail-question-pin-layer is-current"
                    onClick={(event) => {
                      if (!pinnedQuestionTruncated || (event.target as HTMLElement).closest("a, button")) return;
                      setPinnedQuestionExpanded((current) => !current);
                    }}
                    onAnimationEnd={() => setPreviousPinnedQuestionId(null)}
                  >
                    <DetailMessageCard
                      message={pinnedQuestion}
                      agent={selectedSession.agent}
                      fileBridge={sessionFileBridge}
                      pinnedCopy="current"
                    />
                    {pinnedQuestionTruncated ? (
                      <button
                        className="detail-question-pin-affordance"
                        type="button"
                        aria-expanded={pinnedQuestionExpanded}
                        aria-label={pinnedQuestionExpanded ? "收起当前问题" : "展开当前问题"}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPinnedQuestionExpanded((current) => !current);
                        }}
                      >
                        {pinnedQuestionExpanded ? "收起" : "展开"}
                        <TbChevronDown aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {previousPinnedQuestion ? (
                    <div className="detail-question-pin-layer is-previous" aria-hidden="true">
                      <DetailMessageCard
                        message={previousPinnedQuestion}
                        agent={selectedSession.agent}
                        fileBridge={sessionFileBridge}
                        pinnedCopy="previous"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <footer className="session-detail-composer">
            <label htmlFor="detail-reply">
              <KeyboardInput
                id="detail-reply"
                value={detailReply}
                onChange={(event) => setDetailReply(event.target.value)}
                placeholder={detailReplyPlaceholder}
                aria-label={detailCanSend ? "继续输入指令" : detailReplyPlaceholder}
                disabled={!detailCanSend || detailSending}
                data-testid="detail-reply"
              />
            </label>
            <button
              type="button"
              onClick={() => void sendDetailReply()}
              aria-label="发送指令"
              disabled={!detailCanSend || detailSending || !detailReply.trim()}
              data-testid="detail-send"
            >
              {detailSending ? <TbRefresh aria-hidden="true" /> : <TbChevronRight aria-hidden="true" />}
            </button>
          </footer>
        </section>
      ) : null}

      {filePreview ? (
        <section className="file-preview-page" data-testid="file-preview">
          <header className="file-preview-header">
            <button
              type="button"
              onClick={closeFilePreview}
              aria-label="返回会话内容"
              data-testid="file-preview-back"
            >
              <TbArrowLeft aria-hidden="true" />
            </button>
            <span>
              <strong>{filePreview.name}</strong>
              <small>{filePreview.status === "ready"
                ? `${fileTypeLabel(filePreview.contentType)} · ${formatFileSize(filePreview.size ?? 0)}`
                : filePreview.status === "loading" ? "正在从 Mac 读取" : "文件读取失败"}</small>
            </span>
            {filePreview.status === "ready" && filePreview.url ? (
              <button
                type="button"
                onClick={() => void exportFilePreview(filePreview)}
                aria-label={`下载 ${filePreview.name}`}
                data-testid="file-download"
                disabled={fileExporting}
              >
                {fileExporting
                  ? <TbRefresh className="file-preview-spinner" aria-hidden="true" />
                  : <TbDownload aria-hidden="true" />}
              </button>
            ) : <i aria-hidden="true" />}
          </header>

          <div className="file-preview-content">
            {filePreview.status === "loading" ? (
              <div className="file-preview-state" role="status">
                <TbRefresh className="file-preview-spinner" aria-hidden="true" />
                <strong>正在读取文件</strong>
                <span>文件仅从当前会话目录按需传输</span>
              </div>
            ) : filePreview.status === "error" ? (
              <div className="file-preview-state is-error" role="alert" data-testid="file-preview-error">
                <TbFile aria-hidden="true" />
                <strong>无法打开文件</strong>
                <span>{filePreview.error}</span>
                <button type="button" onClick={() => openFilePreview(filePreview.reference)}>重新读取</button>
              </div>
            ) : isImagePreview(filePreview.contentType) && filePreview.url ? (
              <div className="file-preview-image">
                <img src={filePreview.url} alt={filePreview.name} data-testid="file-preview-image" />
              </div>
            ) : isPdfPreview(filePreview.contentType) && filePreview.url ? (
              <iframe
                className="file-preview-pdf"
                src={filePreview.url}
                title={filePreview.name}
                data-testid="file-preview-pdf"
              />
            ) : isMarkdownPreview(filePreview.contentType, filePreview.name) && filePreview.text !== undefined ? (
              <div className="file-preview-markdown detail-markdown" data-testid="file-preview-markdown">
                <Suspense fallback={<p className="markdown-loading">正在渲染 Markdown…</p>}>
                  <LazyMarkdown text={filePreview.text} fileBridge={filePreviewMarkdownBridge} />
                </Suspense>
              </div>
            ) : isHtmlPreview(filePreview.contentType, filePreview.name) && filePreview.text !== undefined ? (
              <div className="file-preview-html-shell">
                <iframe
                  className="file-preview-html"
                  srcDoc={ensureHtmlUtf8Metadata(filePreview.text)}
                  sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts"
                  title={filePreview.name}
                  data-testid="file-preview-html"
                />
                <p>HTML 已在隔离的内置浏览器中打开；若本机相对资源未加载，可用右上角按钮导出后打开。</p>
              </div>
            ) : filePreview.text !== undefined ? (
              <pre className="file-preview-text" data-testid="file-preview-text">{filePreview.text}</pre>
            ) : (
              <div className="file-preview-state" data-testid="file-preview-download-only">
                <TbFile aria-hidden="true" />
                <strong>{filePreview.name}</strong>
                <span>此文件类型暂不支持应用内预览，可下载后使用系统应用打开。</span>
                <button
                  type="button"
                  onClick={() => void exportFilePreview(filePreview)}
                  disabled={fileExporting}
                >
                  {fileExporting
                    ? <TbRefresh className="file-preview-spinner" aria-hidden="true" />
                    : <TbDownload aria-hidden="true" />}
                  {fileExporting ? "正在准备…" : "导出文件"}
                </button>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <BottomSheet
        open={deviceOpen}
        onOpenChange={setDeviceOpen}
        title={activeSavedConnection?.name ?? (savedConnections.length ? "选择 Mac" : "连接 Mac")}
        description={savedConnections.length ? `${savedConnections.length} 个已保存连接` : "macOS 远程 Agent 服务"}
        snap={0.88}
      >
        <div className="device-sheet">
          <button
            className="device-sheet-close"
            type="button"
            onClick={() => setDeviceOpen(false)}
            aria-label="关闭设备管理"
          >
            <TbX aria-hidden="true" />
          </button>
          <img src="/assets/app/macbook-device.png" alt="MacBook Pro" />
          <div className="connection-card">
            <span className={`online-dot ${remoteOnline ? "is-online" : "is-offline"}`} />
            <span>
              <strong>{remoteOnline ? "设备在线" : activeSavedConnection ? "当前连接不可用" : "等待配对"}</strong>
              <small>
                {secureConnection
                  ? "HTTPS 加密 · 刚刚同步"
                  : remoteOnline
                    ? "配对令牌已验证 · 本地网络"
                    : activeSavedConnection
                      ? "可以切换其他 Mac，或重新配对当前地址"
                      : "先在 Mac 运行 npm run pair 获取一次性配对码"}
              </small>
            </span>
          </div>

          {savedConnections.length ? (
            <div className="saved-connection-list" aria-label="已保存的 Mac 连接" data-testid="saved-connections">
              <span className="paired-device-heading">已保存的 Mac</span>
              {savedConnections.map((connection) => {
                const current = connection.id === activeConnectionId;
                return (
                  <div className={`saved-connection-row ${current ? "is-current" : ""}`} key={connection.id}>
                    <span className={`online-dot ${current && remoteOnline ? "is-online" : "is-offline"}`} />
                    <span>
                      <strong>{connection.name}{current ? " · 当前" : ""}</strong>
                      <small>{connection.url}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => void switchGatewayConnection(connection)}
                      disabled={current || connectionBusy}
                      data-testid={`switch-connection-${connection.id}`}
                    >
                      {current ? "使用中" : "切换"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {!pairingMode ? (
            <button
              className="sheet-secondary add-connection"
              type="button"
              onClick={() => {
                setPairingUrl("");
                setPairingCode("");
                setPairingMode(true);
              }}
              data-testid="add-connection"
            >
              <TbPlus aria-hidden="true" />添加另一台 Mac
            </button>
          ) : null}

          {pairingMode || !savedConnections.length ? (
            <div className="pairing-form">
              <label htmlFor="gateway-url">Mac 网关地址</label>
              <KeyboardInput
                id="gateway-url"
                value={pairingUrl}
                onChange={(event) => setPairingUrl(event.target.value)}
                placeholder="https://mac.example.com"
                inputMode="url"
                data-testid="gateway-url"
              />
              <label htmlFor="pairing-code">8 位配对码</label>
              <KeyboardInput
                id="pairing-code"
                type="password"
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="00000000"
                inputMode="numeric"
                data-testid="pairing-code"
              />
              <button className="sheet-primary" type="button" onClick={pairDevice}>
                {connectionBusy ? "正在配对…" : "配对并保存连接"}
              </button>
              {savedConnections.length ? (
                <button
                  className="sheet-secondary"
                  type="button"
                  onClick={() => {
                    keyboard.hide();
                    setPairingMode(false);
                    setPairingCode("");
                  }}
                >
                  取消添加
                </button>
              ) : null}
            </div>
          ) : remoteOnline ? (
            <>
              <div className="device-root">
                <span>默认工作目录</span>
                <code>{workingDirectory || "未设置"}</code>
              </div>
              <div className="paired-device-list" aria-label="已授权移动设备">
                <span className="paired-device-heading">已授权设备</span>
                {pairedDevices.map((device) => (
                  <div className="paired-device-row" key={device.id}>
                    <span>
                      <strong>{device.name}{device.current ? " · 当前设备" : ""}</strong>
                      <small>最后使用 {relativeTime(device.lastSeenAt)}</small>
                    </span>
                    {pendingRevokeDevice?.id === device.id ? (
                      <span className="revoke-confirm" data-testid={`revoke-confirm-${device.id}`}>
                        <button
                          type="button"
                          className="is-muted"
                          onClick={() => setPendingRevokeDevice(null)}
                          disabled={connectionBusy}
                        >
                          返回
                        </button>
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() => void revokePairedDevice(device)}
                          disabled={connectionBusy}
                          data-testid={`revoke-confirm-action-${device.id}`}
                        >
                          确认撤销
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingRevokeDevice(device)}
                        disabled={connectionBusy}
                        aria-label={`撤销 ${device.name} 的授权`}
                        data-testid={`revoke-device-${device.id}`}
                      >
                        撤销
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : activeSavedConnection ? (
            <button
              className="sheet-secondary"
              type="button"
              onClick={() => {
                setPairingUrl(activeSavedConnection.url);
                setPairingCode("");
                setPairingMode(true);
              }}
            >
              重新配对当前 Mac
            </button>
          ) : null}

          {activeSavedConnection && !pairingMode ? (
            <button className="sheet-secondary is-danger" type="button" onClick={() => void disconnectDevice()}>
              从本机移除此 Mac
            </button>
          ) : null}
        </div>
      </BottomSheet>

      <BottomSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="安全与通知"
        description="控制远程执行的默认行为"
        snap={0.52}
      >
        <div className="settings-sheet">
          <SettingToggle
            title="默认受限执行"
            description="新会话使用规划或只读模式"
            checked={alwaysConfirm}
            onChange={() => {
              setAlwaysConfirm((current) => {
                const next = !current;
                void saveAppPreferences({
                  version: 1,
                  defaultRestrictedExecution: next,
                  agentStatusNotifications: notifications,
                });
                return next;
              });
            }}
          />
          <SettingToggle
            title="Agent 状态通知"
            description="完成、失败或等待确认时提醒我"
            checked={notifications}
            onChange={() => {
              setNotifications((current) => {
                const next = !current;
                void saveAppPreferences({
                  version: 1,
                  defaultRestrictedExecution: alwaysConfirm,
                  agentStatusNotifications: next,
                });
                return next;
              });
            }}
          />
          <div className="security-note">
            <TbLock aria-hidden="true" />
            {secureConnection
              ? "会话内容通过 HTTPS 加密通道传输。"
              : "移动设备必须先通过一次性配对码授权；公网访问请配置 HTTPS。"}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

const RemoteMarkdownImage = memo(function RemoteMarkdownImage({
  reference,
  alt,
  bridge,
}: {
  reference: string;
  alt: string;
  bridge: SessionFileBridge;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    url?: string;
    message?: string;
  }>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setState({ status: "loading" });
    void bridge.load(reference)
      .then((file) => {
        if (!isImagePreview(file.contentType)) throw new Error("该文件不是可预览的图片");
        objectUrl = URL.createObjectURL(file.blob);
        if (active) setState({ status: "ready", url: objectUrl });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch((error) => {
        if (active) setState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bridge, reference]);

  if (state.status === "loading") {
    return (
      <span className="markdown-remote-image is-loading" role="status" data-testid="remote-file-image-loading">
        <TbRefresh aria-hidden="true" />
        <span>正在从 Mac 加载图片…</span>
      </span>
    );
  }

  if (state.status === "error" || !state.url) {
    return (
      <button
        type="button"
        className="markdown-remote-image is-error"
        onClick={() => bridge.open(reference)}
        data-testid="remote-file-image-error"
      >
        <TbFile aria-hidden="true" />
        <span>{state.message ?? "无法加载图片"}，点按查看详情</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="markdown-remote-image is-ready"
      onClick={() => bridge.open(reference)}
      aria-label={`全屏查看 ${alt}`}
      data-testid="remote-file-image"
    >
      <img src={state.url} alt={alt} />
    </button>
  );
});

const MarkdownMessage = memo(function MarkdownMessage({
  text,
  fileBridge,
}: {
  text: string;
  fileBridge?: SessionFileBridge;
}) {
  return (
    <div className="detail-markdown">
      <Suspense fallback={<p className="markdown-loading">{text}</p>}>
        <LazyMarkdown text={text} fileBridge={fileBridge} />
      </Suspense>
    </div>
  );
});

const ProjectGroupCard = memo(function ProjectGroupCard({
  group,
  expanded,
  canCreate,
  onToggle,
  onCreate,
  onOpen,
}: {
  group: ProjectGroup;
  expanded: boolean;
  canCreate: boolean;
  onToggle: (projectId: string) => void;
  onCreate: (group: ProjectGroup) => void;
  onOpen: (session: AgentSession) => void | Promise<void>;
}) {
  return (
    <article className={`project-group ${expanded ? "is-expanded" : ""}`} data-testid="project-group">
      <div className="project-group-header">
        <button
          className="project-toggle"
          type="button"
          onClick={() => onToggle(group.id)}
          aria-expanded={expanded}
          data-testid={`project-toggle-${group.id}`}
        >
          <span className="project-folder"><TbFolder aria-hidden="true" /></span>
          <span className="project-summary">
            <strong>{group.name}</strong>
            <small>最近更新 {group.sessions[0]?.time}</small>
          </span>
          <TbChevronRight className="project-chevron" aria-hidden="true" />
        </button>
        {canCreate ? (
          <button
            className="project-new-session"
            type="button"
            onClick={() => onCreate(group)}
            aria-label={`在 ${group.name} 中发起新会话`}
          >
            <TbPlus aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="project-sessions">
          {group.sessions.map((session) => (
            <SessionRow
              key={`${session.source}-${session.agent}-${session.id}`}
              session={session}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
});

const SessionRow = memo(function SessionRow({
  session,
  onOpen,
}: {
  session: AgentSession;
  onOpen: (session: AgentSession) => void | Promise<void>;
}) {
  const stateLabel = sessionStateLabel(session);
  return (
    <button
      className={`session-row ${session.unread ? "is-unread" : ""}`}
      type="button"
      onClick={() => void onOpen(session)}
      aria-label={`打开会话：${session.title}${stateLabel ? `，${stateLabel}` : ""}`}
      data-testid={`session-${session.id}`}
    >
      <AgentIcon agent={session.agent} framed />
      <span className="session-copy">
        <strong>{session.title}</strong>
        <span>{session.project}</span>
      </span>
      <span className="session-meta">
        <SessionStateIndicator session={session} placement="list" />
        <time>{session.time}</time>
      </span>
      <TbChevronRight className="session-chevron" aria-hidden="true" />
    </button>
  );
});

const DetailMessageCard = memo(function DetailMessageCard({
  message,
  agent,
  pinnedCopy = false,
  pinnedSource = false,
  fileBridge,
}: {
  message: DetailMessage;
  agent: AgentName;
  pinnedCopy?: false | "current" | "previous";
  pinnedSource?: boolean;
  fileBridge?: SessionFileBridge;
}) {
  return (
    <div
      className={`detail-message is-${message.role} is-${message.kind ?? "message"}${
        pinnedCopy ? " is-pinned-copy" : ""
      }${pinnedSource ? " is-pinned-source" : ""}`}
      data-testid={message.role === "user"
        ? pinnedCopy === "current"
          ? "pinned-question-card"
          : pinnedCopy === "previous" ? undefined : `user-question-${message.id}`
        : undefined}
      data-question-id={message.role === "user" ? message.id : undefined}
    >
      <span className="detail-avatar">
        {message.kind === "tool"
          ? <TbTerminal2 aria-hidden="true" />
          : message.role === "assistant"
            ? <AgentIcon agent={agent} />
            : <TbCode aria-hidden="true" />}
      </span>
      {message.kind === "diagnostic" ? (
        <details className="detail-diagnostic" data-testid="diagnostic-log">
          <summary>Agent 诊断日志</summary>
          <p>{message.text}</p>
        </details>
      ) : message.kind === "tool" || message.kind === "error" ? (
        <p>{message.text}</p>
      ) : (
        <MarkdownMessage text={message.text} fileBridge={fileBridge} />
      )}
    </div>
  );
});

const AgentUsageStatus = memo(function AgentUsageStatus({
  agent,
  usage,
  connected,
}: {
  agent: AgentName;
  usage: AgentUsageApi | null;
  connected: boolean;
}) {
  let label = "读取中";
  let description = `${agent} 额度正在读取`;
  let state = "is-loading";

  if (!connected) {
    label = "未连接";
    description = `${agent} 连接 Mac 后读取额度`;
    state = "is-offline";
  } else if (usage?.state === "available" && usage.windows.length) {
    const limitingWindow = usage.windows.reduce((current, candidate) => (
      candidate.remainingPercent < current.remainingPercent ? candidate : current
    ));
    label = `余 ${Math.round(limitingWindow.remainingPercent)}%`;
    description = `${agent} ${limitingWindow.label}剩余 ${Math.round(limitingWindow.remainingPercent)}%${
      limitingWindow.resetsAt ? `，${formatUsageReset(limitingWindow.resetsAt)}` : ""
    }`;
    state = "is-available";
  } else if (usage && /API\s*模式/.test(usage.message ?? "")) {
    label = "API模式";
    description = usage.message ?? `${agent} 当前为 API 模式，无套餐额度窗口`;
    state = "is-unavailable";
  } else if (usage) {
    label = "无法获取";
    description = usage.message ?? `${agent} 无法获取额度信息`;
    state = "is-unavailable";
  }

  return (
    <small
      className={`agent-filter-quota ${state}`}
      data-testid={`agent-usage-${agent}`}
      aria-label={description}
      title={description}
    >
      {label}
    </small>
  );
});

function AgentIcon({ agent, framed = false }: { agent: AgentName; framed?: boolean }) {
  const icon =
    agent === "Cursor" ? (
      <SiCursor aria-hidden="true" />
    ) : agent === "Claude" ? (
      <SiClaude aria-hidden="true" />
    ) : (
      <TbBrandOpenai aria-hidden="true" />
    );

  return <span className={`agent-icon agent-${agent.toLowerCase()} ${framed ? "is-framed" : ""}`}>{icon}</span>;
}

function sessionStateLabel(session: AgentSession): string {
  if (session.status === "running") return "运行中";
  if (session.status === "attention") return "等待确认";
  if (session.status === "failed") return "失败";
  if (session.status === "cancelled") return "已取消";
  if (session.status === "done" && session.unread) return "已完成，未读";
  return "";
}

function SessionStateIndicator({
  session,
  placement,
}: {
  session: AgentSession;
  placement: "list" | "detail";
}) {
  const label = sessionStateLabel(session);
  if (!label) return null;
  const state = session.status === "done"
    ? "unread"
    : session.status === "cancelled"
      ? "cancelled"
      : session.status;
  return (
    <span
      className={`session-state-indicator is-${state}`}
      role="img"
      aria-label={label}
      data-testid={`session-state-${placement}-${session.id}`}
    >
      {session.status === "running" ? <TbRefresh aria-hidden="true" /> : <i aria-hidden="true" />}
    </span>
  );
}

function SettingToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button className="setting-row" type="button" onClick={onChange} aria-pressed={checked}>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <i className={`toggle ${checked ? "is-on" : ""}`} aria-hidden="true"><b /></i>
    </button>
  );
}

type AgentKindApi = "cursor" | "claude" | "codex";

type AgentUsageApi = {
  agent: AgentKindApi;
  state: "available" | "unavailable";
  windows: Array<{
    label: string;
    remainingPercent: number;
    resetsAt?: string;
  }>;
  message?: string;
  updatedAt: string;
};

type GatewaySessionApi = {
  id: string;
  nativeId?: string;
  agent: AgentKindApi;
  title: string;
  cwd: string;
  projectId?: string;
  projectName?: string;
  permissionMode: "plan" | "ask" | "auto" | "full";
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type NativeHistoryApi = {
  id: string;
  agent: AgentKindApi;
  title: string;
  cwd: string;
  projectId?: string;
  projectName?: string;
  updatedAt: string;
  status?: "running" | "completed" | "failed";
  resumable: boolean;
  archived?: boolean;
  source: "native";
};

type NativeMessageApi = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
};

type NativeHistorySnapshotApi = {
  session: NativeHistoryApi;
  messages: NativeMessageApi[];
};

type GatewayEventApi = {
  seq: number;
  type: "status" | "output" | "tool" | "approval" | "completed" | "error";
  payload: Record<string, unknown>;
};

type PairedDeviceApi = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

type GatewayRequestOptions = {
  method?: "GET" | "POST";
  token?: string;
  body?: Record<string, unknown>;
};

async function loadRemoteState(url: string, token: string): Promise<{
  sessions: AgentSession[];
  hostname: string;
  allowedRoots: string[];
  devices: PairedDeviceApi[];
}> {
  const [gatewaySessions, nativeHistory, config, devices] = await Promise.all([
    gatewayRequest<GatewaySessionApi[]>(url, "/v1/sessions?limit=200", { token }),
    gatewayRequest<NativeHistoryApi[]>(
      url,
      "/v1/history?limit=2000&perProjectLimit=20",
      { token },
    ),
    gatewayRequest<{ hostname: string; allowedRoots: string[] }>(url, "/v1/config", { token }),
    gatewayRequest<PairedDeviceApi[]>(url, "/v1/devices", { token }),
  ]);
  const imported = new Set(
    gatewaySessions.flatMap((session) => session.nativeId ? [`${session.agent}:${session.nativeId}`] : []),
  );
  const sessions = disambiguateProjectNames(limitSessionsPerProjectAgent(deduplicateSessions([
    ...gatewaySessions.map(mapGatewaySession),
    ...nativeHistory
      .filter((session) => !imported.has(`${session.agent}:${session.id}`))
      .map(mapNativeSession),
  ].sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a))), PROJECT_SESSION_LIMIT));
  return { sessions, hostname: config.hostname, allowedRoots: config.allowedRoots, devices };
}

async function gatewayRequest<T>(
  baseUrl: string,
  path: string,
  options: GatewayRequestOptions = {},
): Promise<T> {
  const url = normalizeGatewayUrl(baseUrl);
  if (!url) throw new Error("Mac 网关地址无效");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${url}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: T;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message ?? `Mac 网关返回 ${response.status}`);
    if (!("data" in payload)) throw new Error("Mac 网关响应格式无效");
    return payload.data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("连接 Mac 超时，请检查网关地址");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function gatewayFileRequest(
  baseUrl: string,
  path: string,
  token: string,
  reference: string,
): Promise<RemoteSessionFile> {
  const url = normalizeGatewayUrl(baseUrl);
  if (!url) throw new Error("Mac 网关地址无效");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: reference }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      const fallback = response.status === 403
        ? "文件不在当前会话目录内，或没有读取权限"
        : response.status === 404
          ? "Mac 上找不到这个文件"
          : response.status === 413
            ? "文件超过 20 MiB，无法在手机端读取"
            : `Mac 网关返回 ${response.status}`;
      throw new Error(payload.error?.message ? localizeFileError(payload.error.message, fallback) : fallback);
    }
    const blob = await response.blob();
    const encodedName = response.headers.get("X-Remote-Agent-Filename");
    return {
      blob,
      name: encodedName ? safeDecodeURIComponent(encodedName) : fileNameFromReference(reference),
      contentType: response.headers.get("Content-Type")?.trim() || blob.type || "application/octet-stream",
      size: blob.size,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("读取文件超时，请检查 Mac 连接");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function localizeFileError(message: string, fallback: string): string {
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("outside") || normalized.includes("not allowed") || normalized.includes("permission")) {
    return "文件不在当前会话目录内，或没有读取权限";
  }
  if (normalized.includes("not found")) return "Mac 上找不到这个文件";
  if (normalized.includes("too large")) return "文件超过 20 MiB，无法在手机端读取";
  if (normalized.includes("regular file")) return "只能读取当前会话目录内的普通文件";
  if (normalized.includes("unsupported") || normalized.includes("invalid file reference")) return "文件地址格式不受支持";
  return fallback;
}

function markdownUrlTransform(value: string): string {
  const reference = value.trim();
  if (!reference) return "";
  if (isLocalFileReference(reference)) return reference;
  if (/^(https?:|mailto:|tel:)/i.test(reference)) return reference;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(reference)) return reference;
  return "";
}

function isLocalFileReference(value: string): boolean {
  const reference = value.trim();
  if (!reference || reference.startsWith("#")) return false;
  if (/^(?:https?:|mailto:|tel:|data:|blob:)/i.test(reference)) return false;
  if (/^file:/i.test(reference)) return true;
  return !/^[a-z][a-z\d+.-]*:/i.test(reference);
}

function fileNameFromReference(reference: string): string {
  let path = reference.trim();
  try {
    if (/^file:/i.test(path)) path = new URL(path).pathname;
  } catch {
    // The gateway will report an invalid reference; keep a safe fallback label meanwhile.
  }
  path = path.split(/[?#]/, 1)[0] ?? path;
  const basename = path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
  return basename ? safeDecodeURIComponent(basename) : "会话文件";
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedContentType(value?: string): string {
  return value?.split(";", 1)[0]?.trim().toLocaleLowerCase() ?? "";
}

function isImagePreview(contentType?: string): boolean {
  return normalizedContentType(contentType).startsWith("image/");
}

function isPdfPreview(contentType?: string): boolean {
  return normalizedContentType(contentType) === "application/pdf";
}

function isMarkdownPreview(contentType?: string, name = ""): boolean {
  const type = normalizedContentType(contentType);
  return type === "text/markdown" || /\.md(?:own)?$/i.test(name);
}

function isHtmlPreview(contentType?: string, name = ""): boolean {
  const type = normalizedContentType(contentType);
  return type === "text/html" || /\.html?$/i.test(name);
}

function ensureHtmlUtf8Metadata(source: string): string {
  if (/<meta\s+[^>]*charset\s*=/i.test(source)) return source;
  const metadata = '<meta charset="utf-8">';
  if (/<head(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<head(\s[^>]*)?>/i, (opening) => `${opening}${metadata}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<html(\s[^>]*)?>/i, (opening) => `${opening}<head>${metadata}</head>`);
  }
  return `${metadata}${source}`;
}

function isTextPreview(contentType?: string): boolean {
  const type = normalizedContentType(contentType);
  return type.startsWith("text/")
    || type === "application/json"
    || type === "application/xml"
    || type === "application/yaml";
}

function fileTypeLabel(contentType?: string): string {
  const type = normalizedContentType(contentType);
  if (isImagePreview(type)) return "图片";
  if (isPdfPreview(type)) return "PDF";
  if (isMarkdownPreview(type)) return "Markdown";
  if (isHtmlPreview(type)) return "HTML";
  if (isTextPreview(type)) return "文本";
  return "文件";
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

function triggerWebDownload(url: string, name: string): void {
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function resolveNestedFileReference(parentReference: string, nestedReference: string): string {
  const nested = nestedReference.trim();
  if (!isLocalFileReference(nested) || /^file:/i.test(nested) || nested.startsWith("/")) return nested;
  const suffixIndex = nested.search(/[?#]/);
  const nestedPath = suffixIndex >= 0 ? nested.slice(0, suffixIndex) : nested;
  const suffix = suffixIndex >= 0 ? nested.slice(suffixIndex) : "";
  const parentPath = parentReference.split(/[?#]/, 1)[0]?.replace(/\\/g, "/") ?? parentReference;
  const parentDirectory = parentPath.includes("/")
    ? parentPath.slice(0, parentPath.lastIndexOf("/") + 1)
    : "";
  return `${parentDirectory}${nestedPath}${suffix}`;
}

function safeExportFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return safe.slice(-180) || "remote-agent-file";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取待导出的文件"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("无法准备待导出的文件"));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function mapGatewaySession(session: GatewaySessionApi): AgentSession {
  return {
    id: session.id,
    ...(session.nativeId ? { nativeId: session.nativeId } : {}),
    source: "gateway",
    resumable: Boolean(session.nativeId),
    cwd: session.cwd,
    projectId: session.projectId ?? localProjectId(session.cwd),
    agent: kindToAgent(session.agent),
    title: session.title,
    project: session.projectName ?? projectFromCwd(session.cwd),
    branch: session.permissionMode === "plan"
      ? "规划模式"
      : session.permissionMode === "auto"
        ? "自动执行"
        : session.permissionMode === "full"
          ? "完全允许"
          : "受限执行",
    status: session.status === "failed"
      ? "failed"
      : session.status === "waiting_approval"
        ? "attention"
        : session.status === "cancelled"
          ? "cancelled"
          : session.status === "completed"
            ? "done"
            : "running",
    updatedAt: session.updatedAt,
    time: relativeTime(session.updatedAt),
  };
}

function mapNativeSession(session: NativeHistoryApi): AgentSession {
  return {
    id: session.id,
    source: "native",
    resumable: session.resumable,
    cwd: session.cwd,
    projectId: session.projectId ?? localProjectId(session.cwd),
    agent: kindToAgent(session.agent),
    title: session.title,
    project: session.projectName ?? projectFromCwd(session.cwd),
    branch: session.resumable ? "原生历史" : "只读记录",
    status: session.status === "running"
      ? "running"
      : session.status === "failed"
        ? "failed"
        : "done",
    updatedAt: session.updatedAt,
    time: relativeTime(session.updatedAt),
  };
}

function sameAgentSession(left: AgentSession, right: AgentSession): boolean {
  return left.id === right.id
    && left.nativeId === right.nativeId
    && left.source === right.source
    && left.resumable === right.resumable
    && left.cwd === right.cwd
    && left.projectId === right.projectId
    && left.agent === right.agent
    && left.title === right.title
    && left.project === right.project
    && left.branch === right.branch
    && left.status === right.status
    && left.updatedAt === right.updatedAt
    && left.time === right.time
    && left.unread === right.unread
    && left.cached === right.cached;
}

function sameSessions(left: AgentSession[], right: AgentSession[]): boolean {
  return left.length === right.length
    && left.every((session, index) => {
      const candidate = right[index];
      return candidate ? sameAgentSession(session, candidate) : false;
    });
}

function upsertSessionAtFront(current: AgentSession[], next: AgentSession): AgentSession[] {
  const existing = current.find((session) => session.id === next.id);
  if (current[0]?.id === next.id && existing && sameAgentSession(existing, next)) return current;
  return [next, ...current.filter((session) => session.id !== next.id)];
}

function samePairedDevices(left: PairedDeviceApi[], right: PairedDeviceApi[]): boolean {
  return left.length === right.length && left.every((device, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && device.id === candidate.id
      && device.name === candidate.name
      && device.createdAt === candidate.createdAt
      && device.lastSeenAt === candidate.lastSeenAt
      && device.current === candidate.current;
  });
}

function sameDetailMessages(left: DetailMessage[], right: DetailMessage[]): boolean {
  return left.length === right.length && left.every((message, index) => {
    const other = right[index];
    return Boolean(other)
      && message.id === other.id
      && message.role === other.role
      && message.text === other.text
      && message.kind === other.kind;
  });
}

function appendGatewayEvents(
  current: DetailMessage[],
  events: GatewayEventApi[],
): DetailMessage[] {
  const next = [...current];

  for (const event of events) {
    if (event.type === "output") {
      const text = typeof event.payload.text === "string" ? event.payload.text : "";
      if (!text.trim()) continue;
      const stream = typeof event.payload.stream === "string" ? event.payload.stream : "stdout";
      const role = stream === "user" ? "user" as const : "assistant" as const;
      const kind = stream === "stderr"
        ? "diagnostic" as const
        : stream === "assistant_delta" || stream === "stdout"
          ? "stream" as const
          : "message" as const;
      const last = next.at(-1);
      if (kind === "stream" && last?.role === role && last.kind === "stream") {
        next[next.length - 1] = { ...last, text: `${last.text}${text}` };
      } else if (kind === "diagnostic" && last?.kind === "diagnostic") {
        next[next.length - 1] = { ...last, text: `${last.text}\n${text}` };
      } else {
        next.push({ id: `event-${event.seq}`, role, text, kind });
      }
      continue;
    }

    if (event.type === "tool") {
      const name = typeof event.payload.name === "string" ? event.payload.name : "工具调用";
      const command = typeof event.payload.command === "string"
        ? event.payload.command
        : formatPayloadValue(event.payload.input);
      const status = typeof event.payload.status === "string" ? `\n状态：${event.payload.status}` : "";
      next.push({
        id: `event-${event.seq}`,
        role: "assistant",
        kind: "tool",
        text: `${name}${command ? `\n${command}` : ""}${status}`,
      });
      continue;
    }

    if (event.type === "approval") {
      next.push({
        id: `event-${event.seq}`,
        role: "assistant",
        kind: "tool",
        text: "Agent 正在等待 Mac 端确认操作权限。",
      });
      continue;
    }

    if (event.type === "error") {
      const message = typeof event.payload.message === "string" ? event.payload.message : "Agent 执行失败";
      next.push({ id: `event-${event.seq}`, role: "assistant", text: message, kind: "error" });
    }
  }

  return next;
}

function groupDetailTurns(messages: DetailMessage[]): DetailTurn[] {
  const turns: DetailTurn[] = [];
  let current: DetailTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      current = {
        id: `turn-${message.id}`,
        hasQuestion: true,
        messages: [message],
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      current = {
        id: `turn-intro-${message.id}`,
        hasQuestion: false,
        messages: [],
      };
      turns.push(current);
    }
    current.messages.push(message);
  }

  return turns;
}

function formatPayloadValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sessionTimestamp(session: AgentSession): number {
  const timestamp = new Date(session.updatedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function kindToAgent(kind: AgentKindApi): AgentName {
  return kind === "cursor" ? "Cursor" : kind === "claude" ? "Claude" : "Codex";
}

function agentToKind(agent: AgentName): AgentKindApi {
  return agent.toLocaleLowerCase() as AgentKindApi;
}

function normalizeAgentUsages(value: unknown): AgentUsageApi[] {
  const entries = Array.isArray(value) ? value : [];
  return (["cursor", "claude", "codex"] as AgentKindApi[]).map((agent) => {
    const candidate = entries.find((entry) => isRecord(entry) && entry.agent === agent);
    if (!isRecord(candidate)) {
      return unavailableAgentUsage(agent, "网关未返回该 Agent");
    }

    const updatedAt = typeof candidate.updatedAt === "string"
      && Number.isFinite(Date.parse(candidate.updatedAt))
      ? candidate.updatedAt
      : new Date().toISOString();
    const message = typeof candidate.message === "string"
      ? candidate.message.trim().slice(0, 120)
      : undefined;
    const windows = Array.isArray(candidate.windows)
      ? candidate.windows.flatMap((window) => {
        if (!isRecord(window)
          || typeof window.label !== "string"
          || !window.label.trim()
          || typeof window.remainingPercent !== "number"
          || !Number.isFinite(window.remainingPercent)) return [];
        const resetsAt = typeof window.resetsAt === "string"
          && Number.isFinite(Date.parse(window.resetsAt))
          ? window.resetsAt
          : undefined;
        return [{
          label: window.label.trim().slice(0, 24),
          remainingPercent: Math.min(100, Math.max(0, window.remainingPercent)),
          ...(resetsAt ? { resetsAt } : {}),
        }];
      }).slice(0, 2)
      : [];

    if (candidate.state !== "available" || !windows.length) {
      return {
        agent,
        state: "unavailable",
        windows: [],
        message: message?.startsWith("无法获取额度信息")
          ? message
          : `无法获取额度信息${message ? ` · ${message}` : ""}`,
        updatedAt,
      };
    }
    return { agent, state: "available", windows, updatedAt };
  });
}

function unavailableAgentUsage(agent: AgentKindApi, reason: string): AgentUsageApi {
  return {
    agent,
    state: "unavailable",
    windows: [],
    message: `无法获取额度信息 · ${reason}`,
    updatedAt: new Date().toISOString(),
  };
}

function unavailableAgentUsages(reason: string): AgentUsageApi[] {
  return (["cursor", "claude", "codex"] as AgentKindApi[])
    .map((agent) => unavailableAgentUsage(agent, reason));
}

function formatUsageReset(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "重置时间未知";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return `${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} 重置`;
  }
  return `${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 重置`;
}

function projectFromCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, "").split("/");
  return parts.at(-1) || cwd;
}

function localProjectId(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, "") || cwd;
  let hash = 2_166_136_261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `local-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function disambiguateProjectNames(sessions: AgentSession[]): AgentSession[] {
  const projectsByName = new Map<string, Map<string, { name: string; cwd: string }>>();
  for (const session of sessions) {
    const normalizedName = session.project.trim().toLocaleLowerCase();
    const projects = projectsByName.get(normalizedName) ?? new Map();
    const existing = projects.get(session.projectId);
    if (!existing || (!existing.cwd && session.cwd)) {
      projects.set(session.projectId, { name: session.project, cwd: session.cwd });
    }
    projectsByName.set(normalizedName, projects);
  }

  const labels = new Map<string, string>();
  for (const projects of projectsByName.values()) {
    const records = [...projects.entries()].map(([id, project]) => ({ id, ...project }));
    if (records.length < 2) continue;
    const contexts = records.map((record) => projectPathContext(record.cwd, record.name));
    const minimumDepth = Math.max(1, ...records.map((record) => projectPathMinimumDepth(
      record.cwd,
      record.name,
    )));
    const maximumDepth = Math.max(1, ...contexts.map((context) => context.length));
    let candidates: string[] = [];
    for (let depth = minimumDepth; depth <= Math.max(minimumDepth, maximumDepth); depth += 1) {
      candidates = records.map((record, index) => projectPathLabel(
        record.name,
        contexts[index] ?? [],
        depth,
      ));
      if (new Set(candidates.map((candidate) => candidate.toLocaleLowerCase())).size === records.length) break;
    }
    if (new Set(candidates.map((candidate) => candidate.toLocaleLowerCase())).size !== records.length) {
      candidates = records.map((record, index) => (
        `${candidates[index] || record.name} · ${record.id.slice(0, 6)}`
      ));
    }
    records.forEach((record, index) => labels.set(record.id, candidates[index] ?? record.name));
  }

  if (!labels.size) return sessions;
  return sessions.map((session) => {
    const label = labels.get(session.projectId);
    return label && label !== session.project ? { ...session, project: label } : session;
  });
}

function projectPathMinimumDepth(cwd: string, projectName: string): number {
  if (projectName.trim().toLocaleLowerCase() !== "workspace") return 1;
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return /\/[^/]+-benchmark\/runs\/[^/]+\/[^/]+\/workspace$/i.test(normalized) ? 3 : 1;
}

function projectPathContext(cwd: string, projectName: string): string[] {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  const normalizedName = projectName.trim().toLocaleLowerCase();
  let projectIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.toLocaleLowerCase() === normalizedName) {
      projectIndex = index;
      break;
    }
  }
  if (projectIndex < 0) projectIndex = Math.max(0, parts.length - 1);
  return parts.slice(0, projectIndex).reverse().flatMap((part) => {
    const normalized = part.toLocaleLowerCase();
    if (normalized === "runs" || normalized === "tasks") return [];
    const cleaned = part
      .replace(/^\d{4}-\d{2}-\d{2}-/, "")
      .replace(/-benchmark$/i, "");
    return cleaned ? [cleaned] : [];
  });
}

function projectPathLabel(projectName: string, context: string[], depth: number): string {
  const isWorkspace = projectName.trim().toLocaleLowerCase() === "workspace";
  const parents = isWorkspace ? context.slice(0, depth) : context.slice(0, depth).reverse();
  if (!isWorkspace) parents.push(projectName);
  return parents.join(" · ") || projectName;
}

function limitSessionsPerProject(sessions: AgentSession[], limit: number): AgentSession[] {
  const counts = new Map<string, number>();
  return sessions.filter((session) => {
    const count = counts.get(session.projectId) ?? 0;
    if (count >= limit) return false;
    counts.set(session.projectId, count + 1);
    return true;
  });
}

function deduplicateSessions(sessions: AgentSession[]): AgentSession[] {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    const identity = sessionIdentity(session);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function limitSessionsPerProjectAgent(sessions: AgentSession[], limit: number): AgentSession[] {
  const counts = new Map<string, number>();
  return sessions.filter((session) => {
    const key = `${session.projectId}:${session.agent}`;
    const count = counts.get(key) ?? 0;
    if (count >= limit) return false;
    counts.set(key, count + 1);
    return true;
  });
}

type SessionReadStateRecord = {
  version: 1;
  url: string;
  initializedAt: string;
  readRevisions: Record<string, string>;
};

function sessionIdentity(session: AgentSession): string {
  return `${session.source}:${session.agent}:${session.id}`;
}

function applySessionReadState(
  url: string,
  sessions: AgentSession[],
  activeSession: AgentSession | null,
): AgentSession[] {
  if (!url) return sessions.map((session) => withUnreadState(session, false));
  const existing = readSessionReadState(url);
  if (!existing) {
    const readRevisions = Object.fromEntries(
      sessions
        .filter((session) => session.status === "done" || session.status === "cancelled")
        .map((session) => [sessionIdentity(session), session.updatedAt]),
    );
    writeSessionReadState({
      version: 1,
      url,
      initializedAt: new Date().toISOString(),
      readRevisions,
    });
    return sessions.map((session) => withUnreadState(session, false));
  }

  let changed = false;
  const activeIdentity = activeSession ? sessionIdentity(activeSession) : "";
  const initializedAt = new Date(existing.initializedAt).getTime();
  const next = sessions.map((session) => {
    if (session.status !== "done" && session.status !== "cancelled") {
      return withUnreadState(session, false);
    }
    const identity = sessionIdentity(session);
    if (identity === activeIdentity) {
      if (existing.readRevisions[identity] !== session.updatedAt) {
        existing.readRevisions[identity] = session.updatedAt;
        changed = true;
      }
      return withUnreadState(session, false);
    }
    if (existing.readRevisions[identity] === session.updatedAt) {
      return withUnreadState(session, false);
    }
    if (Number.isFinite(initializedAt) && sessionTimestamp(session) <= initializedAt) {
      existing.readRevisions[identity] = session.updatedAt;
      changed = true;
      return withUnreadState(session, false);
    }
    return withUnreadState(session, true);
  });
  if (changed) writeSessionReadState(existing);
  return next;
}

function markSessionRead(url: string, session: AgentSession): void {
  if (!url || (session.status !== "done" && session.status !== "cancelled")) return;
  const existing = readSessionReadState(url) ?? {
    version: 1 as const,
    url,
    initializedAt: new Date().toISOString(),
    readRevisions: {},
  };
  existing.readRevisions[sessionIdentity(session)] = session.updatedAt;
  writeSessionReadState(existing);
}

function withUnreadState(session: AgentSession, unread: boolean): AgentSession {
  if (Boolean(session.unread) === unread) return session;
  return { ...session, unread };
}

function readSessionReadState(url: string): SessionReadStateRecord | null {
  if (!url) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionReadStateKey(url)) ?? "null") as unknown;
    if (!isRecord(parsed)
      || parsed.version !== 1
      || parsed.url !== url
      || typeof parsed.initializedAt !== "string"
      || !isRecord(parsed.readRevisions)) return null;
    const readRevisions = Object.fromEntries(
      Object.entries(parsed.readRevisions)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .slice(-2_000),
    );
    return { version: 1, url, initializedAt: parsed.initializedAt, readRevisions };
  } catch {
    return null;
  }
}

function writeSessionReadState(record: SessionReadStateRecord): void {
  try {
    const readRevisions = Object.fromEntries(Object.entries(record.readRevisions).slice(-2_000));
    localStorage.setItem(sessionReadStateKey(record.url), JSON.stringify({ ...record, readRevisions }));
  } catch {
    // Read markers are helpful UI state and must never block live session rendering.
  }
}

type SessionCacheRecord = {
  version: 1;
  url: string;
  hostname: string;
  savedAt: string;
  sessions: Array<{
    id: string;
    source: AgentSession["source"];
    resumable: boolean;
    agent: AgentName;
    title: string;
    projectId: string;
    project: string;
    branch: string;
    status: SessionStatus;
    updatedAt: string;
  }>;
};

function readSessionCache(url: string): {
  hostname: string;
  savedAt: string;
  sessions: AgentSession[];
} | null {
  if (!url) return null;
  try {
    const raw = localStorage.getItem(sessionCacheKey(url)) ?? localStorage.getItem(SESSION_CACHE_KEY);
    const parsed = JSON.parse(raw ?? "null") as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.url !== url) return null;
    if (typeof parsed.hostname !== "string" || typeof parsed.savedAt !== "string") return null;
    if (!Array.isArray(parsed.sessions)) return null;
    const sessions = parsed.sessions.slice(0, MAX_CACHED_SESSIONS).flatMap((candidate) => {
      if (!isCachedSession(candidate)) return [];
      return [{
        id: candidate.id,
        source: candidate.source,
        resumable: candidate.resumable,
        cwd: "",
        projectId: candidate.projectId,
        agent: candidate.agent,
        title: candidate.title,
        project: candidate.project,
        branch: candidate.branch,
        status: candidate.status,
        updatedAt: candidate.updatedAt,
        time: relativeTime(candidate.updatedAt),
        cached: true,
      } satisfies AgentSession];
    });
    return { hostname: parsed.hostname, savedAt: parsed.savedAt, sessions };
  } catch {
    return null;
  }
}

function writeSessionCache(
  url: string,
  hostname: string,
  savedAt: string,
  sessions: AgentSession[],
): void {
  if (!url) return;
  const record: SessionCacheRecord = {
    version: 1,
    url,
    hostname,
    savedAt,
    sessions: sessions.slice(0, MAX_CACHED_SESSIONS).map((session) => ({
      id: session.id,
      source: session.source,
      resumable: session.resumable,
      agent: session.agent,
      title: session.title,
      projectId: session.projectId,
      project: session.project,
      branch: session.branch,
      status: session.status,
      updatedAt: session.updatedAt,
    })),
  };
  try {
    localStorage.setItem(sessionCacheKey(url), JSON.stringify(record));
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // Session caching is opportunistic; a full/disabled store must not block live data.
  }
}

function isCachedSession(value: unknown): value is SessionCacheRecord["sessions"][number] {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && (value.source === "gateway" || value.source === "native")
    && typeof value.resumable === "boolean"
    && (value.agent === "Cursor" || value.agent === "Claude" || value.agent === "Codex")
    && typeof value.title === "string"
    && typeof value.projectId === "string"
    && typeof value.project === "string"
    && typeof value.branch === "string"
    && (value.status === "running"
      || value.status === "attention"
      || value.status === "done"
      || value.status === "cancelled"
      || value.status === "failed")
    && typeof value.updatedAt === "string";
}

function readExpandedProjects(url: string): { ids: Set<string>; initialized: boolean } {
  if (!url) return { ids: new Set(), initialized: false };
  try {
    const raw = localStorage.getItem(projectExpansionKey(url)) ?? localStorage.getItem(PROJECT_EXPANSION_KEY);
    const parsed = JSON.parse(raw ?? "null") as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.url !== url || !Array.isArray(parsed.ids)) {
      return { ids: new Set(), initialized: false };
    }
    return {
      ids: new Set(parsed.ids.filter((id): id is string => typeof id === "string").slice(0, 100)),
      initialized: true,
    };
  } catch {
    return { ids: new Set(), initialized: false };
  }
}

function writeExpandedProjects(url: string, ids: Set<string>): void {
  if (!url) return;
  try {
    localStorage.setItem(projectExpansionKey(url), JSON.stringify({
      version: 1,
      url,
      ids: [...ids].slice(-100),
    }));
    localStorage.removeItem(PROJECT_EXPANSION_KEY);
  } catch {
    // Expansion state is non-critical UI state.
  }
}

function formatCacheAge(value: string | null): string {
  if (!value) return "上次的";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "上次的";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "刚刚的";
  if (minutes < 60) return `${minutes} 分钟前的`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前的`;
  return `${Math.floor(hours / 24)} 天前的`;
}

function sessionCacheKey(url: string): string {
  return `${SESSION_CACHE_KEY}.${localProjectId(url)}`;
}

function projectExpansionKey(url: string): string {
  return `${PROJECT_EXPANSION_KEY}.${localProjectId(url)}`;
}

function sessionReadStateKey(url: string): string {
  return `${SESSION_READ_STATE_KEY}.${localProjectId(url)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "未知时间";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function mobileDeviceName(): string {
  if (/iPhone|iPad/i.test(navigator.userAgent)) return "iOS 设备";
  if (/Android/i.test(navigator.userAgent)) return "Android 设备";
  return "移动端 Web 原型";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
