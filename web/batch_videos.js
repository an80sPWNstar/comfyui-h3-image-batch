import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv)$/i;

function isVideoEntry(entry, animated) {
  const filename = entry?.filename ?? "";
  const extOk = VIDEO_EXT_RE.test(filename);
  if (animated !== undefined) {
    return animated && extOk;
  }
  const format = entry?.format ?? "";
  if (format.startsWith("video/")) return true;
  return extOk;
}

function buildClipList(message) {
  const clips = [];
  if (!message) return clips;

  if (Array.isArray(message.images)) {
    const animatedArr = Array.isArray(message.animated) ? message.animated : [];
    message.images.forEach((entry, i) => {
      const animated = animatedArr[i] ?? false;
      if (isVideoEntry(entry, animated)) {
        clips.push({
          filename: entry.filename,
          subfolder: entry.subfolder,
          type: entry.type,
        });
      }
    });
  }

  if (Array.isArray(message.gifs)) {
    message.gifs.forEach((entry) => {
      if (isVideoEntry(entry, undefined)) {
        clips.push({
          filename: entry.filename,
          subfolder: entry.subfolder,
          type: entry.type,
        });
      }
    });
  }

  return clips;
}

function clipUrl(clip, t) {
  const params = new URLSearchParams({
    filename: clip.filename,
    subfolder: clip.subfolder ?? "",
    type: clip.type ?? "output",
  });
  return api.apiURL("/view?" + params.toString() + "&t=" + t);
}

function ensureWidget(node) {
  if (node.__h3AllClips) return node.__h3AllClips;

  const root = document.createElement("div");
  root.style.boxSizing = "border-box";
  root.style.width = "100%";
  root.style.padding = "4px";
  root.style.font = "12px sans-serif";
  root.style.color = "var(--input-text, #ddd)";
  root.style.display = "none";

  const widget = node.addDOMWidget("h3_all_clips", "h3_all_clips", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => {
      const h = root.scrollHeight;
      return h > 0 ? h : 0;
    },
  });

  node.__h3AllClips = { widget, root };

  // The stock preview widget is rebuilt after outputs change; re-hide it on draw.
  const origDraw = node.onDrawForeground;
  node.onDrawForeground = function () {
    const r = origDraw?.apply(this, arguments);
    if (root.style.display !== "none" && setStockPreviewHidden(node, true)) {
      resizeNode(node);
    }
    return r;
  };
  return node.__h3AllClips;
}

function setStockPreviewHidden(node, hidden) {
  try {
    const w = node.widgets?.find(x => x.name === "video-preview");
    if (!w) return;

    if (hidden) {
      if (w.__h3OrigLayout !== undefined) return false;
      w.__h3OrigLayout = w.computeLayoutSize ?? null;
      w.computeLayoutSize = () => ({ minHeight: 0, minWidth: 0 });
      if (w.element) {
        w.element.style.display = "none";
      }
      return true;
    } else {
      if (w.__h3OrigLayout !== undefined) {
        w.computeLayoutSize = w.__h3OrigLayout ?? undefined;
        delete w.__h3OrigLayout;
      }
      if (w.element) {
        w.element.style.display = "";
      }
    }
  } catch (e) {
    // ignore
  }
}

function resizeNode(node) {
  try {
    node.setSize([node.size[0], node.computeSize()[1]]);
    node.setDirtyCanvas(true, true);
  } catch (e) {
    // ignore
  }
}

function showClips(node, message) {
  try {
    const clips = buildClipList(message);

    if (clips.length < 2) {
      // We never attached a widget to this node: leave its size and preview alone.
      if (!node.__h3AllClips) return;

      const { root } = node.__h3AllClips;
      root.replaceChildren();
      root.style.display = "none";
      setStockPreviewHidden(node, false);
      resizeNode(node);
      return;
    }

    const { root } = ensureWidget(node);
    root.style.display = "";
    root.replaceChildren();
    setStockPreviewHidden(node, true);

    const header = document.createElement("div");
    header.textContent = `All ${clips.length} clips from this run`;
    root.appendChild(header);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${Math.min(clips.length, 2)}, 1fr)`;
    grid.style.gap = "6px";
    root.appendChild(grid);

    const t = Date.now();

    clips.forEach((clip, i) => {
      const cell = document.createElement("div");
      cell.style.background = "rgba(0,0,0,0.25)";
      cell.style.borderRadius = "4px";
      cell.style.padding = "4px";

      const label = document.createElement("div");
      label.textContent = `Clip ${i + 1} of ${clips.length}`;
      label.style.cursor = "pointer";
      label.addEventListener("click", () => {
        const url = clipUrl(clip, t);
        window.open(url, "_blank");
      });
      cell.appendChild(label);

      const filenameLine = document.createElement("div");
      filenameLine.textContent = clip.filename;
      filenameLine.style.fontSize = "10px";
      filenameLine.style.opacity = "0.7";
      filenameLine.style.whiteSpace = "nowrap";
      filenameLine.style.overflow = "hidden";
      filenameLine.style.textOverflow = "ellipsis";
      cell.appendChild(filenameLine);

      const video = document.createElement("video");
      video.controls = true;
      video.loop = true;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.style.width = "100%";
      video.style.display = "block";
      video.src = clipUrl(clip, t);

      video.addEventListener("loadedmetadata", () => {
        setStockPreviewHidden(node, true);
        resizeNode(node);
      });

      video.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });

      cell.appendChild(video);
      grid.appendChild(cell);
    });

    [300, 1000, 2500].forEach(ms => setTimeout(() => {
      if (node.__h3AllClips?.root.style.display !== "none") {
        setStockPreviewHidden(node, true);
        resizeNode(node);
      }
    }, ms));

    resizeNode(node);
  } catch (err) {
    console.warn("[h3-batch] all-clips preview:", err);
  }
}

app.registerExtension({
  name: "MiniMax.H3Batch.AllClips",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData.output_node) return;

    const orig = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      orig?.apply(this, arguments);
      showClips(this, message);
    };
  },
});
