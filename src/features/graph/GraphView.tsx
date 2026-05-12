import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, TouchEvent, WheelEvent as ReactWheelEvent } from "react";
import type { GraphStats } from "../../types";

type GestureLikeEvent = Event & { scale?: number; clientX?: number; clientY?: number };
type GraphPayload = NonNullable<GraphStats["graph"]>;
type GraphNodePayload = GraphPayload["nodes"][number];
type GraphEdgePayload = GraphPayload["edges"][number];
type EmbeddingPoint = NonNullable<GraphStats["embedding"]>["points"][number];
type GraphMode = "curated" | "evidence" | "correlation" | "all";
type CameraMode = "orbit" | "front" | "top";
type SpatialCamera = { yaw: number; pitch: number; zoom: number };

type SkillGrade = {
  node: GraphNodePayload;
  score: number;
  grade: string;
  projectCount: number;
  relationCount: number;
  relatedCount: number;
};

type AtlasNode = GraphNodePayload & {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: string;
  support: number;
  score?: number;
  grade?: string;
};

type AtlasEdge = {
  source: string;
  target: string;
  weight: number;
  label: string;
  kind: "evidence" | "correlation";
};

const MAX_ATLAS_SKILLS = 24;
const ATLAS_VIEWPORT_WIDTH = 1000;

const PROFILE_EDGE_TYPES = new Set([
  "HAS_SKILL",
  "WORKED_AS",
  "BUILT",
  "HAS_CERTIFICATION",
  "HAS_EDUCATION",
  "HAS_ACHIEVEMENT",
  "PROJ_UTILIZES",
  "EXP_UTILIZES",
  "CERTIFIES",
  "EDUCATES",
  "ACHIEVEMENT_USES",
  "RELATED_SKILL",
  "SIMILAR_PROJECT",
  "SUPPORTS_EXPERIENCE",
]);

const SKILL_EDGE_TYPES = new Set(["HAS_SKILL", "PROJ_UTILIZES", "EXP_UTILIZES", "CERTIFIES", "EDUCATES", "ACHIEVEMENT_USES"]);
const CROSS_EDGE_TYPES = new Set(["RELATED_SKILL", "SIMILAR_PROJECT", "SUPPORTS_EXPERIENCE"]);
const EDGE_COPY: Record<string, string> = {
  HAS_SKILL: "profile skill",
  BUILT: "built",
  PROJ_UTILIZES: "uses",
  EXP_UTILIZES: "uses",
  CERTIFIES: "certifies",
  EDUCATES: "teaches",
  ACHIEVEMENT_USES: "uses",
  RELATED_SKILL: "related",
  SIMILAR_PROJECT: "similar",
  SUPPORTS_EXPERIENCE: "supports",
};

const TONES: Record<string, string> = {
  Profile: "purple",
  Skill: "orange",
  Project: "pink",
  Experience: "green",
  Candidate: "purple",
  Credential: "blue",
  Certification: "blue",
  Education: "blue",
  Achievement: "blue",
  JobLead: "blue",
};

function truncate(text: string, max = 24) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(value: number) {
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return Number(next.toFixed(1));
}

function edgeLabel(type: string) {
  return EDGE_COPY[type] || type.replace(/_/g, " ").toLowerCase();
}

function nodeSupport(nodeId: string, edges: GraphEdgePayload[]) {
  return edges.filter(edge => edge.source === nodeId || edge.target === nodeId).length;
}

function otherNode(edge: GraphEdgePayload, nodeId: string, nodeMap: Map<string, GraphNodePayload>) {
  const otherId = edge.source === nodeId ? edge.target : edge.source;
  return nodeMap.get(otherId);
}

