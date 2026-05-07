// ===========================================================================
// DeltaForm Check v2 — js-aruco2 기반
// ===========================================================================

let libsReady = false;

window.addEventListener("load", () => {
  // js-aruco2 라이브러리 + 사전 데이터 로드 확인
  if (typeof AR === "undefined" || typeof CV === "undefined") {
    showLibError();
    return;
  }
  if (!window.OPENCV_DICTS) {
    showLibError("aruco_dicts_data.js 가 로드되지 않았습니다.");
    return;
  }

  // OpenCV 사전 데이터를 js-aruco2 형식으로 등록
  for (const [name, data] of Object.entries(window.OPENCV_DICTS)) {
    AR.DICTIONARIES[name] = {
      nBits: data.nBits,
      tau: data.tau,
      codeList: data.codeList,
    };
  }
  console.log("Loaded dictionaries:", Object.keys(AR.DICTIONARIES));

  libsReady = true;
});

function showLibError(msg) {
  const home = document.getElementById("screen-home");
  const banner = document.createElement("div");
  banner.className = "lib-error";
  banner.innerHTML = `
    <strong>⚠️ js-aruco2 라이브러리 누락</strong>
    <p>${msg || "cv.js 또는 aruco.js 파일이 폴더에 없습니다."}</p>
    <p>아래 두 파일을 받아 같은 폴더에 두세요:</p>
    <ul>
      <li><code>https://raw.githubusercontent.com/damianofalcioni/js-aruco2/master/src/cv.js</code></li>
      <li><code>https://raw.githubusercontent.com/damianofalcioni/js-aruco2/master/src/aruco.js</code></li>
    </ul>
    <p>각 URL을 PC 브라우저에서 열고 우클릭 → 다른 이름으로 저장. 파일명은
       <code>cv.js</code>, <code>aruco.js</code> 그대로.</p>
  `;
  home.insertBefore(banner, home.firstChild);
}

// ===========================================================================
// 화면 전환
// ===========================================================================
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`screen-${name}`).classList.add("active");
  window.scrollTo(0, 0);
}

// ===========================================================================
// 파일 입력 핸들러
// ===========================================================================
document.getElementById("btn-camera").addEventListener("click", () => {
  document.getElementById("file-input").click();
});
document.getElementById("btn-camera-again").addEventListener("click", () => {
  document.getElementById("file-input").click();
});
document.getElementById("btn-gallery").addEventListener("click", () => {
  document.getElementById("file-input-gallery").click();
});
document.getElementById("btn-back").addEventListener("click", () => {
  showScreen("home");
});

document.getElementById("file-input").addEventListener("change", handleFile);
document.getElementById("file-input-gallery").addEventListener("change", handleFile);

async function handleFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;

  if (!libsReady) {
    alert("js-aruco2 라이브러리가 로드되지 않았습니다. cv.js, aruco.js, aruco_dicts_data.js가 폴더에 있는지 확인하세요.");
    return;
  }

  document.getElementById("processing").classList.remove("hidden");
  document.getElementById("processing-msg").textContent = "사진 로드 중...";

  setTimeout(async () => {
    try {
      document.getElementById("processing-msg").textContent = "마커 검사 중...";
      const img = await loadImage(file);
      const result = await checkImage(img, file.name);
      renderResult(result);
      showScreen("result");
    } catch (e) {
      console.error(e);
      alert("처리 실패: " + (e.message || e));
    } finally {
      document.getElementById("processing").classList.add("hidden");
    }
  }, 50);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}

