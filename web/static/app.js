"use strict";
const $ = (id) => document.getElementById(id);
const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  students:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
  recognize:
    "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M9 10h.01 M15 10h.01 M8 15c2 3 6 3 8 0 M7 7c0-5 10-5 10 0 M12 10v3",
  attendance:
    "M8 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3 M8 2h8v4H8z M8 14l3 3 5-6",
  train:
    "M9 3H6v4H3v4h3v2H3v4h3v4h4v-4h4v4h4v-4h3v-4h-3v-2h3V7h-3V3h-4v4h-4V3z M9 10h6v4H9z",
  photos: "M8 3h13v14 M3 7h14v14H3z M3 17l4-4 4 4 3-3 3 3 M7 10h.01",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01",
  about: "M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 3l-4 18",
  settings:
    "M3 6h6 M15 6h6 M3 12h12 M21 12h-2 M3 18h2 M11 18h10 M9 3h6v6H9z M15 9h4v6h-4z M5 15h6v6H5z",
};
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name] || paths.dashboard);
  svg.append(path);
  return svg;
}
const modules = [
  [
    "dashboard",
    "Dashboard",
    "Your attendance workspace. Everything in one place.",
  ],
  [
    "students",
    "Student Details",
    "Manage students & face samples",
    "#edf3ff",
    "#5684cb",
  ],
  [
    "recognize",
    "Face Detector",
    "Recognize faces & mark attendance",
    "#e9f6f9",
    "#4d9aa9",
  ],
  [
    "attendance",
    "Attendance",
    "View records & export reports",
    "#f0edfa",
    "#8b76c6",
  ],
  [
    "train",
    "Train Data",
    "Train the face recognition model",
    "#edf1fc",
    "#738ac2",
  ],
  [
    "photos",
    "Photos",
    "Browse your student face samples",
    "#fff5e7",
    "#cca568",
  ],
  [
    "help",
    "Help & Support",
    "A guide to your attendance workflow",
    "#e9f6f2",
    "#6b9e91",
  ],
  [
    "about",
    "About Vision Attend",
    "Explore the project & technology",
    "#fbefef",
    "#c89498",
  ],
  [
    "settings",
    "Session Settings",
    "Manage your session & data",
    "#eef2f6",
    "#8395b0",
  ],
];
for (const [id, title, description, tint, ink] of modules) {
  const nav = document.createElement("a");
  nav.href = "#" + id;
  nav.className = "nav-link";
  nav.dataset.route = id;
  nav.append(icon(id), document.createTextNode(title));
  if (id === "help") {
    const sep = document.createElement("div");
    sep.className = "nav-separator";
    $("navigation").append(sep);
  }
  $("navigation").append(nav);
  if (id === "dashboard") continue;
  const card = document.createElement("a");
  card.href = "#" + id;
  card.className = "module";
  const art = document.createElement("div");
  art.className = "module-art";
  art.style.setProperty("--tint", tint);
  art.style.setProperty("--ink", ink);
  art.append(icon(id));
  const dots = document.createElement("span");
  dots.className = "art-dots";
  dots.textContent = "···";
  dots.setAttribute("aria-hidden", "true");
  art.append(dots);
  const content = document.createElement("div");
  content.className = "module-content";
  const heading = document.createElement("h3"),
    desc = document.createElement("p"),
    arrow = document.createElement("span");
  heading.textContent = title;
  desc.textContent = description;
  arrow.textContent = "↗";
  arrow.className = "module-arrow";
  arrow.setAttribute("aria-hidden", "true");
  content.append(heading, desc, arrow);
  card.append(art, content);
  $("module-grid").append(card);
}
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => el.append(icon(el.dataset.icon)));
let stream = null,
  samples = [],
  pending = null,
  busy = false,
  editing = null,
  scanning = false,
  scanTimer = null,
  currentView = "dashboard";
