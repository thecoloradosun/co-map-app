import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faExclamationTriangle,
  faRotateRight,
  faArrowLeft,
  faCode,
  faGlobe,
  faCheck,
  faPen,
  faChevronDown,
  faFileAlt,
  faBoxArchive,
  faLock,
  faLockOpen,
  faEye,
  faGear,
  faPaintBrush,
} from "@fortawesome/free-solid-svg-icons";
import { getMap, updateMap, type MapDetail } from "../lib/api";
import { DesignProvider } from "../context/DesignContext";
import { loadFaIconNames } from "../lib/faIcons";
import MapEditorContent from "../components/MapEditorContent";
import EmbedCodeBanner from "../components/EmbedCodeBanner";
import DataTabBar from "../components/DataTabBar";
import DataEditor from "../components/DataEditor";
import DataSidebar from "../components/DataSidebar";
import { emptyCollection } from "../lib/drawing";
import {
  layerDataToPoints,
  ensureRowUUIDs,
  defaultCountyRegions,
  singlePointStarter,
  categorizedPointsStarter,
  colorCodedRegionsStarter,
  type StarterType,
} from "../lib/starterData";
import type {
  DrawnFeatureCollection,
  EditorTab,
  EditorMode,
  DataLayerTab,
  DataConfig,
  LayerData,
  ColumnMappings,
  DataRow,
  ViewCuration,
  PrimaryElement,
  PublicationBounds,
} from "../types";
import sunIcon from "../assets/colorado-sun-icon.svg";

/** Debounce delay (ms) before persisting changes to the API. */
const AUTOSAVE_DEBOUNCE_MS = 1000;

// ── Default empty layer ──────────────────────────────────────

function emptyLayer(): LayerData {
  return { columns: [], rows: [], columnMappings: {} };
}

function parseDataConfig(raw: Record<string, unknown>): DataConfig {
  const regions = (raw?.regions as LayerData | undefined);
  const points = (raw?.points as LayerData | undefined);
  const primaryElements = (raw?.primaryElements as PrimaryElement[] | undefined);
  const publicationBounds = (raw?.publicationBounds as PublicationBounds | undefined);
  // Retroactively assign stable UUIDs to any rows that lack them
  if (points?.rows) ensureRowUUIDs(points.rows);
  return {
    // Pre-populate regions with county data when empty
    regions: (regions && regions.rows.length > 0) ? regions : defaultCountyRegions(),
    points: points ?? emptyLayer(),
    primaryElements: primaryElements ?? [],
    publicationBounds,
  };
}