// ===========================================================================
// 검사 메인
// ===========================================================================
async function checkImage(htmlImage, filename) {
  const dictName = document.getElementById("dict-select").value;
  const expectedIdsRaw = document.getElementById("expected-ids").value.trim();
  const expectedCount = parseInt(document.getElementById("expected-count").value) || 0;
  const hammingMode = document.getElementById("hamming-mode").value;

  let allowedIds = null;
  if (expectedIdsRaw) {
    allowedIds = new Set(
      expectedIdsRaw.split(",").map(x => parseInt(x.trim())).filter(x => !isNaN(x))
    );
    if (allowedIds.size === 0) allowedIds = null;
  }

  // 너무 큰 사진은 다운스케일 (모바일 성능 + 검출 안정성)
  const W = htmlImage.naturalWidth;
  const H = htmlImage.naturalHeight;
  const longSide = Math.max(W, H);
  const targetSize = 1600; // 처리용 목표 크기
  const scale = longSide > targetSize ? targetSize / longSide : 1.0;
  const procW = Math.round(W * scale);
  const procH = Math.round(H * scale);

  const canvas = document.createElement("canvas");
  canvas.width = procW;
  canvas.height = procH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(htmlImage, 0, 0, procW, procH);
  const imageData = ctx.getImageData(0, 0, procW, procH);

  // hamming distance 모드별 옵션
  const hammingOpts = {
    strict:  { tauMul: 0.7 },  // tau 70%로 줄여 false positive ↓
    default: { tauMul: 1.0 },
    relaxed: { tauMul: 1.4 },  // tau 140%로 늘려 작은/흐린 마커도 시도
  };
  const opt = hammingOpts[hammingMode];

  // 1차 시도: 지정 사전
  let { detected, usedDict } = tryDetect(imageData, dictName, opt.tauMul, allowedIds);

  // 2차 시도: 지정 사전으로 못 찾으면 다른 사전 시도 (사전 미스매치 진단)
  let dictMismatchHint = null;
  if (detected.length === 0) {
    for (const altDict of Object.keys(window.OPENCV_DICTS)) {
      if (altDict === dictName) continue;
      const r = tryDetect(imageData, altDict, opt.tauMul, null);
      if (r.detected.length > 0) {
        dictMismatchHint = altDict;
        detected = r.detected;
        usedDict = altDict;
        break;
      }
    }
  }

  // 마커 좌표를 원본 해상도 기준으로 환원
  if (scale !== 1.0) {
    for (const m of detected) {
      for (const c of m.corners) {
        c.x = c.x / scale;
        c.y = c.y / scale;
      }
    }
  }

  // 마커별 품질 분석
  const grayFull = makeGrayCanvas(htmlImage);
  const markers = detected.map(m => {
    const mc = analyzeMarker(m.corners, grayFull, W);
    mc.id = m.id;
    evaluateMarker(mc, W);
    return mc;
  });

  // 시각화 캔버스 (원본 해상도 기준)
  const visCanvas = document.createElement("canvas");
  visCanvas.width = W;
  visCanvas.height = H;
  const vctx = visCanvas.getContext("2d");
  vctx.drawImage(htmlImage, 0, 0);
  drawDetectionOverlay(vctx, markers);

  // 종합 이슈
  const issues = [];
  if (detected.length === 0) {
    issues.push({
      severity: "fail", code: "no_detection",
      message: "어떤 사전으로도 마커가 검출되지 않습니다",
      fix: "마커가 사진에 잘 보이는지 / 너무 작거나 흐리지 않은지 확인. " +
           "더 가까이서, 더 정면에서, 더 밝은 환경에서 다시 촬영하세요. " +
           "또는 '관대' 모드로 재시도.",
    });
  } else if (dictMismatchHint) {
    issues.push({
      severity: "fail", code: "dict_mismatch",
      message: `지정 사전 '${dictName}'으로는 검출 실패. '${dictMismatchHint}'로는 검출됨`,
      fix: `상단 '사전' 선택을 '${dictMismatchHint}'로 변경하세요.`,
    });
  }

  if (expectedCount > 0 && markers.length < expectedCount) {
    const missing = expectedCount - markers.length;
    issues.push({
      severity: "warn", code: "marker_count_low",
      message: `예상보다 마커가 적게 보임 (${markers.length}/${expectedCount}, ${missing}개 누락)`,
      fix: "다른 마커가 가려졌거나 시야 밖. 다양한 각도에서 추가 촬영 권장.",
    });
  }

  // 등급 결정
  let failCount = 0, warnCount = 0;
  const collect = (xs) => {
    for (const i of xs) {
      if (i.severity === "fail") failCount++;
      else if (i.severity === "warn") warnCount++;
    }
  };
  collect(issues);
  for (const m of markers) collect(m.issues);

  let overall, summary;
  if (failCount > 0) {
    overall = "fail";
    summary = `❌ 사용 부적합 — 마커 ${markers.length}개 검출, 치명적 문제 ${failCount}개`;
  } else if (warnCount > 0) {
    overall = "warn";
    summary = `⚠️ 조건부 사용 가능 — 마커 ${markers.length}개 검출, 경고 ${warnCount}개`;
  } else if (markers.length > 0) {
    overall = "ok";
    summary = `✅ 사용 가능 — 마커 ${markers.length}개 모두 양호`;
  } else {
    overall = "fail";
    summary = `❌ 마커 검출 실패`;
  }

  return {
    filename,
    width: W,
    height: H,
    requestedDict: dictName,
    detectedDict: markers.length > 0 ? usedDict : null,
    markers,
    issues,
    overall,
    summary,
    visCanvas,
  };
}