let state = {
  students: [],
  attendance: [],
  model_ready: false,
  sample_count: 0,
};
function message(text, error = false) {
  $("message").textContent = text;
  $("message").hidden = !text;
  $("message").classList.toggle("error", error);
}
async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Vision-Request": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res
    .json()
    .catch(() => ({
      detail:
        "The server is waking up or unavailable. Wait a moment and try again.",
    }));
  if (!res.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .map(
                (e) =>
                  `${e.loc.filter((k) => k !== "body").join(" ")}: ${e.msg}`,
              )
              .join("; ")
          : "The request failed. Please try again.";
    throw Error(detail);
  }
  return data;
}
function updateControls() {
  document.querySelectorAll("button").forEach((b) => (b.disabled = busy));
  $("stop-camera").disabled = busy || !stream;
  $("start-camera").disabled = busy || Boolean(stream);
  $("train-model").disabled = busy || !state.students.length;
  $("start-scan").disabled = busy || scanning || !state.model_ready;
  $("stop-scan").disabled = !scanning;
  $("recognize-capture").disabled = busy || scanning || !state.model_ready;
  document.querySelectorAll("input").forEach((i) => (i.disabled = busy));
  $("student-id").disabled = busy || Boolean(editing);
}
async function action(fn) {
  if (busy) return;
  busy = true;
  updateControls();
  try {
    await fn();
  } catch (e) {
    message(e.message, true);
  } finally {
    busy = false;
    updateControls();
  }
}
function ensureConsent() {
  if (!$("consent").checked)
    throw Error("Please confirm permission to process these photos first.");
}
function clearMatch() {
  pending = null;
  $("confirm-match").hidden = true;
  $("match-result").replaceChildren();
  const h = document.createElement("h3"),
    p = document.createElement("p");
  h.textContent = "Waiting for a face";
  p.textContent = "Capture a fresh frame or upload a photo to see a match.";
  $("match-result").append(h, p);
}
function stopScan() {
  scanning = false;
  clearTimeout(scanTimer);
  scanTimer = null;
  $("scan-status").textContent = "Scanning is stopped.";
  updateControls();
}
function stopCamera() {
  stopScan();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("video").srcObject = null;
  $("video").hidden = true;
  $("camera-placeholder").hidden = false;
  $("camera-status").textContent = "Camera off";
  updateControls();
}
async function route() {
  const requested = location.hash.slice(1) || "dashboard";
  if (requested === "main") return;
  const module = modules.find((m) => m[0] === requested) || modules[0];
  currentView = module[0];
  stopScan();
  if (!["students", "recognize"].includes(currentView)) stopCamera();
  document
    .querySelectorAll("[data-view]")
    .forEach((el) => (el.hidden = el.dataset.view !== currentView));
  document.querySelectorAll("[data-route]").forEach((el) => {
    if (el.dataset.route === currentView)
      el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("breadcrumb").textContent = module[1];
  $("page-title").textContent = module[1];
  $("page-description").textContent = module[2];
  const slot =
    currentView === "students"
      ? "student-camera-slot"
      : currentView === "recognize"
        ? "recognition-camera-slot"
        : "camera-home";
  $(slot).append($("camera-panel"));
  await action(async () => {
    await refresh();
    if (currentView === "photos") await loadPhotos();
  });
}
window.addEventListener("hashchange", () => {
  message("");
  route();
  $("main").focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
function clock() {
  const now = new Date();
  $("clock-time").textContent = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  $("clock-time").dateTime = now.toISOString();
  $("clock-date").textContent = now.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
clock();
setInterval(clock, 1000);
function updateSamples() {
  const list = $("samples");
  list.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const el = document.createElement(samples[i] ? "img" : "span");
    if (samples[i]) {
      el.src = samples[i];
      el.alt = `Enrollment photo ${i + 1}`;
    } else {
      el.className = "sample-empty";
      el.textContent = String(i + 1).padStart(2, "0");
    }
    list.append(el);
  }
  $("sample-count").textContent = `${samples.length} of 3 collected`;
}
function capture() {
  const v = $("video");
  if (!stream || !v.videoWidth)
    throw Error("Enable your camera first, or upload a photo.");
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = Math.round((v.videoHeight / v.videoWidth) * 640);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
async function fileImage(file) {
  if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 8_000_000)
    throw Error("Choose JPEG or PNG photos smaller than 8 MB.");
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 20_000_000) {
    bitmap.close();
    throw Error("Choose photos smaller than 20 megapixels.");
  }
  const c = document.createElement("canvas"),
    scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return c.toDataURL("image/jpeg", 0.85);
}
$("start-camera").onclick = () =>
  action(async () => {
    stopCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });
    } catch (e) {
      throw Error(
        "Camera unavailable or permission denied. Allow camera access in your browser, or upload photos instead.",
      );
    }
    if (!["students", "recognize"].includes(currentView)) {
      stopCamera();
      return;
    }
    $("video").srcObject = stream;
    $("video").hidden = false;
    $("camera-placeholder").hidden = true;
    $("camera-status").textContent = "Camera on";
    for (const track of stream.getVideoTracks())
      track.onended = () => stopCamera();
    message(
      "Camera ready. Photos are sent only when you save a student or run recognition.",
    );
  });
