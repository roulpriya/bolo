import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildTaskPlan,
  buildMultiStepTaskPlan,
  completionText,
  confirmationText,
  executorLabel,
} from "../src/planner.js";
import {
  buildBrowserTask,
  buildComputerTask,
  buildYouTubeResolverTask,
  createActiveTask,
  handoffResolvedYouTubeVideo,
  isYouTubeHomeRequest,
  parseYouTubeVideoQuery,
  parseWebsiteOpenRequest,
  understandTask,
  validateYouTubeWatchUrl,
} from "../src/bolo-agent.js";
import {
  buildBrowserSearchUrl,
  buildCalendarAppleEvent,
  buildNoteAppleEvent,
  buildOpenApplicationEvent,
  buildReminderAppleEvent,
  safeFinderPath,
} from "../src/local-actions.js";

test("builds a general Browser Use plan", () => {
  const plan = buildTaskPlan({
    status: "ready",
    executor: "browser",
    title: "Find local weather",
    task: "Find today's weather in Bhubaneswar and show the result.",
    application: "Weather website",
    clarificationQuestion: null,
  });

  assert.equal(plan.goal, "perform_task");
  assert.equal(plan.executor, "browser");
  assert.equal(plan.application, "Weather website");
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.successCriteria.length, 3);
});

test("builds a general Computer Use plan", () => {
  const plan = buildTaskPlan({
    status: "ready",
    executor: "computer",
    title: "Calculate result",
    task: "Open Calculator and calculate 1250 divided by 8.",
    application: "Calculator",
    clarificationQuestion: null,
  });

  assert.equal(plan.executor, "computer");
  assert.equal(executorLabel(plan), "Computer Use");
});

test("builds a dependency-aware multi-step plan", () => {
  const plan = buildMultiStepTaskPlan({
    title: "Research and open Calculator",
    task: "Search for the documentation, then open Calculator.",
    steps: [
      {
        id: "research",
        executor: "browser",
        action: "browser-search",
        details: { query: "OpenAI Responses API documentation" },
        title: "Find documentation",
        task: "Search for the official OpenAI Responses API documentation.",
        application: "Default browser",
        dependsOn: [],
      },
      {
        id: "calculator",
        executor: "computer",
        action: "app-open",
        details: { application: "Calculator" },
        title: "Open Calculator",
        task: "Open Calculator.",
        application: "Calculator",
        dependsOn: ["research"],
      },
    ],
  });

  assert.equal(plan.executor, "orchestrator");
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps[1].dependsOn, ["research"]);
  assert.equal(plan.steps[0].capability, "local.browser.search");
  assert.equal(plan.steps[1].capability, "mac.application.open");
});

test("rejects incomplete or unknown executor plans", () => {
  assert.throws(
    () =>
      buildTaskPlan({
        status: "needs_clarification",
        executor: null,
        task: null,
      }),
    /complete task/i,
  );
  assert.throws(
    () =>
      buildTaskPlan({
        status: "ready",
        executor: "phone",
        task: "Make a call.",
      }),
    /complete task/i,
  );
});

test("confirmation presents the exact task and asks for review", () => {
  const plan = buildTaskPlan({
    status: "ready",
    executor: "browser",
    title: "Open documentation",
    task: "Open the OpenAI documentation.",
    application: "OpenAI website",
  });
  const text = confirmationText(plan);
  assert.match(text, /Open the OpenAI documentation/);
  assert.match(text, /review the details/i);
  assert.doesNotMatch(text, /Browser Use|Computer Use/);
});

test("completion uses visible verification evidence", () => {
  const text = completionText(
    { executor: "computer", title: "Open Notes" },
    {
      status: "verified",
      evidence: "Notes is open and a new blank note is visible.",
      confidence: 0.95,
    },
  );
  assert.equal(
    text,
    "Done. Notes is open and a new blank note is visible.",
  );
});

test("browser worker task preserves the confirmed instruction and safety boundary", () => {
  const task = buildBrowserTask({
    title: "Search flights",
    application: "Travel website",
    task: "Find flights from Delhi to Mumbai next Monday.",
  });
  assert.match(task, /Find flights from Delhi to Mumbai next Monday/);
  assert.match(task, /exactly that task and nothing unrelated/i);
  assert.match(task, /visibly inspect the final state/i);
});

