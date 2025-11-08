/******************************************************
 sketch.js
 - Mappa con punti (dal CSV)
 - Header top-left: titolo + legenda (min/mid/max)
 - Footer fisso in basso (6 box) aggiornabile al click
 - Tooltip su hover (nome breve)
 - Punto selezionato pulsa
 - Mappa mantiene aspect-ratio, mappa più piccola, punti leggermente più grandi
******************************************************/

/* ---------------- CONFIG ---------------- */
const csvFile = "volcanoes-2025-10-27 - Es.3 - Original Data.csv";
const mapImageFile = "world.svg"; // mappa locale (SVG/PNG)
const footerHeight = 140;         // altezza del footer fisso
const headerHeight = 110;         // spazio riservato per header (utile per posizionamento mappa)
const paddingFrac = 0.06;         // padding percentuale attorno alla mappa nel canvas
const dotBaseSize = 9;            // base dot size (più grande come richiesto)
const hoverRadiusFactor = 1.4;    // moltiplica il dot size per il raggio di hover

// palette (arancione tenue -> fucsia)
const colorLow  = [255, 171,  64]; // low
const colorHigh = [214,  51, 132]; // high

/* possibili header CSV (ricerca intelligente) */
const latCandidates = ["Latitude", "Lat", "latitude", "lat"];
const lonCandidates = ["Longitude", "Lon", "longitude", "lon"];
const elevCandidates = ["Elevation", "Elevation (m)", "elevation", "Elev", "elev", "Height"];
const nameCandidates = ["Volcano Name", "Volcano", "Name", "volcano name"];
const countryCandidates = ["Country", "country"];
const locationCandidates = ["Location", "location"];
const typeCandidates = ["Type", "type"];
const typeCatCandidates = ["TypeCategory", "Type Category", "Type_Category", "typecategory"];
const statusCandidates = ["Status", "status"];
const eruptionCandidates = ["Last Known Eruption", "Last Known Eruption (Year)", "Last Known Eruption Year", "Last Known Eruption (year)", "Last Eruption", "Last Known", "Last known eruption"];

/* ---------------- GLOBALI ---------------- */
let table = null;
let mapImg = null;
let points = []; // {lat,lon,elev,x,y,fields}
let minElev = Infinity, maxElev = -Infinity;

let imgX = 0, imgY = 0, imgW = 0, imgH = 0, imgAspect = 2;

let footerEl = null;
let footerBoxes = {};

let selectedPoint = null; // punto selezionato con click
let hoverPoint = null;    // punto sotto il mouse (hover)
let tooltipEl = null;