$("stop-camera").onclick = stopCamera;
window.addEventListener("pagehide", () => {
  stopCamera();
  samples = [];
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
});
$("capture-sample").onclick = () =>
  action(async () => {
    ensureConsent();
    if (samples.length >= 3)
      throw Error("Three photos are already collected. Reset to replace them.");
    samples.push(capture());
    updateSamples();
    message(
      "Photo added. Change your expression or angle slightly for the next photo.",
    );
  });
$("enroll-upload").onchange = (e) =>
  action(async () => {
    try {
      ensureConsent();
      for (const file of e.target.files) {
        if (samples.length >= 3) break;
        samples.push(await fileImage(file));
      }
      updateSamples();
      message("Photos added. Save the student when all three are ready.");
    } finally {
      e.target.value = "";
    }
  });
$("reset-samples").onclick = () => {
  samples = [];
  updateSamples();
};
function cell(value, small) {
  const td = document.createElement("td");
  td.textContent = value || "—";
  if (small) {
    const sub = document.createElement("small");
    sub.textContent = small;
    td.append(sub);
  }
  return td;
}
function renderStudents() {
  const query = $("student-search").value.trim().toLowerCase();
  const students = state.students.filter((s) =>
    [s.name, s.id, s.roll_number, s.department, s.course]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
  $("student-body").replaceChildren(
    ...students.map((s) => {
      const tr = document.createElement("tr"),
        actions = document.createElement("td"),
        row = document.createElement("div");
      row.className = "table-actions";
      for (const [label, handler] of [
        ["Edit", () => editStudent(s)],
        ["Remove", () => removeStudent(s)],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = label === "Remove" ? "danger" : "secondary";
        button.textContent = label;
        button.setAttribute("aria-label", `${label} ${s.name}`);
        button.onclick = handler;
        row.append(button);
      }
      actions.append(row);
      tr.append(
        cell(s.name),
        cell(s.id, s.roll_number),
        cell(s.department, s.course),
        cell(`${s.sample_count} photos`),
        actions,
      );
      return tr;
    }),
  );
  $("empty-students").hidden = Boolean(students.length);
  $("empty-students").textContent = state.students.length
    ? "No students match your search."
    : "Your directory is empty. Add your first student above.";
}
function renderAttendance() {
  const query = $("attendance-search").value.trim().toLowerCase(),
    date = $("attendance-date").value;
  const records = state.attendance.filter(
    (r) =>
      (!date || r.date === date) &&
      [r.name, r.id, r.department].join(" ").toLowerCase().includes(query),
  );
  $("attendance-body").replaceChildren(
    ...[...records].reverse().map((r) => {
      const tr = document.createElement("tr");
      for (const key of ["name", "id", "department", "date", "time", "status"])
        tr.append(cell(r[key]));
      return tr;
    }),
  );
  $("empty-records").hidden = Boolean(records.length);
  $("empty-records").textContent = state.attendance.length
    ? "No records match these filters."
    : "No attendance yet. Open Face Detector and confirm a recognition result.";
  $("record-count").textContent =
    `${records.length} of ${state.attendance.length} records shown`;
}
function render() {
  const today = new Date().toISOString().slice(0, 10);
  $("student-count").textContent = state.students.length;
  $("attendance-count").textContent = state.attendance.filter(
    (r) => r.date === today,
  ).length;
  $("photo-count").textContent = state.sample_count;
  $("model-count").textContent = state.model_ready ? "Ready" : "Not trained";
  $("model-caption").textContent = state.model_ready
    ? "Ready for face recognition"
    : state.students.length
      ? "Open Train Data to prepare"
      : "Add students to get started";
  $("model-badge").textContent = state.model_ready
    ? "● Model ready"
    : "Model not trained";
  $("model-badge").classList.toggle("ready", state.model_ready);
  $("train-students").textContent = state.students.length;
  $("train-samples").textContent = state.sample_count;
  $("training-status").textContent = state.model_ready
    ? "Model ready. You can now open Face Detector."
    : state.students.length
      ? "Samples ready. Train the model to enable recognition."
      : "Add at least one student to begin.";
  $("training-list").replaceChildren(
    ...state.students.map((s) => {
      const row = document.createElement("div");
      row.className = "dataset-row";
      const name = document.createElement("div"),
        id = document.createElement("small"),
        count = document.createElement("span");
      name.textContent = s.name;
      id.textContent = s.id;
      name.append(id);
      count.textContent = `${s.sample_count} samples ready`;
      row.append(name, count);
      return row;
    }),
  );
  if (!state.students.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No students in your dataset yet.";
    $("training-list").append(p);
  }
  const recent = $("recent-attendance");
  recent.replaceChildren();
  if (!state.attendance.length) {
    const box = document.createElement("div");
    box.className = "recent-empty";
    const title = document.createElement("strong"),
      desc = document.createElement("p");
    title.textContent = "No attendance recorded yet";
    desc.textContent = "Confirmed matches will appear here.";
    box.append(icon("attendance"), title, desc);
    recent.append(box);
  } else
    for (const record of state.attendance.slice(-3).reverse()) {
      const row = document.createElement("div");
      row.className = "recent-row";
      const name = document.createElement("div"),
        id = document.createElement("small"),
        time = document.createElement("time");
      name.textContent = record.name;
      id.textContent = `${record.id} · ${record.date}`;
      name.append(id);
      time.textContent = record.time + " UTC";
      row.append(name, time);
      recent.append(row);
    }
  renderStudents();
  renderAttendance();
  updateControls();
}
async function refresh() {
  state = await api("/api/session");
  render();
}
$("student-search").oninput = renderStudents;
$("attendance-search").oninput = renderAttendance;
$("attendance-date").oninput = renderAttendance;
$("reset-filters").onclick = () => {
  $("attendance-search").value = "";
  $("attendance-date").value = "";
  renderAttendance();
};
function resetForm() {
  editing = null;
  $("enroll-form").reset();
  $("student-id").disabled = false;
  $("student-form-title").textContent = "Add a student";
  $("enroll-submit").textContent = "Save student & samples";
  $("enrollment-photos").hidden = false;
  $("cancel-edit").hidden = true;
  $("enroll-hint").textContent =
    "Next: open Train Data to train your recognition model.";
  samples = [];
  updateSamples();
  updateControls();
}
function editStudent(student) {
  if (busy) return;
  editing = student.id;
  $("student-id").value = student.id;
  $("student-name").value = student.name;
  $("department").value = student.department;
  $("roll-number").value = student.roll_number;
  $("course").value = student.course;
  $("student-id").disabled = true;
  $("student-form-title").textContent = "Edit student details";
  $("enrollment-photos").hidden = true;
  $("cancel-edit").hidden = false;
  $("enroll-submit").textContent = "Save changes";
  $("enroll-hint").textContent =
    "Student ID and face samples are unchanged. Existing attendance keeps the details recorded at confirmation.";
  $("student-name").focus();
  $("enroll-form").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("cancel-edit").onclick = resetForm;
function removeStudent(student) {
  action(async () => {
    if (
      !confirm(
        `Remove ${student.name} and their face samples? Existing attendance will be kept. The remaining students will need retraining.`,
      )
    )
      return;
    const data = await api(
      "/api/students/" + encodeURIComponent(student.id),
      "DELETE",
    );
    clearMatch();
    if (editing === student.id) resetForm();
    await refresh();
    message(data.message);
  });
}
$("enroll-form").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    const details = {
      name: $("student-name").value.trim(),
      department: $("department").value.trim(),
      roll_number: $("roll-number").value.trim(),
      course: $("course").value.trim(),
    };
    if (editing) {
      await api("/api/students/" + encodeURIComponent(editing), "PUT", details);
      resetForm();
      clearMatch();
      await refresh();
      message("Student details updated.");
      return;
    }
    ensureConsent();
    if (samples.length !== 3)
      throw Error("Collect exactly three photos before saving this student.");
    message("Checking and saving face samples…");
    await api("/api/enroll", "POST", {
      ...details,
      id: $("student-id").value,
      images: samples,
      consent: true,
      train: false,
    });
    resetForm();
    clearMatch();
    await refresh();
    message("Student saved. Open Train Data to prepare the recognition model.");
  });
};
$("train-model").onclick = () =>
  action(async () => {
    message("Training your model from enrolled face samples…");
    const result = await api("/api/train", "POST");
    clearMatch();
    await refresh();
    message(result.message);
  });