// ===========================================================================
// js-aruco2 검출 호출
// ===========================================================================
function tryDetect(imageData, dictName, tauMul, allowedIds) {
  const dict = AR.DICTIONARIES[dictName];
  if (!dict) {
    console.warn("Unknown dictionary:", dictName);
    return { detected: [], usedDict: dictName };
  }

  // tau 조정 (관대/엄격 모드)
  const origTau = dict.tau;
  let usedTau = Math.max(0, Math.round(origTau * tauMul));

  let detector;
  try {
    detector = new AR.Detector({
      dictionaryName: dictName,
      maxHammingDistance: usedTau,
    });
  } catch (e) {
    console.warn("Detector init failed:", e);
    return { detected: [], usedDict: dictName };
  }

  let markers;
  try {
    markers = detector.detect(imageData);
  } catch (e) {
    console.warn("Detection error:", e);
    return { detected: [], usedDict: dictName };
  }

  // ID 필터링
  let filtered = markers || [];
  if (allowedIds) {
    filtered = filtered.filter(m => allowedIds.has(m.id));
  }

  return { detected: filtered, usedDict: dictName };
}


// ===========================================================================
// 회색 ImageData 캔버스 (품질 분석용)
// ===========================================================================
function makeGrayCanvas(htmlImage) {
  const canvas = document.createElement("canvas");
  canvas.width = htmlImage.naturalWidth;
  canvas.height = htmlImage.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(htmlImage, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// gray 값 추출 (RGBA → 단순 평균)
function getGrayAt(imgData, x, y) {
  const i = (Math.round(y) * imgData.width + Math.round(x)) * 4;
  return (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
}


// ===========================================================================
// 마커 품질 분석
// ===========================================================================
function analyzeMarker(corners, grayImg, imageWidth) {
  // corners = [{x,y}, {x,y}, {x,y}, {x,y}]
  const sides = [];
  for (let i = 0; i < 4; i++) {
    const c1 = corners[i];
    const c2 = corners[(i+1) % 4];
    sides.push(Math.hypot(c2.x - c1.x, c2.y - c1.y));
  }
  const sideAvg = (sides[0] + sides[1] + sides[2] + sides[3]) / 4;
  const sideMin = Math.min(...sides);
  const sideMax = Math.max(...sides);
  const aspectRatio = sideMin > 0 ? sideMax / sideMin : Infinity;

  // 대각선 비 → 각도 추정
  const d1 = Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y);
  const d2 = Math.hypot(corners[3].x - corners[1].x, corners[3].y - corners[1].y);
  const dMin = Math.min(d1, d2), dMax = Math.max(d1, d2);
  const diagRatio = dMin > 0 ? dMax / dMin : Infinity;
  const angleDeg = isFinite(diagRatio)
    ? Math.acos(Math.min(1.0, 1.0 / diagRatio)) * (180 / Math.PI) * 1.5
    : 90;

  // ROI 노출 분석 — 단순 grid sampling (전체 ROI 픽셀 순회는 모바일에서 느림)
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const xMin = Math.max(0, Math.floor(Math.min(...xs)));
  const yMin = Math.max(0, Math.floor(Math.min(...ys)));
  const xMax = Math.min(grayImg.width, Math.ceil(Math.max(...xs)));
  const yMax = Math.min(grayImg.height, Math.ceil(Math.max(...ys)));
  const w = xMax - xMin, h = yMax - yMin;

  let brightClipPct = 0;
  let darkLiftPct = 0;

  if (w > 4 && h > 4) {
    // 32x32 그리드 샘플링
    const gridSize = 32;
    const stepX = w / gridSize;
    const stepY = h / gridSize;
    const samples = [];
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const x = xMin + (i + 0.5) * stepX;
        const y = yMin + (j + 0.5) * stepY;
        samples.push(getGrayAt(grayImg, x, y));
      }
    }
    // Otsu-like binary threshold (간단 mid-point)
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    let whiteN = 0, whiteClip = 0;
    let blackN = 0, blackLift = 0;
    for (const v of samples) {
      if (v > mean) {
        whiteN++;
        if (v >= 250) whiteClip++;
      } else {
        blackN++;
        if (v >= 120) blackLift++;
      }
    }
    brightClipPct = whiteN > 0 ? (whiteClip / whiteN) * 100 : 0;
    darkLiftPct = blackN > 0 ? (blackLift / blackN) * 100 : 0;
  }

  return {
    id: -1,
    corners: corners,
    sidePx: sideAvg,
    sidePctOfImage: (sideAvg / imageWidth) * 100,
    aspectRatio: aspectRatio,
    angleDeg: angleDeg,
    brightClipPct: brightClipPct,
    darkLiftPct: darkLiftPct,
    issues: [],
  };
}


