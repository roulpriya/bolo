const STATES = new Set([
  "idle", "recording", "transcribing", "planning", "clarifying",
  "reviewing", "executing", "verifying", "completed", "failed",
]);

const composer = document.querySelector("#composer");
const input = document.querySelector("#composer-input");
const sendButton = document.querySelector("#composer-send");
const micButton = document.querySelector("#composer-mic");
const status = document.querySelector("#agent-status");
const statusText = status.querySelector("span");
const conversation = document.querySelector("#conversation");
const chatLog = document.querySelector("#chat-log");
const newTaskButton = document.querySelector("#new-task");
const liveStatus = document.querySelector("#live-status");
const recordingBar = document.querySelector("#recording-bar");
const recordingTime = document.querySelector("#recording-time");
const recordingCancel = document.querySelector("#recording-cancel");
const recordingDone = document.querySelector("#recording-done");

let state = "idle";
let taskId = "";
let plan = null;
let approvalToken = "";
let runId = "";
let pollTimer;
let typingMessage;
let progressCard;
let mediaRecorder;
let mediaStream;
let audioChunks = [];
let discardRecording = false;
let recordingContext = "idle";
let recordingStartedAt = 0;
let recordingInterval;
let voiceResponsesEnabled = false;
let speechAudio;
let speechObjectUrl;
let speechGeneration = 0;

function setState(next) {
  if (!STATES.has(next)) throw new Error(`Unknown state: ${next}`);
  state = next;
  clearTimeout(pollTimer);
  const labels = {
    idle: "Ready",
    recording: "Listening",
    transcribing: "Transcribing",
    planning: "Planning",
    clarifying: "Needs a detail",
    reviewing: "Waiting for approval",
    executing: "Working",
    verifying: "Verifying",
    completed: "Complete",
    failed: "Needs attention",
  };
  statusText.textContent = labels[next];
  status.classList.toggle("busy", ["recording", "transcribing", "planning", "executing", "verifying"].includes(next));
  liveStatus.textContent = `Bolo is ${labels[next].toLowerCase()}.`;
  const canStart = ["idle", "completed", "failed"].includes(state);
  const canRecord = canStart || state === "clarifying";
  input.disabled = !(canStart || state === "clarifying");
  micButton.disabled = !canRecord;
  newTaskButton.hidden = state === "idle";
  updateComposer();
}