async function loadPhotos() {
  const data = await api("/api/photos");
  $("photo-gallery").replaceChildren(
    ...data.groups.map((group) => {
      const card = document.createElement("article");
      card.className = "photo-group";
      const heading = document.createElement("h3"),
        details = document.createElement("p"),
        strip = document.createElement("div");
      heading.textContent = group.student.name;
      details.textContent =
        group.student.id +
        " · " +
        (group.student.department || "No department");
      strip.className = "photo-strip";
      for (const [index, image] of group.images.entries()) {
        const img = document.createElement("img");
        img.src = image;
        img.alt = `${group.student.name}, training sample ${index + 1}`;
        strip.append(img);
      }
      card.append(heading, details, strip);
      return card;
    }),
  );
  $("empty-photos").hidden = Boolean(data.groups.length);
}
async function recognize(image) {
  ensureConsent();
  clearMatch();
  message("Comparing this face with your session model…");
  const data = await api("/api/recognize", "POST", { image, consent: true });
  if (currentView !== "recognize") return false;
  const box = $("match-result"),
    heading = document.createElement("h3"),
    detail = document.createElement("p");
  box.replaceChildren();
  if (data.matched) {
    heading.textContent = `Possible match: ${data.student.name}`;
    detail.textContent = `${data.student.id} · ${data.student.department || "No department"} · LBPH distance ${data.distance}. Verify the person before confirming.`;
    pending = data.token;
    $("confirm-match").hidden = false;
    message("Review the possible match. No attendance has been recorded yet.");
  } else {
    heading.textContent = "No close match";
    detail.textContent = data.message;
    message("Try better lighting, or enroll this student first.");
  }
  box.append(heading, detail);
  return data.matched;
}
$("recognize-capture").onclick = () =>
  action(async () => {
    ensureConsent();
    await recognize(capture());
  });