test("YouTube resolver subagent gets a bounded video-search task", () => {
  const task = buildYouTubeResolverTask({
    details: { videoQuery: "Shape of You official music video" },
  });
  assert.match(task, /Shape of You official music video/);
  assert.match(task, /single best matching playable video/i);
  assert.match(task, /canonical HTTPS watch URL/i);
  assert.match(task, /Do not sign in, like, subscribe, comment/i);
});

test("YouTube handoff accepts only canonical watch URLs", () => {
  assert.equal(
    validateYouTubeWatchUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=untrusted",
    ),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  for (const url of [
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/redirect?q=https://evil.test",
    "https://www.youtube.com/watch?v=too-short",
    "javascript:alert(1)",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]) {
    assert.throws(() => validateYouTubeWatchUrl(url), /valid YouTube video/i);
  }
});

test("verified YouTube resolution opens one canonical local URL", async () => {
  const opened = [];
  const result = await handoffResolvedYouTubeVideo(
    {
      status: "verified",
      evidence: "The official video page was inspected.",
      confidence: 0.98,
      videoUrl:
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=untrusted",
      videoTitle: "Requested official video",
    },
    async (url, hosts) => opened.push({ url, hosts }),
  );
  assert.deepEqual(opened, [
    {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      hosts: ["youtube.com", "www.youtube.com"],
    },
  ]);
  assert.equal(result.status, "verified");
});

test("uncertain YouTube resolution never opens a local URL", async () => {
  let openCount = 0;
  await assert.rejects(
    () =>
      handoffResolvedYouTubeVideo(
        {
          status: "uncertain",
          evidence: "Two videos matched equally well.",
          confidence: 0.4,
          videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          videoTitle: "Uncertain match",
        },
        async () => {
          openCount += 1;
        },
      ),
    /matched equally well/i,
  );
  assert.equal(openCount, 0);
});

test("computer worker task preserves the confirmed instruction", () => {
  const task = buildComputerTask({
    title: "Open Calculator",
    application: "Calculator",
    task: "Open Calculator and calculate 4 multiplied by 12.",
  });
  assert.match(task, /Open Calculator and calculate 4 multiplied by 12/);
  assert.match(task, /visible macOS UI/i);
});

test("Apple Notes worker gets the state-gated keyboard fast path", () => {
  const task = buildComputerTask({
    title: "Make a shopping list",
    application: "Apple Notes",
    task: "Create a note named Shopping List with milk, bread, and eggs.",
  });
  assert.match(task, /Command-N/);
  assert.match(task, /each shopping\s+item on its own line/i);
  assert.match(task, /visually compare every requested item/i);
});

test("active tasks start without task-specific defaults", () => {
  const task = createActiveTask("task-1");
  assert.equal(task.plan, null);
  assert.deepEqual(task.context.answers, []);
  assert.equal(task.context.turns, 0);
});

test("five MVP actions plan locally without API keys", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const youtube = createActiveTask("youtube");
    youtube.transcript = "Open YouTube in the browser.";
    await understandTask(youtube, youtube.transcript);
    assert.equal(youtube.plan.action, "youtube");

    const notes = createActiveTask("notes");
    notes.transcript =
      "Open Apple Notes and create a note called Shopping List with milk, bread, eggs, bananas, and coffee.";
    await understandTask(notes, notes.transcript);
    assert.equal(notes.plan.action, "notes-shopping-list");
    assert.deepEqual(notes.plan.details.items, [
      "milk",
      "bread",
      "eggs",
      "bananas",
      "coffee",
    ]);

    const calendar = createActiveTask("calendar");
    calendar.transcript =
      "Create a Google Calendar invite for the Bolo demo tomorrow at 11 AM for 30 minutes.";
    await understandTask(calendar, calendar.transcript);
    assert.equal(calendar.plan.action, "google-calendar");
    assert.equal(calendar.plan.details.title, "Bolo demo");
    assert.equal(calendar.plan.details.durationMinutes, 30);

    const reminder = createActiveTask("reminder");
    reminder.transcript =
      "Add a reminder of medicine at 8 a.m. tomorrow.";
    await understandTask(reminder, reminder.transcript);
    assert.equal(reminder.plan.action, "apple-reminder");
    assert.equal(reminder.plan.details.title, "medicine");
    const due = new Date(reminder.plan.details.due);
    assert.equal(due.getHours(), 8);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(due.getDate(), tomorrow.getDate());

    const appleCalendar = createActiveTask("apple-calendar");
    appleCalendar.transcript =
      "Create a calendar invite for the Bolo demo tomorrow at 11 AM for 30 minutes in Work calendar and invite teammate@example.com.";
    await understandTask(appleCalendar, appleCalendar.transcript);
    assert.equal(appleCalendar.plan.action, "apple-calendar-event");
    assert.equal(appleCalendar.plan.details.calendar, "Work");
    assert.deepEqual(appleCalendar.plan.details.invitees, [
      "teammate@example.com",
    ]);
  } finally {
    if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  }
});