function updateComposer() {
  const canType = ["idle", "completed", "failed", "clarifying"].includes(state);
  sendButton.disabled = !canType || !input.value.trim();
  sendButton.firstChild.textContent = state === "clarifying" ? "Answer " : "Submit ";
  input.placeholder = state === "clarifying"
    ? "Type the missing detail…"
    : "What do you want to get done?";
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 92)}px`;
}

function revealConversation() {
  conversation.hidden = false;
  window.boloDesktop?.setExpanded(true);
  requestAnimationFrame(() => {
    conversation.scrollTop = conversation.scrollHeight;
  });
}

function addMessage(kind, text = "") {
  revealConversation();
  const message = document.querySelector("#message-template").content.firstElementChild.cloneNode(true);
  message.classList.add(kind);
  message.querySelector(".message-label").textContent = kind === "user" ? "You" : "Bolo";
  message.querySelector(".message-body").textContent = text;
  chatLog.append(message);
  conversation.scrollTop = conversation.scrollHeight;
  return message;
}

function showTyping() {
  hideTyping();
  typingMessage = addMessage("bot");
  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.setAttribute("aria-label", "Bolo is thinking");
  dots.innerHTML = "<i></i><i></i><i></i>";
  typingMessage.querySelector(".message-body").append(dots);
}

function hideTyping() {
  typingMessage?.remove();
  typingMessage = null;
}

function friendlyError(message) {
  if (/API_KEY|not configured/i.test(message)) {
    return "Bolo needs its API keys configured before it can plan that task.";
  }
  return message || "Something went wrong.";
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : await response.blob();
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

function stopSpeech() {
  speechGeneration += 1;
  speechAudio?.pause();
  speechAudio = null;
  if (speechObjectUrl) URL.revokeObjectURL(speechObjectUrl);
  speechObjectUrl = null;
}

async function speakResponse(text) {
  if (!voiceResponsesEnabled || !String(text || "").trim()) return;
  const generation = ++speechGeneration;
  try {
    const audioBlob = await api("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (generation !== speechGeneration || !voiceResponsesEnabled) return;
    stopSpeech();
    speechGeneration = generation;
    speechObjectUrl = URL.createObjectURL(audioBlob);
    speechAudio = new Audio(speechObjectUrl);
    speechAudio.addEventListener(
      "ended",
      () => {
        if (speechObjectUrl) URL.revokeObjectURL(speechObjectUrl);
        speechObjectUrl = null;
        speechAudio = null;
      },
      { once: true },
    );
    await speechAudio.play();
  } catch (error) {
    console.warn("Bolo could not play its spoken response:", error);
  }
}

async function submitTask(value, { fromVoice = false } = {}) {
  const command = value.trim();
  if (!command) return;
  if (["completed", "failed"].includes(state)) resetTask();
  voiceResponsesEnabled = fromVoice;
  input.value = "";
  addMessage("user", command);
  setState("planning");
  showTyping();
  try {
    const result = await api("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: command }),
    });
    handlePlanningResult(result);
  } catch (error) {
    fail(error.message);
  }
}

function handlePlanningResult(result) {
  hideTyping();
  taskId = result.taskId;
  if (result.status === "needs_clarification") {
    setState("clarifying");
    addMessage("bot", result.clarificationQuestion);
    speakResponse(result.clarificationQuestion);
    input.focus();
    return;
  }

  plan = result.plan;
  approvalToken = result.approvalToken;
  setState("reviewing");
  const message = addMessage("bot", "I have a plan. Review it before I submit the task.");
  speakResponse(
    `I have a plan. ${plan.task} Review it before I submit the task.`,
  );
  const card = document.querySelector("#plan-template").content.firstElementChild.cloneNode(true);
  card.querySelector(".plan-title").textContent = plan.title;
  card.querySelector(".plan-target").textContent = plan.application;
  card.querySelector(".plan-action").textContent = plan.task;
  const planSteps = card.querySelector(".plan-steps");
  for (const [index, step] of (plan.steps || []).entries()) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const detail = document.createElement("span");
    name.textContent = `${index + 1}. ${step.title}`;
    const latency =
      step.targetLatencyMs <= 1_000
        ? "instant"
        : `target < ${Math.ceil(step.targetLatencyMs / 1_000)}s`;
    detail.textContent = `${step.capability} · ${step.risk.replaceAll("_", " ")} · ${latency}`;
    item.append(name, detail);
    planSteps.append(item);
  }
  planSteps.hidden = (plan.steps || []).length < 2;
  const confirm = card.querySelector(".confirm-button");
  const cancel = card.querySelector(".cancel-button");
  confirm.addEventListener("click", () => {
    confirm.disabled = true;
    cancel.disabled = true;
    executeTask();
  });
  cancel.addEventListener("click", () => resetTask(true, "Cancelled. Nothing was changed."));
  message.querySelector(".message-body").append(card);
  conversation.scrollTop = conversation.scrollHeight;
}

async function submitClarification(value, { fromVoice = false } = {}) {
  const answer = value.trim();
  if (!answer) return;
  if (fromVoice) voiceResponsesEnabled = true;
  input.value = "";
  addMessage("user", answer);
  setState("planning");
  showTyping();
  try {
    const result = await api(`/api/plan/${taskId}/clarify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    handlePlanningResult(result);
  } catch (error) {
    fail(error.message);
  }
}

async function executeTask() {
  setState("executing");
  const message = addMessage("bot", "Submitting the approved task.");
  speakResponse("Submitting the approved task.");
  progressCard = document.querySelector("#progress-template").content.firstElementChild.cloneNode(true);
  progressCard.querySelector(".stop-button").addEventListener("click", stopTask);
  message.querySelector(".message-body").append(progressCard);
  try {
    const result = await api("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, approvalToken }),
    });
    runId = result.id;
    pollRun();
  } catch (error) {
    fail(error.message);
  }
}

async function pollRun() {
  try {
    const run = await api(`/api/runs/${runId}`);
    if (run.state === "completed") return complete(run.completion);
    if (run.state === "failed" || run.state === "cancelled") {
      return fail(run.error || "Stopped by the user.");
    }
    if (run.state === "verifying" || run.stage === "Checking result") setState("verifying");
    const title = progressCard?.querySelector(".progress-title");
    if (title) title.textContent = run.stage || "Bolo is working…";
    renderProgressSteps(run.steps);
    pollTimer = setTimeout(pollRun, 900);
  } catch (error) {
    fail(`Lost contact with the task. ${error.message}`);
  }
}