$("recognize-upload").onchange = (e) => {
  stopScan();
  action(async () => {
    try {
      ensureConsent();
      if (e.target.files[0])
        await recognize(await fileImage(e.target.files[0]));
    } finally {
      e.target.value = "";
    }
  });
};
async function scanStep() {
  if (!scanning || currentView !== "recognize") return;
  if (busy) {
    scanTimer = setTimeout(scanStep, 500);
    return;
  }
  await action(async () => {
    try {
      const matched = await recognize(capture());
      if (matched) {
        stopScan();
        $("scan-status").textContent =
          "Scanning paused. Review the possible match below.";
      }
    } catch (e) {
      stopScan();
      throw e;
    }
  });
  if (scanning) scanTimer = setTimeout(scanStep, 2000);
}
$("start-scan").onclick = () => {
  if (busy) return;
  try {
    ensureConsent();
    capture();
    if (!state.model_ready) throw Error("Train your model first.");
    scanning = true;
    $("scan-status").textContent =
      "Scanning one frame every two seconds. Stops when a match is found.";
    updateControls();
    scanStep();
  } catch (e) {
    message(e.message, true);
  }
};
$("stop-scan").onclick = stopScan;
$("confirm-match").onclick = () =>
  action(async () => {
    if (!pending) throw Error("Capture a fresh image first.");
    const data = await api("/api/attendance", "POST", { token: pending });
    pending = null;
    $("confirm-match").hidden = true;
    await refresh();
    message(data.message);
  });
$("clear-session").onclick = () =>
  action(async () => {
    if (
      !confirm(
        "Delete all face samples, students, and attendance in this session? Export first. This cannot be undone.",
      )
    )
      return;
    await api("/api/session", "DELETE");
    clearMatch();
    resetForm();
    stopCamera();
    $("consent").checked = false;
    $("photo-gallery").replaceChildren();
    await refresh();
    message("Session data deleted. You can start again from Student Details.");
  });
updateSamples();
route();