export default function MapEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mapData, setMapData] = useState<MapDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEmbedCode, setShowEmbedCode] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showHiddenMenu, setShowHiddenMenu] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("settings");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const hiddenMenuRef = useRef<HTMLDivElement | null>(null);
  const drawSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const curationSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leafletMapRef = useRef<import("leaflet").Map | null>(null);

  // ── View curation state ────────────────────────────────────
  const [viewCuration, setViewCuration] = useState<ViewCuration | null>(null);
  const [viewLocked, setViewLocked] = useState(false);

  // ── Tab state ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<EditorTab>("layout");
  const [activeLayer, setActiveLayer] = useState<DataLayerTab>("points");

  // ── Data config (local copy — saved on changes) ───────────
  const [dataConfig, setDataConfig] = useState<DataConfig>({
    regions: emptyLayer(),
    points: emptyLayer(),
    primaryElements: [],
  });

  const fetchMap = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Wait for FontAwesome icons to be registered before rendering markers
      await loadFaIconNames();
      const data = await getMap(id);
      setMapData(data);
      setDataConfig(parseDataConfig(data.data_config ?? {}));
      // Restore view curation if saved
      const raw = data.data_config as Record<string, unknown> | undefined;
      if (raw?.viewCuration && typeof raw.viewCuration === "object") {
        const vc = raw.viewCuration as ViewCuration;
        setViewCuration(vc);
        setViewLocked(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load map");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async (designState: Record<string, unknown>) => {
    if (!id) return;
    await updateMap(id, { design_state: designState });
  };

  const handleStatusChange = async (newStatus: 'draft' | 'published' | 'archived') => {
    if (!id || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await updateMap(id, { status: newStatus });
      setMapData((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setPublishing(false);
      setShowStatusMenu(false);
    }
  };

  const handleTitleSave = async () => {
    if (!id || !titleDraft.trim() || titleDraft.trim() === mapData?.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      await updateMap(id, { title: titleDraft.trim() });
      setMapData((prev) => prev ? { ...prev, title: titleDraft.trim() } : prev);
      setEditingTitle(false);
    } catch {
      // keep editing open on failure
    } finally {
      setSavingTitle(false);
    }
  };

  // Close status menu on outside click
  useEffect(() => {
    if (!showStatusMenu && !showHiddenMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (showStatusMenu && statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false);
      }
      if (showHiddenMenu && hiddenMenuRef.current && !hiddenMenuRef.current.contains(e.target as Node)) {
        setShowHiddenMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showStatusMenu, showHiddenMenu]);

  // Focus title input when entering edit mode
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // ── Persist data_config after each change (debounced) ──────
  const saveDataConfig = useCallback(
    (config: DataConfig) => {
      if (!id) return;
      if (dataSaveTimerRef.current) clearTimeout(dataSaveTimerRef.current);
      dataSaveTimerRef.current = setTimeout(async () => {
        try {
          const data_config = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
          await updateMap(id, { data_config });
        } catch {
          // non-fatal — user can retry
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [id],
  );

  // ── Layer-level updaters ──────────────────────────────────

  const updateLayer = useCallback(
    (layer: DataLayerTab, updater: (prev: LayerData) => LayerData) => {
      setDataConfig((prev) => {
        const next: DataConfig = { ...prev, [layer]: updater(prev[layer]) };
        saveDataConfig(next);
        return next;
      });
    },
    [saveDataConfig],
  );

  const handleColumnsChange = useCallback(
    (cols: string[]) => updateLayer(activeLayer, (l) => ({ ...l, columns: cols })),
    [activeLayer, updateLayer],
  );

  const handleRowsChange = useCallback(
    (rows: DataRow[]) => updateLayer(activeLayer, (l) => ({ ...l, rows })),
    [activeLayer, updateLayer],
  );

  const handleMappingsChange = useCallback(
    (mappings: ColumnMappings) =>
      updateLayer(activeLayer, (l) => ({ ...l, columnMappings: mappings })),
    [activeLayer, updateLayer],
  );

  const [staleColumns, setStaleColumns] = useState<string[]>([]);

  const handleSheetLoaded = useCallback(
    (data: Pick<LayerData, "columns" | "rows" | "googleSheetsUrl" | "lastSynced">) => {
      updateLayer(activeLayer, (l) => {
        // Detect columns that have mappings but no longer exist in the sheet
        const newColSet = new Set(data.columns);
        const orphaned = Object.keys(l.columnMappings).filter(
          (c) => l.columnMappings[c] !== "none" && !newColSet.has(c),
        );
        setStaleColumns(orphaned);
        return { ...l, ...data };
      });
    },
    [activeLayer, updateLayer],
  );

  const clearStaleColumns = useCallback(() => {
    updateLayer(activeLayer, (l) => {
      const cleaned = { ...l.columnMappings };
      staleColumns.forEach((col) => delete cleaned[col]);
      return { ...l, columnMappings: cleaned };
    });
    setStaleColumns([]);
  }, [activeLayer, updateLayer, staleColumns]);

  // ── Derive map points from dataConfig.points ──────────────
  const mapPoints = useMemo(
    () => layerDataToPoints(dataConfig.points),
    [dataConfig.points],
  );

  // ── Starter data loading ──────────────────────────────────
  const handleLoadStarter = useCallback(
    (type: StarterType) => {
      setDataConfig((prev) => {
        let next: DataConfig;
        if (type === "single-point") {
          next = { ...prev, points: singlePointStarter() };
        } else if (type === "categorized-points") {
          next = { ...prev, points: categorizedPointsStarter() };
        } else {
          // color-coded-regions: populate regions with sample values
          next = { ...prev, regions: colorCodedRegionsStarter() };
        }
        saveDataConfig(next);
        return next;
      });
    },
    [saveDataConfig],
  );

  const handleClearPoints = useCallback(() => {
    updateLayer("points", () => emptyLayer());
  }, [updateLayer]);

  // ── Debounced save for drawn features ──────────────────────
  const handleDrawnFeaturesChange = useCallback(
    (features: DrawnFeatureCollection) => {
      if (!id) return;
      if (drawSaveTimerRef.current) clearTimeout(drawSaveTimerRef.current);
      drawSaveTimerRef.current = setTimeout(async () => {
        try {
          await updateMap(id, {
            data_config: { drawnFeatures: features },
          });
        } catch {
          // Non-blocking — persistence failure is silent
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [id],
  );

  // Parse drawn features from the loaded data_config
  const initialDrawnFeatures = useMemo<DrawnFeatureCollection>(() => {
    if (!mapData?.data_config) return emptyCollection();
    const raw = mapData.data_config as Record<string, unknown>;
    if (raw.drawnFeatures && typeof raw.drawnFeatures === "object") {
      return raw.drawnFeatures as DrawnFeatureCollection;
    }
    return emptyCollection();
  }, [mapData]);

  const embedUrl = `${window.location.origin}/embed/${id}`;

  // ── Primary elements handlers ─────────────────────────────
  const handleAddPrimaryElement = useCallback(
    (element: PrimaryElement) => {
      setDataConfig((prev) => {
        const next = { ...prev, primaryElements: [...(prev.primaryElements ?? []), element] };
        saveDataConfig(next);
        return next;
      });
    },
    [saveDataConfig],
  );

  const handleRemovePrimaryElement = useCallback(
    (elementId: string) => {
      setDataConfig((prev) => {
        const next = {
          ...prev,
          primaryElements: (prev.primaryElements ?? []).filter((e) => e.id !== elementId),
        };
        saveDataConfig(next);
        return next;
      });
    },
    [saveDataConfig],
  );

  const handleUpdatePrimaryElement = useCallback(
    (elementId: string, updates: Partial<PrimaryElement>) => {
      setDataConfig((prev) => {
        const next = {
          ...prev,
          primaryElements: (prev.primaryElements ?? []).map((e) =>
            e.id === elementId ? { ...e, ...updates } : e,
          ),
        };
        saveDataConfig(next);
        return next;
      });
    },
    [saveDataConfig],
  );

  // ── Publication bounds handlers (C4) ──────────────────────
  const handleUpdatePublicationBounds = useCallback(
    (bounds: PublicationBounds | undefined) => {
      setDataConfig((prev) => {
        const next = { ...prev, publicationBounds: bounds };
        saveDataConfig(next);
        return next;
      });
    },
    [saveDataConfig],
  );

  const handleSetBoundsFromView = useCallback(
    (target: "desktop" | "mobile") => {
      const map = leafletMapRef.current;
      if (!map) return;
      const b = map.getBounds();
      const boundsArray: [[number, number], [number, number]] = [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ];
      setDataConfig((prev) => {
        const next = {
          ...prev,
          publicationBounds: { ...prev.publicationBounds, [target]: boundsArray },
        };
        saveDataConfig(next);
        return next;
      });
    },
    [saveDataConfig],
  );

  // ── View curation handlers ────────────────────────────────
  const saveCuration = useCallback(
    (curation: ViewCuration | null) => {
      if (!id) return;
      if (curationSaveTimerRef.current) clearTimeout(curationSaveTimerRef.current);
      curationSaveTimerRef.current = setTimeout(async () => {
        try {
          await updateMap(id, {
            data_config: { viewCuration: curation ?? undefined },
          });
        } catch {
          // non-fatal
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [id],
  );

  const handleLockView = useCallback(() => {
    const map = leafletMapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const curation: ViewCuration = {
      center: [center.lat, center.lng],
      zoom,
      bounds: [
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ],
      hiddenFeatureIds: viewCuration?.hiddenFeatureIds ?? [],
    };
    setViewCuration(curation);
    setViewLocked(true);
    saveCuration(curation);
  }, [saveCuration, viewCuration?.hiddenFeatureIds]);

  const handleUnlockView = useCallback(() => {
    setViewLocked(false);
    // Keep curation data but unlock navigation - user can re-lock at different position
  }, []);

  const handleClearCuration = useCallback(() => {
    setViewCuration(null);
    setViewLocked(false);
    saveCuration(null);
  }, [saveCuration]);

  const handleHideFeature = useCallback(
    (featureId: string) => {
      setViewCuration((prev) => {
        if (!prev) return prev;
        const next: ViewCuration = {
          ...prev,
          hiddenFeatureIds: [...prev.hiddenFeatureIds, featureId],
        };
        saveCuration(next);
        return next;
      });
    },
    [saveCuration],
  );

  const handleShowFeature = useCallback(
    (featureId: string) => {
      setViewCuration((prev) => {
        if (!prev) return prev;
        const next: ViewCuration = {
          ...prev,
          hiddenFeatureIds: prev.hiddenFeatureIds.filter((id) => id !== featureId),
        };
        saveCuration(next);
        return next;
      });
    },
    [saveCuration],
  );

  const handleMapRef = useCallback((map: import("leaflet").Map | null) => {
    leafletMapRef.current = map;
  }, []);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-gray-50">
        <FontAwesomeIcon icon={faSpinner} spin className="text-3xl text-blue-500" />
      </div>
    );
  }

  if (error || !mapData) {
    return (
      <div className="flex h-dvh items-center justify-center bg-gray-50">
        <div className="text-center">
          <FontAwesomeIcon icon={faExclamationTriangle} className="mb-3 text-3xl text-amber-500" />
          <p className="mb-3 text-sm font-medium text-gray-700">{error ?? "Map not found"}</p>
          <button
            onClick={fetchMap}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <FontAwesomeIcon icon={faRotateRight} />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <DesignProvider
      initialDesignState={mapData.design_state}
      onSave={handleSave}
    >
      <div className="flex h-dvh flex-col">
        {/* Editor toolbar */}
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <img src={sunIcon} alt="" className="h-5 w-5" />
              <FontAwesomeIcon icon={faArrowLeft} className="text-xs" />
              Maps
            </button>
            {/* Inline title editing */}
            {editingTitle ? (
              <div className="flex items-center gap-1.5">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTitleSave();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm font-medium text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  style={{ width: `${Math.max(titleDraft.length, 10)}ch` }}
                />
                <button
                  onClick={handleTitleSave}
                  disabled={savingTitle || !titleDraft.trim() || titleDraft.trim() === mapData.title}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {savingTitle ? <FontAwesomeIcon icon={faSpinner} spin /> : "Save"}
                </button>
                <button
                  onClick={() => setEditingTitle(false)}
                  className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setTitleDraft(mapData.title);
                  setEditingTitle(true);
                }}
                className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-gray-900 hover:bg-gray-100 transition-colors"
                title="Click to rename"
              >
                {mapData.title}
                <FontAwesomeIcon icon={faPen} className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            {/* Live badge */}
            {mapData.status === "published" && (
              <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-200 transition-colors"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </a>
            )}
          </div>
          {/* Editor mode toggle */}
          <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setEditorMode("settings")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                editorMode === "settings"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <FontAwesomeIcon icon={faGear} className="text-[11px]" />
              Settings
            </button>
            <button
              onClick={() => setEditorMode("customize")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                editorMode === "customize"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <FontAwesomeIcon icon={faPaintBrush} className="text-[11px]" />
              Customize
              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-600">DEV</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Status workflow dropdown */}
            <div className="relative" ref={statusMenuRef}>
              <button
                onClick={() => setShowStatusMenu(!showStatusMenu)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mapData.status === "published"
                    ? "text-emerald-700 hover:bg-emerald-50"
                    : mapData.status === "archived"
                      ? "text-gray-500 hover:bg-gray-100"
                      : "text-amber-700 hover:bg-amber-50"
                }`}
              >
                <FontAwesomeIcon
                  icon={
                    mapData.status === "published"
                      ? faGlobe
                      : mapData.status === "archived"
                        ? faBoxArchive
                        : faFileAlt
                  }
                />
                {mapData.status === "published"
                  ? "Published"
                  : mapData.status === "archived"
                    ? "Archived"
                    : "Draft"}
                <FontAwesomeIcon icon={faChevronDown} className="text-[10px] opacity-60" />
              </button>
              {showStatusMenu && (
                <div className="absolute right-0 z-50 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {(
                    [
                      { value: "draft" as const, label: "Draft", icon: faFileAlt, color: "text-amber-600" },
                      { value: "published" as const, label: "Published", icon: faGlobe, color: "text-emerald-600" },
                      { value: "archived" as const, label: "Archived", icon: faBoxArchive, color: "text-gray-500" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleStatusChange(option.value)}
                      disabled={publishing || mapData.status === option.value}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 ${option.color}`}
                    >
                      <FontAwesomeIcon icon={option.icon} className="w-4" />
                      {option.label}
                      {mapData.status === option.value && (
                        <FontAwesomeIcon icon={faCheck} className="ml-auto text-xs" />
                      )}
                    </button>
                  ))}
                  {publishing && (
                    <div className="flex items-center justify-center py-1">
                      <FontAwesomeIcon icon={faSpinner} spin className="text-xs text-gray-400" />
                    </div>
                  )}
                </div>
              )}
            </div>
            {publishError && (
              <span className="text-xs text-red-500">{publishError}</span>
            )}
            {/* Lock/Unlock View — only in Customize mode */}
            {editorMode === "customize" && (
            <div className="flex items-center gap-1">
              {viewLocked ? (
                <>
                  <button
                    onClick={handleUnlockView}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
                    title="Unlock view to pan & zoom"
                  >
                    <FontAwesomeIcon icon={faLock} className="text-xs" />
                    View Locked
                  </button>
                  {viewCuration && viewCuration.hiddenFeatureIds.length > 0 && (
                    <div className="relative" ref={hiddenMenuRef}>                      <button
                        onClick={() => setShowHiddenMenu(!showHiddenMenu)}
                        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-200 transition-colors"
                      >
                        <FontAwesomeIcon icon={faEye} className="text-[9px]" />
                        {viewCuration.hiddenFeatureIds.length} hidden
                      </button>
                      {showHiddenMenu && (
                        <div className="absolute right-0 z-50 mt-1 w-56 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          <p className="px-3 py-1.5 text-xs font-medium text-gray-500">Hidden Features</p>
                          {viewCuration.hiddenFeatureIds.map((fid) => (
                            <button
                              key={fid}
                              onClick={() => {
                                handleShowFeature(fid);
                                if (viewCuration.hiddenFeatureIds.length <= 1) {
                                  setShowHiddenMenu(false);
                                }
                              }}
                              className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50"
                            >
                              <span className="truncate text-gray-700">{fid}</span>
                              <span className="ml-2 shrink-0 text-blue-600">Show</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={handleClearCuration}
                    className="rounded-md px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-gray-100 transition-colors"
                    title="Clear curation (unlock + unhide all)"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <button
                  onClick={handleLockView}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                  title="Lock current view for curation"
                >
                  <FontAwesomeIcon icon={faLockOpen} className="text-xs" />
                  Lock View
                </button>
              )}
            </div>
            )}
            <button
              onClick={() => setShowEmbedCode(!showEmbedCode)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <FontAwesomeIcon icon={faCode} />
              Embed
            </button>
          </div>
        </header>

        {/* Embed code banner */}
        {showEmbedCode && id && <EmbedCodeBanner mapId={id} />}

        {/* Tab bar: Preview | Data */}
        <DataTabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeLayer={activeLayer}
          onLayerChange={setActiveLayer}
        />

        {/* Main content — switches between Preview and Data tab */}
        <div className="min-h-0 flex-1">
          {activeTab === "layout" ? (
            <MapEditorContent
              mapId={id}
              points={mapPoints}
              onLoadStarter={handleLoadStarter}
              onClearPoints={handleClearPoints}
              initialDrawnFeatures={initialDrawnFeatures}
              onDrawnFeaturesChange={handleDrawnFeaturesChange}
              viewCuration={viewCuration}
              viewLocked={viewLocked}
              onHideFeature={handleHideFeature}
              onMapRef={handleMapRef}
              editorMode={editorMode}
              primaryElements={dataConfig.primaryElements ?? []}
              onAddPrimaryElement={handleAddPrimaryElement}
              onRemovePrimaryElement={handleRemovePrimaryElement}
              onUpdatePrimaryElement={handleUpdatePrimaryElement}
              publicationBounds={dataConfig.publicationBounds}
              onUpdatePublicationBounds={handleUpdatePublicationBounds}
              onSetBoundsFromView={handleSetBoundsFromView}
              onLockView={handleLockView}
              onUnlockView={handleUnlockView}
              onClearCuration={handleClearCuration}
            />
          ) : (
            /* Data tab: editor + sidebar side-by-side */
            <div className="flex h-full">
              <div className="min-w-0 flex-1 overflow-hidden">
                <DataEditor
                  columns={dataConfig[activeLayer].columns}
                  rows={dataConfig[activeLayer].rows}
                  columnMappings={dataConfig[activeLayer].columnMappings}
                  onColumnsChange={handleColumnsChange}
                  onRowsChange={handleRowsChange}
                />
              </div>
              <DataSidebar
                layerData={dataConfig[activeLayer]}
                onUpdateMappings={handleMappingsChange}
                onSheetLoaded={handleSheetLoaded}
                onRowsChange={handleRowsChange}
                staleColumns={staleColumns}
                onClearStaleColumns={clearStaleColumns}
              />
            </div>
          )}
        </div>
      </div>
    </DesignProvider>
  );
}