function uniqueNodes(nodes: (GraphNodePayload | undefined)[]) {
  const seen = new Set<string>();
  return nodes.filter((node): node is GraphNodePayload => {
    if (!node || seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function skillIdsFor(nodeId: string, edges: GraphEdgePayload[], nodeMap: Map<string, GraphNodePayload>) {
  return new Set(
    edges
      .filter(edge => (edge.source === nodeId || edge.target === nodeId) && SKILL_EDGE_TYPES.has(edge.type))
      .map(edge => otherNode(edge, nodeId, nodeMap))
      .filter((node): node is GraphNodePayload => Boolean(node && node.type === "Skill"))
      .map(node => node.id)
  );
}

function scoreSkill(skill: GraphNodePayload, edges: GraphEdgePayload[], nodeMap: Map<string, GraphNodePayload>): SkillGrade {
  const touching = edges.filter(edge => edge.source === skill.id || edge.target === skill.id);
  const projects = uniqueNodes(touching.filter(edge => SKILL_EDGE_TYPES.has(edge.type)).map(edge => otherNode(edge, skill.id, nodeMap))).filter(node => node.type === "Project");
  const related = uniqueNodes(touching.filter(edge => CROSS_EDGE_TYPES.has(edge.type)).map(edge => otherNode(edge, skill.id, nodeMap))).filter(node => node.type === "Skill");
  const relationCount = touching.length;
  const score = Math.min(100, Math.round(projects.length * 24 + relationCount * 4 + related.length * 5));
  const grade = score >= 82 ? "A" : score >= 64 ? "B" : score >= 42 ? "C" : score >= 24 ? "D" : "Seed";
  return { node: skill, score, grade, projectCount: projects.length, relationCount, relatedCount: related.length };
}

function buildRelationAtlas(allNodes: GraphNodePayload[], allEdges: GraphEdgePayload[], limit: number, query: string) {
  const profileNodes = allNodes.filter(node => node.type !== "JobLead");
  const nodeMap = new Map(profileNodes.map(node => [node.id, node]));
  const graphEdges = allEdges.filter(edge => PROFILE_EDGE_TYPES.has(edge.type) && nodeMap.has(edge.source) && nodeMap.has(edge.target));
  const normalizedQuery = query.trim().toLowerCase();
  const projects = profileNodes
    .filter(node => node.type === "Project")
    .filter(node => !normalizedQuery || node.label.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => nodeSupport(b.id, graphEdges) - nodeSupport(a.id, graphEdges))
    .slice(0, 10);
  const rankedGrades = profileNodes
    .filter(node => node.type === "Skill")
    .map(skill => scoreSkill(skill, graphEdges, nodeMap))
    .filter(item => !normalizedQuery || item.node.label.toLowerCase().includes(normalizedQuery) || projects.some(project => skillIdsFor(project.id, graphEdges, nodeMap).has(item.node.id)))
    .sort((a, b) => b.score - a.score || b.relationCount - a.relationCount)
    .slice(0, limit);
  const visibleGrades = rankedGrades.slice(0, MAX_ATLAS_SKILLS);
  const overflowGrades = rankedGrades.slice(MAX_ATLAS_SKILLS);
  const overflowGroups = ["A", "B", "C", "D", "Seed"]
    .map(grade => {
      const items = overflowGrades.filter(item => item.grade === grade);
      if (!items.length) return null;
      const score = Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length);
      return { id: `skill-cluster:${grade}`, label: `${grade} skills`, type: "SkillCluster", grade, score, items };
    })
    .filter((item): item is { id: string; label: string; type: string; grade: string; score: number; items: SkillGrade[] } => Boolean(item));
  const grades = visibleGrades;
  const skillToCluster = new Map<string, string>();
  overflowGroups.forEach(group => group.items.forEach(item => skillToCluster.set(item.node.id, group.id)));
  const projectIds = new Set(projects.map(project => project.id));
  const allRankedSkillIds = new Set(rankedGrades.map(grade => grade.node.id));
  const drawableSkillIds = new Set([...grades.map(grade => grade.node.id), ...overflowGroups.map(group => group.id)]);
  const clusterRows = Math.max(1, Math.ceil(grades.length / 2) + overflowGroups.length);
  const height = 680;
  const projectGap = projects.length <= 1 ? 0 : Math.min(68, (height - 170) / (projects.length - 1));
  const skillGap = clusterRows <= 1 ? 0 : Math.min(70, (height - 180) / (clusterRows - 1));
  const projectStart = height / 2 - ((projects.length - 1) * projectGap) / 2;
  const skillStart = height / 2 - ((clusterRows - 1) * skillGap) / 2;
  const projectNodes: AtlasNode[] = projects.map((project, index) => ({
    ...project,
    x: 150 + (index % 2) * 86,
    y: projectStart + index * projectGap,
    w: 210,
    h: 42,
    tone: "pink",
    support: nodeSupport(project.id, graphEdges),
  }));
  const skillNodes: AtlasNode[] = grades.map((grade, index) => ({
    ...grade.node,
    x: 760 + (index % 2) * 150,
    y: skillStart + Math.floor(index / 2) * skillGap,
    w: 190,
    h: 38,
    tone: "orange",
    support: grade.relationCount,
    score: grade.score,
    grade: grade.grade,
  }));
  const clusterNodes: AtlasNode[] = overflowGroups.map((group, index) => ({
    id: group.id,
    label: group.label,
    type: group.type,
    subtitle: `${group.items.length} grouped skills`,
    x: 835,
    y: skillStart + (Math.ceil(grades.length / 2) + index) * skillGap,
    w: 210,
    h: 38,
    tone: "blue",
    support: group.items.reduce((sum, item) => sum + item.relationCount, 0),
    score: group.score,
    grade: group.grade,
  }));
  const evidenceEdges: AtlasEdge[] = graphEdges.flatMap(edge => {
    if (!SKILL_EDGE_TYPES.has(edge.type)) return [];
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) return [];
    const project = source.type === "Project" ? source : target.type === "Project" ? target : null;
    const skill = source.type === "Skill" ? source : target.type === "Skill" ? target : null;
    if (!project || !skill || !projectIds.has(project.id) || !allRankedSkillIds.has(skill.id)) return [];
    const grade = grades.find(item => item.node.id === skill.id);
    const targetId = drawableSkillIds.has(skill.id) ? skill.id : skillToCluster.get(skill.id);
    if (!targetId) return [];
    const overflowGrade = rankedGrades.find(item => item.node.id === skill.id);
    return [{ source: project.id, target: targetId, weight: Math.max(1, (grade?.score || overflowGrade?.score || 25) / 24), label: edgeLabel(edge.type), kind: "evidence" as const }];
  });
  const correlationEdges: AtlasEdge[] = [];
  for (let i = 0; i < projects.length; i += 1) {
    const a = projects[i];
    const aSkills = skillIdsFor(a.id, graphEdges, nodeMap);
    for (let j = i + 1; j < projects.length; j += 1) {
      const b = projects[j];
      const bSkills = skillIdsFor(b.id, graphEdges, nodeMap);
      const shared = [...aSkills].filter(id => bSkills.has(id) && allRankedSkillIds.has(id)).length;
      if (shared > 0) correlationEdges.push({ source: a.id, target: b.id, weight: shared, label: `${shared} shared skills`, kind: "correlation" });
    }
  }
  const nodes = [...projectNodes, ...skillNodes, ...clusterNodes];
  const nodeLookup = new Map(nodes.map(node => [node.id, node]));
  return { projects: projectNodes, skills: skillNodes, clusters: clusterNodes, nodes, edges: evidenceEdges, correlations: correlationEdges, grades: rankedGrades, nodeLookup, height };
}

function relationPath(source: AtlasNode, target: AtlasNode, kind: AtlasEdge["kind"]) {
  if (kind === "correlation") {
    const x = source.x - source.w / 2 - 32;
    const c = x - Math.max(45, Math.abs(source.y - target.y) * 0.25);
    return `M ${source.x - source.w / 2} ${source.y} C ${c} ${source.y}, ${c} ${target.y}, ${target.x - target.w / 2} ${target.y}`;
  }
  const startX = source.x + source.w / 2;
  const endX = target.x - target.w / 2;
  const c1 = startX + 220;
  const c2 = endX - 220;
  return `M ${startX} ${source.y} C ${c1} ${source.y}, ${c2} ${target.y}, ${endX} ${target.y}`;
}

function KnowledgeRelationAtlas({ stats }: { stats: GraphStats }) {
  const [mode, setMode] = useState<GraphMode>("curated");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(18);
  const [selectedId, setSelectedId] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const atlasHoverRef = useRef(false);
  const panRef = useRef({ active: false, x: 0, y: 0, panX: 0, panY: 0 });
  const pinchRef = useRef({ active: false, distance: 0, zoom: 1, centerX: 0, centerY: 0, panX: 0, panY: 0 });
  const gestureRef = useRef({ active: false, scale: 1, zoom: 1, clientX: 0, clientY: 0 });
  const viewportPinchRef = useRef({ scale: 1, zoom: 1 });
  const atlas = useMemo(() => buildRelationAtlas(stats.graph?.nodes || [], stats.graph?.edges || [], limit, query), [stats.graph?.nodes, stats.graph?.edges, limit, query]);
  const selected = selectedId ? atlas.nodeLookup.get(selectedId) : undefined;
  const modeEdges = mode === "all"
    ? [...atlas.edges, ...atlas.correlations]
    : mode === "correlation"
      ? atlas.correlations
      : mode === "evidence"
        ? atlas.edges
        : atlas.edges.filter(edge => edge.weight >= 2.25).slice(0, 28);
  const selectedEdges = selected ? modeEdges.filter(edge => edge.source === selected.id || edge.target === selected.id) : [];
  const visibleEdges = selected ? selectedEdges : modeEdges;
  const focusedIds = new Set(selected ? [selected.id, ...selectedEdges.flatMap(edge => [edge.source, edge.target])] : atlas.nodes.map(node => node.id));
  const selectedGrade = selected?.type === "Skill" ? atlas.grades.find(item => item.node.id === selected.id) : null;
  const averageScore = atlas.grades.length ? Math.round(atlas.grades.reduce((sum, item) => sum + item.score, 0) / atlas.grades.length) : 0;
  const related = selected ? uniqueNodes(selectedEdges.map(edge => edge.source === selected.id ? atlas.nodeLookup.get(edge.target) : atlas.nodeLookup.get(edge.source))) : [...atlas.projects.slice(0, 4), ...atlas.skills.slice(0, 5)];
  const strongestSkill = atlas.grades[0];
  const relationDensity = atlas.nodes.length ? Math.round((atlas.edges.length / atlas.nodes.length) * 10) / 10 : 0;
  const clampPanToView = (nextPan: { x: number; y: number }, nextZoom = zoom) => {
    const stage = stageRef.current;
    if (!stage) return nextPan;
    const viewWidth = stage.clientWidth;
    const viewHeight = stage.clientHeight;
    const scaledWidth = ATLAS_VIEWPORT_WIDTH * nextZoom;
    const scaledHeight = atlas.height * nextZoom;
    const edgePeekX = Math.min(90, viewWidth * 0.18);
    const edgePeekY = Math.min(80, viewHeight * 0.18);
    const clampAxis = (value: number, viewSize: number, contentSize: number, edgePeek: number) => {
      if (contentSize <= viewSize) return (viewSize - contentSize) / 2;
      const min = viewSize - contentSize - edgePeek;
      const max = edgePeek;
      return clamp(value, min, max);
    };
    return {
      x: clampAxis(nextPan.x, viewWidth, scaledWidth, edgePeekX),
      y: clampAxis(nextPan.y, viewHeight, scaledHeight, edgePeekY),
    };
  };
  const zoomAtClientPoint = (clientX: number, clientY: number, nextZoom: number) => {
    const stage = stageRef.current;
    if (!stage || nextZoom === zoom) return;
    const rect = stage.getBoundingClientRect();
    const cursorX = clientX ? clientX - rect.left : rect.width / 2;
    const cursorY = clientY ? clientY - rect.top : rect.height / 2;
    const worldX = (cursorX - pan.x) / zoom;
    const worldY = (cursorY - pan.y) / zoom;
    setZoom(nextZoom);
    setPan(clampPanToView({ x: cursorX - worldX * nextZoom, y: cursorY - worldY * nextZoom }, nextZoom));
  };
  useEffect(() => {
    setPan(value => clampPanToView(value, zoom));
  }, [atlas.height, zoom]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const wheelScale = (event: globalThis.WheelEvent) => event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
    const eventIsInsideAtlas = (event: globalThis.WheelEvent) => {
      if (event.target instanceof Node && stage.contains(event.target)) return true;
      const rect = stage.getBoundingClientRect();
      return (
        atlasHoverRef.current &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };
    const handleAtlasWheel = (event: globalThis.WheelEvent) => {
      if (!eventIsInsideAtlas(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const scale = wheelScale(event);
      const delta = (Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX) * scale;
      const zoomSpeed = event.ctrlKey || event.metaKey ? 0.0016 : 0.0011;
      const nextZoom = clamp(Number((zoom - delta * zoomSpeed).toFixed(2)), 0.65, 1.9);
      zoomAtClientPoint(event.clientX, event.clientY, nextZoom);
    };
    const handleGestureStart = (event: Event) => {
      const gesture = event as GestureLikeEvent;
      const rect = stage.getBoundingClientRect();
      const clientX = gesture.clientX || rect.left + rect.width / 2;
      const clientY = gesture.clientY || rect.top + rect.height / 2;
      if (
        !atlasHoverRef.current &&
        (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
      ) return;
      event.preventDefault();
      event.stopPropagation();
      gestureRef.current = { active: true, scale: gesture.scale || 1, zoom, clientX, clientY };
    };
    const handleGestureChange = (event: Event) => {
      if (!gestureRef.current.active) return;
      const gesture = event as GestureLikeEvent;
      event.preventDefault();
      event.stopPropagation();
      const baseScale = gestureRef.current.scale || 1;
      const nextZoom = clamp(Number((gestureRef.current.zoom * ((gesture.scale || 1) / baseScale)).toFixed(2)), 0.65, 1.9);
      zoomAtClientPoint(gesture.clientX || gestureRef.current.clientX, gesture.clientY || gestureRef.current.clientY, nextZoom);
    };
    const handleGestureEnd = () => {
      gestureRef.current.active = false;
    };
    const handleViewportResize = () => {
      const viewport = window.visualViewport;
      if (!viewport || !atlasHoverRef.current) return;
      const scale = viewport.scale || 1;
      if (Math.abs(scale - viewportPinchRef.current.scale) < 0.015) return;
      const rect = stage.getBoundingClientRect();
      if (Math.abs(viewportPinchRef.current.scale - 1) < 0.015) viewportPinchRef.current.zoom = zoom;
      const nextZoom = clamp(Number((viewportPinchRef.current.zoom * scale).toFixed(2)), 0.65, 1.9);
      zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, nextZoom);
      viewportPinchRef.current.scale = scale;
    };
    window.addEventListener("wheel", handleAtlasWheel, { passive: false, capture: true });
    window.addEventListener("gesturestart", handleGestureStart, { passive: false, capture: true });
    window.addEventListener("gesturechange", handleGestureChange, { passive: false, capture: true });
    window.addEventListener("gestureend", handleGestureEnd, { capture: true });
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("wheel", handleAtlasWheel, { capture: true });
      window.removeEventListener("gesturestart", handleGestureStart, { capture: true });
      window.removeEventListener("gesturechange", handleGestureChange, { capture: true });
      window.removeEventListener("gestureend", handleGestureEnd, { capture: true });
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [pan.x, pan.y, zoom]);
  const handleWheelZoom = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const handlePanStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as Element).closest(".graph-atlas-node")) return;
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(event.pointerId);
    panRef.current = { active: true, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setIsPanning(true);
  };
  const handlePanMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!panRef.current.active) return;
    event.preventDefault();
    setPan({
      ...clampPanToView({
        x: panRef.current.panX + (event.clientX - panRef.current.x),
        y: panRef.current.panY + (event.clientY - panRef.current.y),
      }),
    });
  };
  const stopPan = (event?: PointerEvent<HTMLDivElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panRef.current.active = false;
    setIsPanning(false);
  };
  const touchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const [first, second] = [touches[0], touches[1]];
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
  };
  const touchCenter = (touches: React.TouchList) => {
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect();
    const [first, second] = [touches[0], touches[1]];
    const clientX = (first.clientX + second.clientX) / 2;
    const clientY = (first.clientY + second.clientY) / 2;
    return { x: rect ? clientX - rect.left : clientX, y: rect ? clientY - rect.top : clientY };
  };
  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      event.preventDefault();
      event.stopPropagation();
      const center = touchCenter(event.touches);
      pinchRef.current = { active: true, distance: touchDistance(event.touches), zoom, centerX: center.x, centerY: center.y, panX: pan.x, panY: pan.y };
      stopPan();
    }
  };
  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!pinchRef.current.active || event.touches.length !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    const start = pinchRef.current.distance || 1;
    const next = clamp(Number((pinchRef.current.zoom * (touchDistance(event.touches) / start)).toFixed(2)), 0.65, 1.9);
    const worldX = (pinchRef.current.centerX - pinchRef.current.panX) / pinchRef.current.zoom;
    const worldY = (pinchRef.current.centerY - pinchRef.current.panY) / pinchRef.current.zoom;
    setZoom(next);
    setPan(clampPanToView({ x: pinchRef.current.centerX - worldX * next, y: pinchRef.current.centerY - worldY * next }, next));
  };
  const handleTouchEnd = () => {
    pinchRef.current.active = false;
  };

  return (
    <section className="card graph-studio-card" aria-labelledby="knowledge-atlas-title">
      <div className="graph-card-head graph-studio-head">
        <div>
          <span className="eyebrow">Knowledge relation atlas</span>
          <h3 id="knowledge-atlas-title">Evidence, skills, and project cohesion</h3>
          <p>Weighted ribbons show how profile projects prove skills. Select anything to reduce the scene to its actual neighborhood.</p>
        </div>
        <div className="graph-head-pills">
          <span className="pill mono">{atlas.projects.length} projects</span>
          <span className="pill mono">{atlas.skills.length} skills</span>
          <span className="pill mono">{averageScore} avg skill</span>
        </div>
      </div>
      <div className="graph-studio-toolbar">
        <div className="graph-filter-bar" aria-label="Relation atlas mode">
          {[
            ["curated", "Curated"],
            ["evidence", "Evidence"],
            ["correlation", "Correlations"],
            ["all", "All links"],
          ].map(([id, label]) => (
            <button key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id as GraphMode)}>{label}</button>
          ))}
          {selected && <button onClick={() => setSelectedId("")}>Clear focus</button>}
        </div>
        <label className="graph-search-control">
          <span>Search</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Project or skill" />
        </label>
        <label className="graph-search-control compact">
          <span>Depth</span>
          <select value={limit} onChange={event => setLimit(Number(event.target.value))}>
            <option value={12}>Clean</option>
            <option value={18}>Balanced</option>
            <option value={32}>Deep</option>
            <option value={70}>Full</option>
          </select>
        </label>
        <div className="graph-zoom-controls" aria-label="Graph zoom controls">
          <button onClick={() => setZoom(value => clamp(Number((value - 0.15).toFixed(2)), 0.65, 1.9))}>-</button>
          <input
            aria-label="Graph zoom"
            type="range"
            min="0.65"
            max="1.9"
            step="0.05"
            value={zoom}
            onChange={event => setZoom(Number(event.target.value))}
          />
          <button onClick={() => setZoom(value => clamp(Number((value + 0.15).toFixed(2)), 0.65, 1.9))}>+</button>
          <button onClick={() => {
            setZoom(1);
            setPan(clampPanToView({ x: 0, y: 0 }, 1));
          }}>Reset</button>
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      </div>
      <div className="graph-studio-metrics" aria-label="Knowledge graph summary">
        <div>
          <span>{visibleEdges.length}</span>
          <small>{selected ? "focused links" : "visible links"}</small>
        </div>
        <div>
          <span>{atlas.correlations.length}</span>
          <small>project correlations</small>
        </div>
        <div>
          <span>{relationDensity}</span>
          <small>links per node</small>
        </div>
        <div>
          <span>{strongestSkill?.grade || "Seed"}</span>
          <small>{strongestSkill ? truncate(strongestSkill.node.label, 18) : "top skill"}</small>
        </div>
      </div>
      <div className="graph-studio-layout">
        <div
          ref={stageRef}
          className={`graph-atlas-stage ${isPanning ? "panning" : ""}`}
          onWheel={handleWheelZoom}
          onMouseEnter={() => { atlasHoverRef.current = true; }}
          onMouseLeave={() => {
            atlasHoverRef.current = false;
            stopPan();
          }}
          onPointerDown={handlePanStart}
          onPointerMove={handlePanMove}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <svg
            viewBox={`0 0 ${ATLAS_VIEWPORT_WIDTH} ${atlas.height}`}
            className="graph-atlas-svg"
            role="img"
            aria-label="Weighted graph relationship atlas"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <defs>
              <linearGradient id="evidenceRibbon" x1="0" x2="1">
                <stop offset="0%" stopColor="rgba(203, 124, 154, 0.55)" />
                <stop offset="100%" stopColor="rgba(209, 120, 71, 0.72)" />
              </linearGradient>
            </defs>
            <text x="170" y="48" textAnchor="middle" className="graph-lane-label">Proof projects</text>
            <text x="500" y="48" textAnchor="middle" className="graph-lane-label">Weighted relationships</text>
            <text x="835" y="48" textAnchor="middle" className="graph-lane-label">Skills and clusters</text>
            {visibleEdges.map((edge, index) => {
              const source = atlas.nodeLookup.get(edge.source);
              const target = atlas.nodeLookup.get(edge.target);
              if (!source || !target) return null;
              const active = !selected || edge.source === selected.id || edge.target === selected.id;
              return (
                <g key={`${edge.source}-${edge.target}-${edge.kind}-${index}`} className={`graph-atlas-edge ${edge.kind} ${active ? "active" : "dimmed"}`}>
                  <path d={relationPath(source, target, edge.kind)} strokeWidth={Math.min(7, 1.4 + edge.weight)} />
                  {selected && active && (
                    <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 8} textAnchor="middle" className="graph-edge-label">{edge.label}</text>
                  )}
                </g>
              );
            })}
            {atlas.nodes.map(node => {
              const isDimmed = !focusedIds.has(node.id);
              const isActive = selected?.id === node.id;
              return (
                <g
                  key={node.id}
                  className={`graph-atlas-node ${isActive ? "active" : ""} ${isDimmed ? "dimmed" : ""}`}
                  transform={`translate(${node.x},${node.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.type} ${node.label}`}
                  onClick={() => setSelectedId(isActive ? "" : node.id)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(isActive ? "" : node.id);
                    }
                  }}
                >
                  <rect x={-node.w / 2} y={-node.h / 2} width={node.w} height={node.h} rx="12" fill={`var(--${node.tone}-soft)`} stroke={`var(--${node.tone})`} />
                  <circle cx={-node.w / 2 + 18} cy="0" r="5" fill={`var(--${node.tone})`} />
                  <text x={-node.w / 2 + 34} y="-4" className="graph-atlas-label">{truncate(node.label, node.type === "Project" ? 27 : 24)}</text>
                  <text x={-node.w / 2 + 34} y="12" className="graph-node-type">
                    {node.type === "Skill" ? `${node.grade} / ${node.score}` : node.type === "SkillCluster" ? `${node.subtitle}` : `${node.support} links`}
                  </text>
                </g>
              );
            })}
            {atlas.nodes.length === 0 && (
              <g>
                <text x="500" y="285" textAnchor="middle" className="graph-empty-svg">No project-skill evidence yet</text>
                <text x="500" y="313" textAnchor="middle" className="graph-empty-svg-sub">Add profile projects and skills, then refresh graph repair.</text>
              </g>
            )}
          </svg>
          <div className="graph-atlas-legend">
            <span><i className="legend-line evidence" /> Evidence link</span>
            <span><i className="legend-line correlation" /> Shared-skill correlation</span>
            <span><i className="legend-node project" /> Project</span>
            <span><i className="legend-node skill" /> Skill</span>
          </div>
        </div>
        <aside className="graph-studio-inspector">
          <div className="graph-board-subhead">
            <span className="eyebrow">Inspector</span>
            <span className="pill mono">{visibleEdges.length} links</span>
          </div>
          <h4>{selected ? selected.label : "Curated graph"}</h4>
          <p>
            {selectedGrade
              ? `Grade ${selectedGrade.grade}, score ${selectedGrade.score}/100. Backed by ${selectedGrade.projectCount} projects and ${selectedGrade.relatedCount} related skills.`
              : selected
                ? `${selected.support} evidence relationships connect this project to the profile graph.`
                : "Default mode hides noisy edges and shows the strongest evidence routes. Search or click to focus a real graph neighborhood."}
          </p>
          {selectedGrade && (
            <div className="graph-grade-meter" aria-label={`Skill score ${selectedGrade.score}`}>
              <span style={{ width: `${selectedGrade.score}%` }} />
            </div>
          )}
          <div className="graph-mini-label">Related nodes</div>
          <div className="graph-node-pick-list compact">
            {related.slice(0, 10).map(node => (
              <button key={node.id} className="graph-node-pick" onClick={() => setSelectedId(node.id)}>
                <span>{truncate(node.label, 26)}</span>
                <small>{atlas.nodeLookup.get(node.id)?.score ?? atlas.nodeLookup.get(node.id)?.support ?? node.type}</small>
              </button>
            ))}
          </div>
          {related.length === 0 && <span className="graph-chip muted">No visible neighbors in this filter</span>}
        </aside>
      </div>
    </section>
  );
}