test("plans a direct ad-hoc browser search locally", async () => {
  const task = createActiveTask("browser-search");
  task.transcript = "Open browser and search for LinkedIn.";
  const result = await understandTask(task, task.transcript);
  assert.equal(result.status, "ready");
  assert.equal(task.plan.action, "browser-search");
  assert.equal(task.plan.details.query, "LinkedIn");
  assert.equal(
    buildBrowserSearchUrl(task.plan.details),
    "https://www.google.com/search?q=LinkedIn",
  );
});

test("collapses open-Google-and-search into one instant local step", async () => {
  for (const transcript of [
    "open google and search for best museum in blr",
    "open google and find museums in blr",
    "Open Google and look up best museum in Bengaluru",
    "Google par best museum in blr search karo",
  ]) {
    const task = createActiveTask(`google-search-${transcript}`);
    task.transcript = transcript;
    const result = await understandTask(task, transcript);
    assert.equal(result.status, "ready");
    assert.equal(task.plan.action, "browser-search");
    assert.equal(task.plan.steps.length, 1);
    assert.equal(task.plan.steps[0].capability, "local.browser.search");
    assert.equal(task.plan.steps[0].targetLatencyMs, 1_000);
    assert.doesNotMatch(task.plan.details.query, /^google\b/i);
  }
});

test("never treats an arbitrary open sentence as a macOS application", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const task = createActiveTask("not-an-application");
    task.transcript = "Open a completely imaginary workflow";
    await assert.rejects(
      () => understandTask(task, task.transcript),
      /OPENAI_API_KEY/,
    );
    assert.equal(task.plan, null);
  } finally {
    if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  }
});

test("opens common websites locally without Browser Use or model planning", async () => {
  const examples = new Map([
    ["Open Google", "https://www.google.com/"],
    ["Google kholo", "https://www.google.com/"],
    ["Open GitHub in the browser", "https://github.com/"],
    ["Open example.com", "https://example.com/"],
  ]);
  for (const [transcript, expectedUrl] of examples) {
    assert.equal(parseWebsiteOpenRequest(transcript)?.url, expectedUrl);
    const task = createActiveTask(`website-${transcript}`);
    task.transcript = transcript;
    const result = await understandTask(task, transcript);
    assert.equal(result.status, "ready");
    assert.equal(task.plan.action, "website-open");
    assert.equal(task.plan.details.url, expectedUrl);
    assert.equal(task.plan.steps[0].capability, "local.website.open");
  }
});

test("website fast path does not reinterpret local application requests", () => {
  assert.equal(parseWebsiteOpenRequest("Open Calculator app"), null);
  assert.equal(parseWebsiteOpenRequest("Open my quarterly report"), null);
});

test("recognizes YouTube homepage requests without invoking Browser Use", async () => {
  for (const transcript of [
    "Open YouTube",
    "Could you open YouTube for me?",
    "YouTube open karo",
    "Browser mein YouTube kholo",
    "यूट्यूब खोलिए।",
  ]) {
    assert.equal(isYouTubeHomeRequest(transcript), true, transcript);
    const task = createActiveTask(`youtube-${transcript}`);
    task.transcript = transcript;
    const result = await understandTask(task, transcript);
    assert.equal(result.status, "ready");
    assert.equal(task.plan.action, "youtube");
    assert.equal(task.plan.steps[0].capability, "local.youtube.open");
  }
});