/* ---------------- INI: inietto CSS + DOM header + tooltip + footer (footer creato anche se esiste) ---------------- */
(function setupDOMandStyles() {
  // inietta Google font + stili per header, tooltip, footer
  const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

  body { font-family: 'Inter', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; margin:0; padding:0; }

  /* Header */
  #vw-header {
    position: fixed;
    left: 18px;
    top: 12px;
    z-index: 2000;
    background: rgba(255,255,255,0.9);
    padding: 12px 14px;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.08);
    max-width: 420px;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(0,0,0,0.04);
  }
  #vw-header h1 {
    margin:0 0 6px 0;
    font-size:18px;
    letter-spacing:0.06em;
    text-transform:uppercase;
  }
  #vw-header p.desc {
    margin:0;
    font-size:13px;
    color:#4b4b4b;
    line-height:1.3;
    max-width:420px;
  }

  /* Legend */
  .vw-legend { margin-top:10px; display:flex; gap:12px; align-items:center; }
  .vw-legend .bar {
    width:170px; height:12px; border-radius:8px;
    background: linear-gradient(90deg, rgb(${colorLow[0]},${colorLow[1]},${colorLow[2]}), rgb(${colorHigh[0]},${colorHigh[1]},${colorHigh[2]}));
    border: 1px solid rgba(0,0,0,0.04);
  }
  .vw-legend .ticks { display:flex; justify-content:space-between; font-size:12px; color:#444; width:170px; }
  .vw-legend .label { font-size:12px; color:#666; }

  /* Tooltip */ 
  #vw-tooltip {
    position: fixed;
    z-index: 3000;
    pointer-events: none;
    background: rgba(0,0,0,0.78);
    color: #fff;
    padding:6px 8px;
    font-size:13px;
    border-radius:6px;
    transform: translate(-50%, -120%);
    white-space:nowrap;
  }

  /* Footer will be created by JS: style kept compatible with previous version */
  `;

  const style = document.createElement('style');
  style.id = 'vw-styles';
  style.innerHTML = css;
  document.head.appendChild(style);

  // create header DOM
  const existingHeader = document.getElementById('vw-header');
  if (existingHeader) existingHeader.remove();
  const header = document.createElement('div');
  header.id = 'vw-header';
  header.innerHTML = `
    <h1>Volcanoes World Map</h1>
    <p class="desc">Interactive overview of volcanoes from the dataset.<br>Color encodes elevation (m).<br><i>Click to show full details in the footer.</i></p>
    <div class="vw-legend" aria-hidden="true">
      <div style="display:flex;flex-direction:column;align-items:flex-start;">
        <div class="ticks" id="legendTicks">
          <span id="minTick">min</span>
          <span id="midTick">mid</span>
          <span id="maxTick">max</span>
        </div>
        <div class="bar" id="legendBar"></div>
      </div>
    </div>
  `;
  document.body.appendChild(header);

  // tooltip DOM
  const existingTooltip = document.getElementById('vw-tooltip');
  if (existingTooltip) existingTooltip.remove();
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'vw-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);

  // create footer UI via function (keeps previous style/behavior)
  // we call the footer creation later in setup() so that footerHeight variable is consistent
})();

/* ---------------- p5 preload: carico CSV e mappa ---------------- */
function preload() {
  table = loadTable(csvFile, "csv", "header",
    () => console.log("CSV loaded:", csvFile),
    (err) => console.error("CSV load error:", err)
  );
  mapImg = loadImage(mapImageFile,
    () => console.log("Map image loaded:", mapImageFile),
    (err) => { console.warn("Map load failed (fallback):", err); mapImg = null; }
  );
}

/* ---------------- p5 setup ---------------- */
function setup() {
  // create footer (so we know its height) and then canvas that doesn't overlap footer
  createFooterUI(); // creates footer and its styles

  // canvas height: viewport - footerHeight (so footer never overlaps)
  const canvasH = max(220, windowHeight - footerHeight - 8);
  const cnv = createCanvas(windowWidth, canvasH);
  cnv.style('display', 'block');
  cnv.style('position', 'relative');

  noStroke();

  // parse CSV
  if (table && table.getRowCount() > 0) {
    preparePointsFromTable();
    // update legend ticks in header
    updateLegendTicks();
  } else {
    console.warn("CSV missing or empty.");
  }

  // compute placement and coords
  computeImagePlacement();
  updatePointsXY();
}

/* ---------------- p5 draw ---------------- */
function draw() {
  clear();
  background(250);

  // draw map centered keeping aspect ratio
  if (mapImg) {
    image(mapImg, imgX, imgY, imgW, imgH);
  } else {
    drawFallbackMap();
  }

  // draw points
  const sizeScale = max(0.8, min(width, height) / 900); // slightly bigger points
  const dotSize = dotBaseSize * sizeScale;
  const t = millis() / 1000;

  hoverPoint = null;
  // first check hover to show tooltip (we'll loop anyway)
  for (let p of points) {
    const d = dist(mouseX, mouseY, p.x, p.y);
    if (d <= dotSize * hoverRadiusFactor) {
      hoverPoint = p;
      break;
    }
  }

  for (let p of points) {
    const col = colorFromElevation(p.elev);
    // if selected, pulse
    if (selectedPoint === p) {
      // pulsazione: scale tra 1.0 e 1.35
      const pulse = 1 + 0.22 * (0.5 + 0.5 * Math.sin(t * 6)); // frequency 6 rad/s
      fill(col[0], col[1], col[2]);
      ellipse(p.x, p.y, dotSize * pulse, dotSize * pulse);
      // optional white ring highlight
      noFill();
      stroke(255, 180);
      strokeWeight(1.5);
      ellipse(p.x, p.y, dotSize * pulse + 6, dotSize * pulse + 6);
      noStroke();
    } else {
      fill(col[0], col[1], col[2]);
      ellipse(p.x, p.y, dotSize, dotSize);
    }

    // draw subtle border for readability
    noFill();
    stroke(255, 0.12 * 255);
    strokeWeight(0.6);
    ellipse(p.x, p.y, dotSize + 0.8, dotSize + 0.8);
    noStroke();
  }

  // tooltip: if hoverPoint exists show name near mouse
  if (hoverPoint) {
    tooltipEl.style.display = "block";
    tooltipEl.textContent = hoverPoint.fields.name || "(no name)";
    // position tooltip near mouse but keep inside viewport
    const offsetX = 12;
    const offsetY = -12;
    const left = constrain(mouseX + offsetX, 8, windowWidth - 8);
    const top = constrain(mouseY + offsetY, 8, windowHeight - 8);
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  } else {
    tooltipEl.style.display = "none";
  }
}

/* ---------------- windowResized ---------------- */
function windowResized() {
  const newCanvasH = max(220, windowHeight - footerHeight - 8);
  resizeCanvas(windowWidth, newCanvasH);
  computeImagePlacement();
  updatePointsXY();
}

/* ---------------- preparePointsFromTable ---------------- */
function preparePointsFromTable() {
  points = [];
  minElev = Infinity; maxElev = -Infinity;

  const headers = table.columns.map(h => h.trim());
  const latKey = findHeader(headers, latCandidates);
  const lonKey = findHeader(headers, lonCandidates);
  const elevKey = findHeader(headers, elevCandidates);

  const nameKey = findHeader(headers, nameCandidates);
  const countryKey = findHeader(headers, countryCandidates);
  const locationKey = findHeader(headers, locationCandidates);
  const typeKey = findHeader(headers, typeCandidates);
  const typeCatKey = findHeader(headers, typeCatCandidates);
  const statusKey = findHeader(headers, statusCandidates);
  const eruptionKey = findHeader(headers, eruptionCandidates);

  if (!latKey || !lonKey) {
    console.error("Lat/Lon columns not found. Headers:", headers);
    return;
  }

  for (let r = 0; r < table.getRowCount(); r++) {
    const row = table.getRow(r);
    const lat = parseFloat(String(row.get(latKey)).replace(",", "."));
    const lon = parseFloat(String(row.get(lonKey)).replace(",", "."));
    const elevRaw = elevKey ? row.get(elevKey) : "";
    const elev = elevRaw === "" ? NaN : parseFloat(String(elevRaw).replace(",", "."));

    if (isNaN(lat) || isNaN(lon)) continue;

    if (!isNaN(elev)) {
      minElev = min(minElev, elev);
      maxElev = max(maxElev, elev);
    }

    const fields = {
      name: safeString(nameKey ? row.get(nameKey) : ""),
      country: safeString(countryKey ? row.get(countryKey) : ""),
      location: safeString(locationKey ? row.get(locationKey) : ""),
      elevation: !isNaN(elev) ? elev : "",
      type: safeString(typeKey ? row.get(typeKey) : ""),
      typeCategory: safeString(typeCatKey ? row.get(typeCatKey) : ""),
      status: safeString(statusKey ? row.get(statusKey) : ""),
      lastEruption: safeString(eruptionKey ? row.get(eruptionKey) : "")
    };

    points.push({ lat, lon, elev: isNaN(elev) ? NaN : elev, x: 0, y: 0, fields });
  }

  if (!isFinite(minElev) || !isFinite(maxElev)) {
    minElev = 0; maxElev = 4000;
  }
}

/* ---------------- findHeader utility ---------------- */
function findHeader(headers, candidates) {
  for (let c of candidates) if (headers.includes(c)) return c;
  const lower = headers.map(h => h.toLowerCase());
  for (let c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  for (let h of headers) {
    const low = h.toLowerCase();
    for (let c of candidates) {
      const cSimple = c.toLowerCase().replace(/\s+/g, "");
      if (low.includes(cSimple) || low.includes(c.split(" ")[0].toLowerCase())) return h;
    }
  }
  return null;
}

/* ---------------- computeImagePlacement keeps aspect ratio and makes map slightly smaller ---------------- */
function computeImagePlacement() {
  if (mapImg && mapImg.width > 0 && mapImg.height > 0) {
    imgAspect = mapImg.width / mapImg.height;
  } else {
    imgAspect = 2; // fallback equirectangular
  }

  // available area is canvas width and height but we also subtract header space at top (we leave header overlay)
  const padX = width * paddingFrac;
  const padY = height * paddingFrac + (headerHeight / height) * height * 0.5; // add space for header visually

  const availW = width - 2 * padX;
  const availH = height - 2 * padY;

  // reduce overall size slightly so header/legend feel separate
  const shrinkFactor = 0.94;

  if ((availW * shrinkFactor) / imgAspect <= (availH * shrinkFactor)) {
    imgW = (availW * shrinkFactor);
    imgH = imgW / imgAspect;
  } else {
    imgH = (availH * shrinkFactor);
    imgW = imgH * imgAspect;
  }

  imgX = (width - imgW) / 2;
  imgY = (height - imgH) / 2 + headerHeight * 0.08; // nudge a bit down so header doesn't feel overlapping
}

/* ---------------- updatePointsXY ---------------- */
function updatePointsXY() {
  for (let p of points) {
    p.x = imgX + map(p.lon, -180, 180, 0, imgW);
    p.y = imgY + map(p.lat, 90, -90, 0, imgH);
  }
}

/* ---------------- colorFromElevation (linear RGB interp) ---------------- */
function colorFromElevation(elev) {
  if (!isFinite(elev)) elev = minElev;
  const t = constrain(map(elev, minElev, maxElev, 0, 1), 0, 1);
  const r = lerp(colorLow[0], colorHigh[0], t);
  const g = lerp(colorLow[1], colorHigh[1], t);
  const b = lerp(colorLow[2], colorHigh[2], t);
  return [r, g, b];
}

/* ---------------- drawFallbackMap ---------------- */
function drawFallbackMap() {
  noStroke();
  fill(235, 242, 249);
  rect(0, 0, width, height);

  computeImagePlacement();
  fill(230);
  rect(imgX, imgY, imgW, imgH);

  stroke(200);
  strokeWeight(1);
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = imgX + map(lon, -180, 180, 0, imgW);
    line(x, imgY, x, imgY + imgH);
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const y = imgY + map(lat, 90, -90, 0, imgH);
    line(imgX, y, imgX + imgW, y);
  }
  noStroke();
}

/* ---------------- mousePressed: click on point -> update footer and select point ---------------- */
function mousePressed() {
  const sizeScale = max(0.8, min(width, height) / 900);
  const dotSize = dotBaseSize * sizeScale;
  const hitRadius = max(6, dotSize * 1.3);

  for (let p of points) {
    const d = dist(mouseX, mouseY, p.x, p.y);
    if (d <= hitRadius) {
      selectedPoint = p;
      updateFooterWithPoint(p);
      return;
    }
  }
}

/* ---------------- createFooterUI: same as before but keeps style consistent ---------------- */
function createFooterUI() {
  // remove existing
  const existing = document.getElementById("volcano-footer");
  if (existing) existing.remove();
  const existingStyle = document.getElementById("volcano-footer-style");
  if (existingStyle) existingStyle.remove();

  const css = `
  #volcano-footer {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    height: ${footerHeight - 24}px;
    display: flex;
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
    align-items: stretch;
    justify-content: center;
    z-index: 1500;
    background: rgba(255,255,255,0.95);
    border-radius: 12px;
    border: 1px solid rgba(0,0,0,0.06);
    backdrop-filter: blur(4px);
    box-shadow: 0 12px 30px rgba(0,0,0,0.08);
  }
  #volcano-footer .box {
    flex: 1 1 0;
    min-width: 120px;
    background: #fff;
    border-radius: 8px;
    padding: 10px;
    display:flex;
    flex-direction:column;
    justify-content:center;
  }
  #volcano-footer .label {
    font-size:12px;
    color:#444;
    margin-bottom:6px;
    font-weight:700;
  }
  #volcano-footer .value {
    font-size:14px;
    color:#111;
    word-break:break-word;
  }
  #volcano-footer .swatch { width:18px; height:18px; border-radius:4px; margin-right:8px; border:1px solid rgba(0,0,0,0.06); display:inline-block; vertical-align:middle; }
  #volcano-footer .nameRow { display:flex; align-items:center; gap:8px; }
  @media (max-width:900px){
    #volcano-footer { flex-wrap:wrap; height:auto; padding:10px; gap:8px; left:8px; right:8px; bottom:8px; }
    #volcano-footer .box { flex-basis:48%; min-width:40%; }
  }`;

  const style = document.createElement("style");
  style.id = "volcano-footer-style";
  style.innerHTML = css;
  document.head.appendChild(style);

  footerEl = document.createElement("div");
  footerEl.id = "volcano-footer";

  const box1 = makeBox("Name · Country");
  box1.querySelector(".value").innerHTML = `<span class="swatch" id="swatchBox"></span><span id="boxNameCountry">Click a point</span>`;

  const box2 = makeBox("Location");
  box2.querySelector(".value").id = "boxLocation"; box2.querySelector(".value").textContent = "-";

  const box3 = makeBox("Elevation (m)");
  box3.querySelector(".value").id = "boxElevation"; box3.querySelector(".value").textContent = "-";

  const box4 = makeBox("Type · TypeCategory");
  box4.querySelector(".value").id = "boxType"; box4.querySelector(".value").textContent = "-";

  const box5 = makeBox("Status");
  box5.querySelector(".value").id = "boxStatus"; box5.querySelector(".value").textContent = "-";

  const box6 = makeBox("Last Known Eruption");
  box6.querySelector(".value").id = "boxEruption"; box6.querySelector(".value").textContent = "-";

  footerEl.appendChild(box1);
  footerEl.appendChild(box2);
  footerEl.appendChild(box3);
  footerEl.appendChild(box4);
  footerEl.appendChild(box5);
  footerEl.appendChild(box6);

  document.body.appendChild(footerEl);

  footerBoxes = {
    nameCountry: document.getElementById("boxNameCountry"),
    swatch: document.getElementById("swatchBox"),
    location: document.getElementById("boxLocation"),
    elevation: document.getElementById("boxElevation"),
    type: document.getElementById("boxType"),
    status: document.getElementById("boxStatus"),
    eruption: document.getElementById("boxEruption")
  };
}

/* ---------------- helper: makeBox ---------------- */
function makeBox(labelText) {
  const box = document.createElement("div");
  box.className = "box";
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = labelText;
  const value = document.createElement("div");
  value.className = "value";
  box.appendChild(label);
  box.appendChild(value);
  return box;
}

/* ---------------- updateFooterWithPoint ---------------- */
function updateFooterWithPoint(p) {
  const f = p.fields;
  const displayName = (f.name && f.name.trim() !== "") ? f.name : "(no name)";
  const displayCountry = (f.country && f.country.trim() !== "") ? ` — ${f.country}` : "";
  if (footerBoxes.nameCountry) footerBoxes.nameCountry.textContent = `${displayName}${displayCountry}`;

  const col = colorFromElevation(p.elev);
  if (footerBoxes.swatch) footerBoxes.swatch.style.background = `rgb(${Math.round(col[0])}, ${Math.round(col[1])}, ${Math.round(col[2])})`;

  if (footerBoxes.location) footerBoxes.location.textContent = f.location || "-";
  if (footerBoxes.elevation) footerBoxes.elevation.textContent = (f.elevation !== "" ? f.elevation : "-");
  const tt = (f.type || "") + (f.typeCategory ? ` · ${f.typeCategory}` : "");
  if (footerBoxes.type) footerBoxes.type.textContent = tt || "-";
  if (footerBoxes.status) footerBoxes.status.textContent = f.status || "-";
  if (footerBoxes.eruption) footerBoxes.eruption.textContent = f.lastEruption || "-";
}

/* ---------------- utility: safeString ---------------- */
function safeString(v) {
  if (v === null || typeof v === 'undefined') return "";
  return String(v).trim();
}

/* ---------------- update header legend ticks ---------------- */
function updateLegendTicks() {
  const minTick = document.getElementById("minTick");
  const midTick = document.getElementById("midTick");
  const maxTick = document.getElementById("maxTick");
  if (minTick) minTick.textContent = `${Math.round(minElev)}`;
  if (midTick) midTick.textContent = `${Math.round((minElev + maxElev) / 2)}`;
  if (maxTick) maxTick.textContent = `${Math.round(maxElev)}`;
}

/* ---------------- end of file ---------------- */