function vectorTone(type: string) {
  return TONES[type] || "orange";
}

function projectPoint(point: EmbeddingPoint, index: number, mode: CameraMode, camera: SpatialCamera) {
  const x = Math.max(-1, Math.min(1, point.x));
  const y = Math.max(-1, Math.min(1, point.y));
  const z = Math.max(-1, Math.min(1, point.z ?? Math.sin((index + 1) * 1.618) * 0.72));
  const base = mode === "front" ? { x, y, z } : mode === "top" ? { x, y: z, z: y } : { x, y, z };
  const yaw = (mode === "orbit" ? camera.yaw : 0) * (Math.PI / 180);
  const pitch = (mode === "orbit" ? camera.pitch : 0) * (Math.PI / 180);
  const yawed = {
    x: base.x * Math.cos(yaw) - base.z * Math.sin(yaw),
    y: base.y,
    z: base.x * Math.sin(yaw) + base.z * Math.cos(yaw),
  };
  return {
    x: yawed.x,
    y: yawed.y * Math.cos(pitch) - yawed.z * Math.sin(pitch),
    z: yawed.y * Math.sin(pitch) + yawed.z * Math.cos(pitch),
  };
}

function EmbeddingAtlas({ stats }: { stats: GraphStats }) {
  const [mode, setMode] = useState<CameraMode>("orbit");
  const [selectedId, setSelectedId] = useState<string>("");
  const [camera, setCamera] = useState<SpatialCamera>({ yaw: -38, pitch: 24, zoom: 1 });
  const embeddingStageRef = useRef<HTMLDivElement | null>(null);
  const embeddingPinchRef = useRef({ active: false, distance: 0, zoom: 1 });
  const points = (stats.embedding?.points || []).slice(0, 110);
  const selected = points.find(point => point.id === selectedId);
  const projected = points
    .map((point, index) => ({ point, projected: projectPoint(point, index, mode, camera) }))
    .sort((a, b) => a.projected.z - b.projected.z);
  const counts = points.reduce<Record<string, number>>((acc, point) => {
    acc[point.type] = (acc[point.type] || 0) + 1;
    return acc;
  }, {});
  const selectedProjected = selected ? projectPoint(selected, points.findIndex(point => point.id === selected.id), mode, camera) : null;
  const nearest = selected && selectedProjected
    ? points
        .filter(point => point.id !== selected.id)
        .map((point, index) => {
          const p = projectPoint(point, index, mode, camera);
          const distance = Math.sqrt((p.x - selectedProjected.x) ** 2 + (p.y - selectedProjected.y) ** 2 + (p.z - selectedProjected.z) ** 2);
          return { point, distance };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 6)
    : points.slice(0, 6).map(point => ({ point, distance: 0 }));
  const embeddingTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const [first, second] = [touches[0], touches[1]];
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
  };
  const rotateEmbedding = (deltaX: number, deltaY: number) => {
    if (mode !== "orbit") return;
    setCamera(value => ({
      ...value,
      yaw: normalizeAngle(value.yaw + deltaX * 0.28),
      pitch: normalizeAngle(value.pitch - deltaY * 0.22),
    }));
  };
  const handleEmbeddingWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey) {
      setCamera(value => ({ ...value, zoom: clamp(Number((value.zoom - event.deltaY * 0.0011).toFixed(2)), 0.65, 2.2) }));
      return;
    }
    rotateEmbedding(event.deltaX, event.deltaY);
  };
  const handleEmbeddingTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      event.stopPropagation();
      embeddingPinchRef.current = { active: true, distance: embeddingTouchDistance(event.touches), zoom: camera.zoom };
    }
  };
  const handleEmbeddingTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    const distance = embeddingTouchDistance(event.touches);
    const start = embeddingPinchRef.current.distance || distance || 1;
    if (embeddingPinchRef.current.active && Math.abs(distance - start) > 8) {
      setCamera(value => ({ ...value, zoom: clamp(Number((embeddingPinchRef.current.zoom * (distance / start)).toFixed(2)), 0.65, 2.2) }));
      return;
    }
    const first = event.touches[0];
    const second = event.touches[1];
    const midpointX = (first.clientX + second.clientX) / 2;
    const midpointY = (first.clientY + second.clientY) / 2;
    const previous = embeddingStageRef.current?.dataset;
    const lastX = Number(previous?.touchX || midpointX);
    const lastY = Number(previous?.touchY || midpointY);
    rotateEmbedding(midpointX - lastX, midpointY - lastY);
    if (previous) {
      previous.touchX = String(midpointX);
      previous.touchY = String(midpointY);
    }
  };
  const handleEmbeddingTouchEnd = () => {
    embeddingPinchRef.current.active = false;
    if (embeddingStageRef.current?.dataset) {
      delete embeddingStageRef.current.dataset.touchX;
      delete embeddingStageRef.current.dataset.touchY;
    }
  };

  return (
    <section className="card graph-embedding-atlas-card" aria-labelledby="embedding-atlas-title">
      <div className="graph-card-head graph-studio-head">
        <div>
          <span className="eyebrow">LanceDB embedding atlas</span>
          <h3 id="embedding-atlas-title">Vector space</h3>
          <p>Local vectors are projected with x/y/z depth, sized by distance, and colored by graph entity type.</p>
        </div>
        <div className="graph-head-pills">
          <span className="pill mono">{points.length} rows</span>
          <span className="pill mono">{mode}</span>
        </div>
      </div>
      <div className="graph-studio-toolbar">
        <div className="graph-filter-bar" aria-label="Embedding camera">
          {[
            ["orbit", "3D orbit"],
            ["front", "2D map"],
            ["top", "Depth map"],
          ].map(([id, label]) => (
            <button key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id as CameraMode)}>{label}</button>
          ))}
        </div>
        <div className="graph-zoom-controls" aria-label="Embedding zoom controls">
          <button onClick={() => setCamera(value => ({ ...value, zoom: clamp(Number((value.zoom - 0.15).toFixed(2)), 0.65, 2.2) }))}>-</button>
          <input
            aria-label="Embedding zoom"
            type="range"
            min="0.65"
            max="2.2"
            step="0.05"
            value={camera.zoom}
            onChange={event => setCamera(value => ({ ...value, zoom: Number(event.target.value) }))}
          />
          <button onClick={() => setCamera(value => ({ ...value, zoom: clamp(Number((value.zoom + 0.15).toFixed(2)), 0.65, 2.2) }))}>+</button>
          <button onClick={() => setCamera({ yaw: -38, pitch: 24, zoom: 1 })}>Reset</button>
          <span>{Math.round(camera.zoom * 100)}%</span>
        </div>
        {mode === "orbit" && (
          <div className="graph-rotation-controls" aria-label="3D rotation controls">
            <label>
              <span>Yaw</span>
              <input type="range" min="-180" max="180" step="2" value={camera.yaw} onChange={event => setCamera(value => ({ ...value, yaw: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Pitch</span>
              <input type="range" min="-180" max="180" step="2" value={camera.pitch} onChange={event => setCamera(value => ({ ...value, pitch: Number(event.target.value) }))} />
            </label>
          </div>
        )}
      </div>
      <div className="graph-studio-metrics" aria-label="Embedding summary">
        <div>
          <span>{points.length}</span>
          <small>vector rows</small>
        </div>
        <div>
          <span>{Object.keys(counts).length}</span>
          <small>entity groups</small>
        </div>
        <div>
          <span>{mode === "orbit" ? "3D" : "2D"}</span>
          <small>projection mode</small>
        </div>
        <div>
          <span>{selected ? truncate(selected.type, 10) : "none"}</span>
          <small>selected vector</small>
        </div>
      </div>
      <div className="graph-embedding-atlas-layout">
        <div
          ref={embeddingStageRef}
          className="graph-embedding-stage graph-embedding-stage-interactive"
          onWheel={handleEmbeddingWheel}
          onTouchStart={handleEmbeddingTouchStart}
          onTouchMove={handleEmbeddingTouchMove}
          onTouchEnd={handleEmbeddingTouchEnd}
          onTouchCancel={handleEmbeddingTouchEnd}
        >
          {points.length > 0 ? (
            <svg viewBox="0 0 920 520" className="graph-embedding-atlas-svg" role="img" aria-label="3D embedding vector projection">
              <defs>
                <radialGradient id="embeddingGlow">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
                  <stop offset="100%" stopColor="rgba(244,239,230,0.25)" />
                </radialGradient>
              </defs>
              <ellipse cx="460" cy="260" rx="330" ry="170" className="graph-embedding-orbit" />
              <line x1="130" y1="260" x2="790" y2="260" className="graph-embedding-axis" />
              <line x1="460" y1="84" x2="460" y2="436" className="graph-embedding-axis" />
              <circle cx="460" cy="260" r="112" className="graph-embedding-core" />
              {projected.map(({ point, projected: p }) => {
                const tone = vectorTone(point.type);
                const perspective = 1 + p.z * 0.18;
                const px = 460 + p.x * 310 * camera.zoom * perspective;
                const py = 260 + p.y * 170 * camera.zoom * perspective;
                const depth = (p.z + 1) / 2;
                const radius = (4.5 + depth * 7) * (0.82 + camera.zoom * 0.18);
                const active = point.id === selected?.id;
                return (
                  <g
                    key={`${point.type}-${point.id}`}
                    className={`graph-embedding-point ${active ? "active" : ""}`}
                    transform={`translate(${px},${py})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${point.type} vector ${point.label}`}
                    onClick={() => setSelectedId(active ? "" : point.id)}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(active ? "" : point.id);
                      }
                    }}
                  >
                    <circle r={radius + 7} fill={`var(--${tone}-soft)`} opacity={0.15 + depth * 0.25} />
                    <circle
                      r={radius}
                      fill={`var(--${tone})`}
                      stroke={`var(--${tone}-ink)`}
                      strokeWidth={active ? 2.6 : 1.4}
                    >
                      <title>{`${point.label} (${point.type})`}</title>
                    </circle>
                    {active && (
                      <>
                        <line x1={0} y1={0} x2="42" y2="-24" className="graph-embedding-callout-line" />
                        <rect x="42" y="-42" width="170" height="32" rx="9" className="graph-embedding-callout" />
                        <text x="54" y="-23" className="graph-atlas-label">{truncate(point.label, 22)}</text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="graph-vector-empty compact">
              <strong>No vector rows yet</strong>
              <span>Run profile ingestion or graph repair to populate LanceDB vectors.</span>
            </div>
          )}
        </div>
        <aside className="graph-studio-inspector">
          <div className="graph-board-subhead">
            <span className="eyebrow">Vector focus</span>
            <span className="pill mono">{Object.keys(counts).length} groups</span>
          </div>
          <h4>{selected ? selected.label : "Embedding atlas"}</h4>
          <p>{selected ? `${selected.type} vector row from LanceDB. Nearby points represent semantic proximity in the projected local embedding space.` : points.length ? "Select a point to inspect its semantic neighbors and vector group." : "No vectors are available yet."}</p>
          <div className="graph-mini-label">Nearest visible vectors</div>
          <div className="graph-node-pick-list compact">
            {nearest.map(({ point }) => (
              <button key={point.id} className="graph-node-pick" onClick={() => setSelectedId(point.id)}>
                <span>{truncate(point.label, 26)}</span>
                <small>{point.type}</small>
              </button>
            ))}
          </div>
          <div className="graph-mini-label">Groups</div>
          <div className="graph-legend stacked">
            {Object.entries(counts).map(([type, count]) => (
              <span key={type}><i className={`legend-dot ${type.toLowerCase()}`} /> {type}<b>{count}</b></span>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

export function GraphView({ stats }: { stats: GraphStats }) {
  const hasGraphPayload = Array.isArray(stats.graph?.nodes);
  const total = stats.graph?.nodes.length ?? 0;
  const relationCount = stats.graph?.edges.length ?? 0;
  const vectorCount = stats.embedding?.points.length ?? 0;
  const isLoading = Boolean(stats.loading && !stats.loaded);
  const requestError = stats.request_error || "";
  const isLive = stats.status === "live" && stats.available !== false && hasGraphPayload && !requestError;
  const syncedAt = stats.sync?.refreshed_at ? new Date(stats.sync.refreshed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="scroll graph-page">
      <div className="graph-shell graph-shell-single">
        <div className="card graph-overview graph-overview-sleek">
          <div className="graph-overview-copy">
            <span className="eyebrow">Knowledge Studio</span>
            <h1 style={{ fontSize: 34 }}>Knowledge Graph</h1>
            <p>Market-style graph exploration: clustered relations, focused neighborhoods, and real local embedding projections.</p>
          </div>
          <div className="graph-overview-stats">
            <div>
              <span className="eyebrow">Total nodes</span>
              <div className="display tabular graph-total">{total}</div>
            </div>
            <div className="graph-mini-stats">
              <div><span>{relationCount}</span><small>Relations</small></div>
              <div><span>{vectorCount}</span><small>Vectors</small></div>
            </div>
            <span
              className="pill mono"
              title={!hasGraphPayload ? "Backend response is missing graph nodes and edges" : (stats.error || (syncedAt ? `Synced at ${syncedAt}` : "Graph status"))}
              style={{
                justifySelf: "end",
                background: isLive ? "var(--green-soft)" : "var(--bad-soft)",
                color: isLive ? "var(--green-ink)" : "var(--bad)",
                border: `1px solid ${isLive ? "var(--green)" : "var(--bad)"}`,
              }}
            >
              {isLive ? "live" : isLoading ? "loading" : requestError ? "request failed" : hasGraphPayload ? "degraded" : "no graph payload"}
            </span>
          </div>
        </div>

        {!isLive && !isLoading && (
          <div className="card" style={{ color: "var(--bad)", background: "var(--bad-soft)", borderColor: "var(--bad)", padding: 14 }}>
            {requestError
              ? requestError
              : !hasGraphPayload
                ? "The graph endpoint returned a response without nodes or edges. Open Activity for the backend error, or restart the Tauri dev app if the backend was changed while it was running."
              : stats.error?.toLowerCase().includes("locked by another justhireme")
                ? stats.error
                : `Graph store is unavailable: ${stats.error || "unknown error"}`}
          </div>
        )}

        <KnowledgeRelationAtlas stats={stats} />
        <EmbeddingAtlas stats={stats} />
      </div>
    </div>
  );
}