test("does not treat a specific YouTube video request as homepage open", () => {
  assert.equal(
    isYouTubeHomeRequest("Play Shape of You on YouTube"),
    false,
  );
  assert.equal(
    isYouTubeHomeRequest("Open the latest Veritasium video on YouTube"),
    false,
  );
});

test("extracts common YouTube song requests for the fast resolver", async () => {
  const examples = new Map([
    ["Play Shape of You on YouTube", "Shape of You"],
    ["Open the Kesariya song in YouTube", "Kesariya"],
    ["Open YouTube and play Tum Hi Ho", "Tum Hi Ho"],
    ["YouTube par Kun Faya Kun chalao", "Kun Faya Kun"],
    ["यूट्यूब पर केसरिया चलाओ", "केसरिया"],
  ]);
  for (const [transcript, expected] of examples) {
    assert.equal(parseYouTubeVideoQuery(transcript), expected);
    const task = createActiveTask(`video-${transcript}`);
    task.transcript = transcript;
    const result = await understandTask(task, transcript);
    assert.equal(result.status, "ready");
    assert.equal(task.plan.action, "youtube-video");
    assert.equal(task.plan.details.videoQuery, expected);
  }
});

test("preserves a Hindi browser-search query through local execution details", async () => {
  const task = createActiveTask("hindi-browser-search");
  task.transcript = "ब्लाउजर में LinkedIn सर्च कीजिए।";
  const result = await understandTask(task, task.transcript);
  assert.equal(result.status, "ready");
  assert.equal(task.plan.action, "browser-search");
  assert.equal(task.plan.details.query, "LinkedIn");
});

test("plans a direct macOS application open command locally", async () => {
  const task = createActiveTask("app-open");
  task.transcript = "Open the Calculator app.";
  const result = await understandTask(task, task.transcript);
  assert.equal(result.status, "ready");
  assert.equal(task.plan.action, "app-open");
  assert.deepEqual(buildOpenApplicationEvent(task.plan.details), {
    type: "open",
    application: "Calculator",
  });
});

test("uses a reminder clarification answer instead of asking repeatedly", async () => {
  const task = createActiveTask("reminder-clarification");
  task.transcript = "Add a reminder at 8 AM.";
  const first = await understandTask(task, task.transcript);
  assert.equal(first.status, "needs_clarification");
  assert.match(first.clarificationQuestion, /reminder title/i);

  const second = await understandTask(task, "Medicine Reminder");
  assert.equal(second.status, "ready");
  assert.equal(task.plan.details.title, "Medicine Reminder");
});

test("extracts reminder title and time from a combined clarification", async () => {
  const task = createActiveTask("combined-reminder-clarification");
  task.transcript = "Reminder set kijiye.";
  const first = await understandTask(task, task.transcript);
  assert.equal(first.status, "needs_clarification");

  const second = await understandTask(task, "Medicine at 8 AM");
  assert.equal(second.status, "ready");
  assert.equal(task.plan.details.title, "Medicine");
  assert.equal(new Date(task.plan.details.due).getHours(), 8);
});

test("uses a shopping-list clarification answer instead of asking repeatedly", async () => {
  const task = createActiveTask("shopping-clarification");
  task.transcript = "Open Notes and add a shopping list.";
  const first = await understandTask(task, task.transcript);
  assert.equal(first.status, "needs_clarification");
  assert.match(first.clarificationQuestion, /which items/i);

  const second = await understandTask(task, "Add milk, orange, fruits.");
  assert.equal(second.status, "ready");
  assert.deepEqual(task.plan.details.items, ["milk", "orange", "fruits"]);
});

test("uses the default Apple Calendar when only duration is missing", async () => {
  const task = createActiveTask("calendar-clarification");
  task.transcript =
    "Create a calendar invite for running tomorrow at 8 AM.";
  const first = await understandTask(task, task.transcript);
  assert.equal(first.status, "needs_clarification");
  assert.equal(first.clarificationQuestion, "Please provide the duration.");

  const second = await understandTask(task, "30 minutes");
  assert.equal(second.status, "ready");
  assert.equal(task.plan.details.durationMinutes, 30);
  assert.equal(task.plan.details.calendar, "Calendar");
  assert.equal(task.plan.details.title, "running");
});