function renderProgressSteps(steps = {}) {
  const list = progressCard?.querySelector(".progress-steps");
  if (!list) return;
  list.replaceChildren();
  const ordered = (plan?.steps || [])
    .map((step) => steps[step.id] || {
      id: step.id,
      title: step.title,
      state: "pending",
    });
  for (const step of ordered) {
    const item = document.createElement("li");
    item.dataset.state = step.state;
    item.textContent = `${step.state === "verified" ? "✓" : step.state === "executing" ? "●" : "○"} ${step.title}`;
    list.append(item);
  }
  list.hidden = ordered.length < 2;
}

async function stopTask() {
  progressCard?.querySelector(".stop-button").setAttribute("disabled", "");
  if (runId) {
    try { await api(`/api/runs/${runId}/stop`, { method: "POST" }); } catch {}
  }
  fail("Stopped. Bolo did not claim completion.");
}

function complete(completionText) {
  setState("completed");
  progressCard?.querySelector(".stop-button").setAttribute("disabled", "");
  progressCard?.querySelector(".spinner")?.remove();
  const title = progressCard?.querySelector(".progress-title");
  if (title) title.textContent = "Task complete";
  const message = addMessage("bot");
  const result = document.querySelector("#result-template").content.firstElementChild.cloneNode(true);
  result.querySelector(".result-title").textContent = plan.title;
  result.querySelector(".result-copy").textContent = completionText || "The final result was verified.";
  message.querySelector(".message-body").append(result);
  speakResponse(completionText || "The final result was verified.");
}

function fail(message) {
  hideTyping();
  setState("failed");
  progressCard?.querySelector(".stop-button").setAttribute("disabled", "");
  const response = friendlyError(message);
  addMessage("bot", response);
  speakResponse(response);
}

function resetTask(showMessage = false, message = "") {
  stopSpeech();
  voiceResponsesEnabled = false;
  clearTimeout(pollTimer);
  taskId = "";
  plan = null;
  approvalToken = "";
  runId = "";
  progressCard = null;
  chatLog.replaceChildren();
  conversation.hidden = true;
  window.boloDesktop?.setExpanded(false);
  input.value = "";
  setState("idle");
  if (showMessage && message) addMessage("bot", message);
  input.focus();
}

async function startRecording() {
  try {
    recordingContext = state;
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = ["audio/webm;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(mediaStream, preferred ? { mimeType: preferred } : {});
    audioChunks = [];
    discardRecording = false;
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) audioChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      if (discardRecording) setState("idle");
      else transcribeRecording();
    }, { once: true });
    mediaRecorder.start();
    recordingStartedAt = Date.now();
    recordingTime.textContent = "0:00";
    recordingInterval = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
      recordingTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }, 500);
    recordingBar.hidden = false;
    setState("recording");
  } catch (error) {
    fail(error.name === "NotAllowedError"
      ? "Microphone access is off. Allow it in System Settings or type the task."
      : `The microphone could not start: ${error.message}`);
  }
}

function finishRecording(discard = false) {
  if (mediaRecorder?.state !== "recording") return;
  discardRecording = discard;
  clearInterval(recordingInterval);
  recordingBar.hidden = true;
  mediaRecorder.stop();
  mediaStream?.getTracks().forEach((track) => track.stop());
  if (!discard) {
    setState("transcribing");
    showTyping();
  }
}

async function transcribeRecording() {
  try {
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    if (!blob.size) throw new Error("No audio was recorded.");
    const form = new FormData();
    form.append("audio", blob, "bolo-recording");
    const result = await api("/api/transcribe", { method: "POST", body: form });
    hideTyping();
    if (recordingContext === "clarifying") {
      await submitClarification(result.transcript, { fromVoice: true });
    } else {
      await submitTask(result.transcript, { fromVoice: true });
    }
  } catch (error) {
    fail(`I couldn’t understand the recording. ${friendlyError(error.message)}`);
  }
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state === "clarifying") submitClarification(input.value);
  else if (["idle", "completed", "failed"].includes(state)) submitTask(input.value);
});
input.addEventListener("input", updateComposer);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state !== "executing" && state !== "verifying") resetTask();
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && state === "reviewing") {
    document.querySelector(".confirm-button:not(:disabled)")?.click();
  }
});
micButton.addEventListener("click", startRecording);
newTaskButton.addEventListener("click", () => resetTask());
recordingCancel.addEventListener("click", () => finishRecording(true));
recordingDone.addEventListener("click", () => finishRecording(false));
window.addEventListener("focus", () => input.focus());
window.boloDesktop?.onFocusCommand(() => input.focus());

setState("idle");