// ===========================================================================
// 마커 평가
// ===========================================================================
function evaluateMarker(m, imageWidth) {
  if (m.sidePx < 50) {
    m.issues.push({
      severity: "fail", code: "size_too_small",
      message: `마커가 너무 작음 (${Math.round(m.sidePx)}px)`,
      fix: "약 50% 더 가까이 다가가서 다시 촬영. 검출 한계 50px, 권장 100px 이상.",
    });
  } else if (m.sidePx < 80) {
    m.issues.push({
      severity: "warn", code: "size_small",
      message: `마커가 작은 편 (${Math.round(m.sidePx)}px). 검출이 불안정할 수 있음`,
      fix: "약 20~30% 더 가까이서 촬영 권장 (목표 100px+).",
    });
  } else {
    m.issues.push({
      severity: "ok", code: "size_ok",
      message: `크기 양호 (${Math.round(m.sidePx)}px, 사진 가로 ${m.sidePctOfImage.toFixed(1)}%)`,
    });
  }

  if (m.aspectRatio > 1.6) {
    m.issues.push({
      severity: "fail", code: "aspect_distorted",
      message: `심하게 변형 (변 비율 ${m.aspectRatio.toFixed(2)})`,
      fix: "마커 받침대 휘어짐 의심. 두꺼운 평면 받침대 + 단단히 부착.",
    });
  } else if (m.aspectRatio > 1.3) {
    m.issues.push({
      severity: "warn", code: "aspect_warn",
      message: `살짝 변형 (변 비율 ${m.aspectRatio.toFixed(2)})`,
      fix: "받침대 평면 확인. 또는 매우 비스듬한 각도에서 촬영됨.",
    });
  }

  if (m.angleDeg > 50) {
    m.issues.push({
      severity: "warn", code: "angle_oblique",
      message: `매우 비스듬 (~${Math.round(m.angleDeg)}°)`,
      fix: "각 마커가 한 번씩은 정면에 가깝게 보이도록 다양한 각도로 촬영.",
    });
  }

  if (m.brightClipPct > 25) {
    m.issues.push({
      severity: "fail", code: "overexposed",
      message: `심한 빛 반사 — 흰 영역 ${Math.round(m.brightClipPct)}% 클리핑`,
      fix: "직사광/플래시 반사. 광원 위치 변경, 무광 인쇄지, 노출 -1 EV.",
    });
  } else if (m.brightClipPct > 10) {
    m.issues.push({
      severity: "warn", code: "bright_warn",
      message: `약간의 빛 반사 (${Math.round(m.brightClipPct)}% 클리핑)`,
      fix: "조명 각도 살짝 조정 권장.",
    });
  }

  if (m.darkLiftPct > 30) {
    m.issues.push({
      severity: "warn", code: "underexposed",
      message: `어두움/역광 — 검은 영역 ${Math.round(m.darkLiftPct)}%가 충분히 검지 않음`,
      fix: "조명 추가 또는 노출 +1 EV. 역광이라면 광원이 뒤에 있는지 확인.",
    });
  }
}