test("generates numbered titles for otherwise untitled calendar events", async () => {
  const task = createActiveTask("calendar-generated-title");
  task.transcript = "एक calendar invite सेट कीजिए for 8:00 AM.";
  const first = await understandTask(task, task.transcript);
  assert.equal(first.status, "needs_clarification");
  assert.equal(first.clarificationQuestion, "Please provide the duration.");
  const generatedTitle = task.context.slots.eventTitle;
  assert.match(generatedTitle, /^Event \d+$/);

  const second = await understandTask(task, "30 minutes");
  assert.equal(second.status, "ready");
  assert.equal(task.plan.details.title, generatedTitle);
  assert.equal(task.plan.details.durationMinutes, 30);
  assert.equal(task.plan.details.calendar, "Calendar");
});

test("uses the activity after 'event is for' as the event title", async () => {
  const task = createActiveTask("calendar-running-title");
  task.transcript =
    "Create a calendar event is for running tomorrow at 8 AM for 30 minutes.";
  const result = await understandTask(task, task.transcript);
  assert.equal(result.status, "ready");
  assert.equal(task.plan.details.title, "running");
  assert.equal(task.plan.details.calendar, "Calendar");
});

test("retains Hindi and Hinglish calendar details across clarifications", async () => {
  const task = createActiveTask("hinglish-calendar");
  task.transcript = "Running के लिए meeting set कीजिए।";
  const first = await understandTask(task, task.transcript);
  assert.equal(first.status, "needs_clarification");
  assert.doesNotMatch(first.clarificationQuestion, /event title/i);

  const second = await understandTask(task, "कल के लिए 8:30 बजे।");
  assert.equal(second.status, "needs_clarification");
  assert.match(second.clarificationQuestion, /AM or PM/i);
  assert.doesNotMatch(second.clarificationQuestion, /event title/i);

  const third = await understandTask(
    task,
    "सुबह, 30 मिनट, Work Calendar.",
  );
  assert.equal(third.status, "ready");
  assert.equal(task.plan.details.title, "Running");
  assert.equal(task.plan.details.durationMinutes, 30);
  assert.equal(task.plan.details.calendar, "Work");
  assert.equal(new Date(task.plan.details.start).getHours(), 8);
  assert.equal(new Date(task.plan.details.start).getMinutes(), 30);
});

test("builds an allowlisted Apple Event reminder action", () => {
  assert.deepEqual(
    buildReminderAppleEvent({
      title: "medicine",
      due: "2026-07-27T08:00:00+05:30",
    }),
    {
      type: "reminder.add",
      title: "medicine",
      list: null,
      due: "2026-07-27T02:30:00.000Z",
      notes: null,
      open: true,
    },
  );
  assert.throws(
    () => buildReminderAppleEvent({ title: "", due: "invalid" }),
    /title and valid due date/i,
  );
});

test("builds an allowlisted Apple Calendar event action", () => {
  assert.deepEqual(
    buildCalendarAppleEvent({
      title: "Bolo demo",
      calendar: "Work",
      start: "2026-07-28T11:00:00+05:30",
      durationMinutes: 30,
      invitees: ["teammate@example.com"],
    }),
    {
      type: "calendar.create",
      title: "Bolo demo",
      calendar: "Work",
      start: "2026-07-28T05:30:00.000Z",
      end: "2026-07-28T06:00:00.000Z",
      location: null,
      notes: null,
      invitees: ["teammate@example.com"],
      open: true,
    },
  );
  assert.throws(
    () =>
      buildCalendarAppleEvent({
        title: "Demo",
        calendar: "",
        start: "invalid",
        durationMinutes: 0,
      }),
    /calendar name/i,
  );
});

test("builds a structured Apple Notes action without generating script code", () => {
  assert.deepEqual(
    buildNoteAppleEvent({
      title: 'Shop "safely"',
      items: ["milk", '</div><script>alert("x")</script>'],
    }),
    {
      type: "note.shopping",
      title: 'Shop "safely"',
      items: ["milk", '</div><script>alert("x")</script>'],
      folder: null,
      open: true,
    },
  );
});

test("Finder scope permits workspace files and blocks system paths", async () => {
  assert.equal(
    await safeFinderPath(path.resolve("README.md")),
    path.resolve("README.md"),
  );
  await assert.rejects(() => safeFinderPath("/etc/hosts"), /allowed Finder scope/i);
});