// ===========================================================================
// 시각화 — 캔버스 컨텍스트 위에 직접 그림
// ===========================================================================
function drawDetectionOverlay(ctx, markers) {
  for (const m of markers) {
    const hasFail = m.issues.some(x => x.severity === "fail");
    const hasWarn = m.issues.some(x => x.severity === "warn");
    const color = hasFail ? "#ff4646" : hasWarn ? "#f0be46" : "#50dc64";

    // 4변 그리기
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, ctx.canvas.width / 600);
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(m.corners[0].x, m.corners[0].y);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(m.corners[i].x, m.corners[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    // ID 라벨
    const cx = (m.corners[0].x + m.corners[1].x + m.corners[2].x + m.corners[3].x) / 4;
    const cy = (m.corners[0].y + m.corners[1].y + m.corners[2].y + m.corners[3].y) / 4;
    const fontSize = Math.max(20, ctx.canvas.width / 60);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const text = `ID:${m.id}`;
    const metrics = ctx.measureText(text);
    const tw = metrics.width + 14;
    const th = fontSize * 1.3;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(cx - tw/2, cy - th/2, tw, th);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy);
  }
}


// ===========================================================================
// 결과 렌더링
// ===========================================================================
function renderResult(result) {
  document.getElementById("result-filename").textContent = result.filename;

  const banner = document.getElementById("result-overall");
  banner.className = `overall-banner ${result.overall}`;
  banner.textContent = result.summary;

  // 캔버스에 시각화 복사 — 너무 크면 다운스케일해서 표시
  const dispCanvas = document.getElementById("result-canvas");
  const maxDisp = 1200;
  const ratio = result.visCanvas.width > maxDisp
    ? maxDisp / result.visCanvas.width : 1;
  dispCanvas.width = Math.round(result.visCanvas.width * ratio);
  dispCanvas.height = Math.round(result.visCanvas.height * ratio);
  const dctx = dispCanvas.getContext("2d");
  dctx.drawImage(result.visCanvas, 0, 0, dispCanvas.width, dispCanvas.height);

  // 종합
  const summaryDiv = document.getElementById("result-summary");
  let summaryHtml = `<h2>📊 종합</h2>`;
  summaryHtml += `<div class="muted small">크기: ${result.width}×${result.height} · ` +
                  `사전: ${result.detectedDict || "(검출 실패)"}</div>`;
  if (result.issues.length > 0) {
    summaryHtml += result.issues.map(formatIssue).join("");
  } else {
    summaryHtml += `<div class="issue ok"><span class="icon">✅</span>` +
                    `<div>모든 검사 통과</div></div>`;
  }
  summaryDiv.innerHTML = summaryHtml;

  // 마커별 카드
  const markersDiv = document.getElementById("result-markers");
  if (result.markers.length === 0) {
    markersDiv.innerHTML = "";
  } else {
    markersDiv.innerHTML = result.markers.map(formatMarkerCard).join("");
  }
}

function formatIssue(issue) {
  const icon = issue.severity === "ok" ? "✅" :
                issue.severity === "warn" ? "⚠️" : "❌";
  let html = `<div class="issue ${issue.severity}">`;
  html += `<span class="icon">${icon}</span><div>${escapeHtml(issue.message)}`;
  if (issue.fix) {
    html += `<span class="fix">→ ${escapeHtml(issue.fix)}</span>`;
  }
  html += `</div></div>`;
  return html;
}

function formatMarkerCard(m) {
  const grade = m.issues.some(x => x.severity === "fail") ? "fail" :
                m.issues.some(x => x.severity === "warn") ? "warn" : "ok";
  const gradeIcon = grade === "ok" ? "✅" : grade === "warn" ? "⚠️" : "❌";
  const gradeLabel = grade === "ok" ? "양호" : grade === "warn" ? "경고" : "부적합";

  let html = `<div class="marker-card">`;
  html += `<div class="header">`;
  html += `<span class="id-label">마커 ID: ${m.id}</span>`;
  html += `<span class="badge ${grade}">${gradeIcon} ${gradeLabel}</span>`;
  html += `</div>`;
  html += `<div class="stats">`;
  html += `${Math.round(m.sidePx)}px (${m.sidePctOfImage.toFixed(1)}%) · `;
  html += `변 비율 ${m.aspectRatio.toFixed(2)} · `;
  html += `각도 ~${Math.round(m.angleDeg)}°`;
  html += `</div>`;
  for (const issue of m.issues) {
    html += formatIssue(issue);
  }
  html += `</div>`;
  return html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
