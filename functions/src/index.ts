import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Groq from 'groq-sdk';

admin.initializeApp();

const groq = new Groq({
  apiKey: functions.config().groq?.key ?? process.env['GROQ_API_KEY'] ?? ''
});

const TEXT_MODEL   = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ============================================================
// Auth Middleware
// ============================================================
async function verifyToken(req: functions.https.Request): Promise<admin.auth.DecodedIdToken> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    throw new functions.https.HttpsError('unauthenticated', 'Missing token');
  }
  const token = auth.split('Bearer ')[1];
  return admin.auth().verifyIdToken(token);
}

// ============================================================
// CORS helper
// ============================================================
function setCors(res: functions.Response): void {
  res.set('Access-Control-Allow-Origin',  '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ============================================================
// extractTasks — Parse plain text → structured tasks
// ============================================================
export const extractTasks = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const user = await verifyToken(req);
    const { text, categories, userTimezone } = req.body as {
      text: string;
      categories: Array<{ id: string; name: string; keywords?: string[] }>;
      userTimezone: string;
    };

    if (!text) { res.status(400).json({ error: 'text required' }); return; }

    const today = new Date().toLocaleDateString('en-US', { timeZone: userTimezone });
    const categoryList = categories.map(c => `- ${c.name} (id: ${c.id}, keywords: ${(c.keywords ?? []).join(', ')})`).join('\n');

    const completion = await groq.chat.completions.create({
      model:      TEXT_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content: `You are a task extraction AI. Extract structured tasks from user input.
Always respond with valid JSON only, no markdown code blocks, no explanation.

Today's date: ${today} (timezone: ${userTimezone})

Available categories:
${categoryList}

For each task, output:
{
  "tasks": [
    {
      "title": "string (required, concise)",
      "description": "string (optional, extra details)",
      "priority": "low|medium|high|urgent",
      "startDate": "YYYY-MM-DD or null",
      "dueDate": "YYYY-MM-DD or null",
      "dueTime": "HH:mm or null",
      "estimatedHours": number or null,
      "categoryId": "category id from list or null",
      "tags": ["string"],
      "confidence": 0.0-1.0,
      "schedulingSuggestion": "string or null"
    }
  ]
}

Rules:
- Extract multiple tasks if the input contains multiple items
- Infer priority from urgency words: "urgent"/"ASAP"→urgent, "important"/"critical"→high, "should"→medium, "maybe"→low
- Estimate hours based on task complexity
- Detect relative dates ("tomorrow"→date, "next Monday"→date, "in 3 days"→date)
- If no due date is mentioned, return null
- Match category by keywords and context`
        },
        { role: 'user', content: text }
      ]
    });

    const raw = completion.choices[0].message.content ?? '{}';
    let parsed: { tasks: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { tasks: [] };
    }

    await admin.firestore()
      .collection('usage')
      .add({ userId: user.uid, type: 'extract', createdAt: admin.firestore.FieldValue.serverTimestamp() });

    res.json({ tasks: parsed.tasks });
  } catch (err) {
    console.error('extractTasks error:', err);
    res.status(500).json({ error: 'AI extraction failed' });
  }
});

// ============================================================
// extractTasksFromImage — Vision + extraction from image
// ============================================================
export const extractTasksFromImage = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    await verifyToken(req);
    const { base64Image, mimeType, categories } = req.body as {
      base64Image: string;
      mimeType:    string;
      categories:  Array<{ id: string; name: string; keywords?: string[] }>;
    };

    const categoryList = categories.map(c => `- ${c.name} (id: ${c.id})`).join('\n');
    const today = new Date().toISOString().split('T')[0];

    const completion = await groq.chat.completions.create({
      model:      VISION_MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type:      'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` }
          },
          {
            type: 'text',
            text: `Extract all tasks, to-do items, deadlines, or action items from this image.
Today: ${today}
Available categories:\n${categoryList}

Respond with JSON only:
{"tasks": [{"title":"string","description":"string","priority":"low|medium|high","dueDate":"YYYY-MM-DD or null","estimatedHours":null,"categoryId":"id or null","confidence":0.0-1.0}]}`
          }
        ]
      }]
    });

    const raw = completion.choices[0].message.content ?? '{}';
    let parsed: { tasks: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { tasks: [] };
    }

    res.json({ tasks: parsed.tasks });
  } catch (err) {
    console.error('extractTasksFromImage error:', err);
    res.status(500).json({ error: 'Image extraction failed' });
  }
});

// ============================================================
// chat — Conversational task management
// ============================================================
export const chat = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const user = await verifyToken(req);
    const { messages, userContext } = req.body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      userContext: {
        totalTasks:   number;
        overdueTasks: number;
        todayTasks:   number;
        categories:   Array<{ id: string; name: string }>;
        timezone:     string;
      };
    };

    const categoryList = userContext.categories.map(c => `- ${c.name} (${c.id})`).join('\n');
    const today = new Date().toLocaleDateString('en-US', { timeZone: userContext.timezone });

    const systemPrompt = `You are TaskPilot AI. Today: ${today}, timezone: ${userContext.timezone}.
Tasks: ${userContext.totalTasks} total, ${userContext.overdueTasks} overdue, ${userContext.todayTasks} today.
Categories:
${categoryList}

RULES:
- Respond with exactly ONE JSON object. No markdown, no extra text.
- Use "intents" array to perform multiple actions in sequence.
- For categoryId: use ONLY ids from the categories list above. If the category doesn't exist yet and needs to be created, list create_category FIRST in intents (before create_task), and set categoryId to "__new__" in tasks that belong to it.
- For pure conversation/questions (no actions), omit "intents".

Schema:
{
  "message": "human-friendly summary of what you are doing",
  "intents": [
    {"action":"create_category","entities":{"name":"string","icon":"emoji","color":"#hex"}},
    {"action":"create_task","entities":{"title":"string","priority":"low|medium|high|urgent","dueDate":"YYYY-MM-DD or null","categoryId":"id-or-__new__-or-null"}},
    {"action":"move_tasks","entities":{"daysOffset":1,"categoryIds":[]}},
    {"action":"complete_tasks","entities":{"categoryIds":[]}}
  ]
}

Be concise, friendly, and actionable. Never make up task data.`;

    const completion = await groq.chat.completions.create({
      model:      TEXT_MODEL,
      max_tokens: 1024,
      messages:   [{ role: 'system', content: systemPrompt }, ...messages]
    });

    const rawText = completion.choices[0].message.content ?? '{}';
    let parsed: { message: string; intents?: unknown };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { message: rawText };
    }

    await admin.firestore()
      .collection('usage')
      .add({ userId: user.uid, type: 'chat', createdAt: admin.firestore.FieldValue.serverTimestamp() });

    res.json(parsed);
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// ============================================================
// generateInsights — AI analytics insights
// ============================================================
export const generateInsights = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const user = await verifyToken(req);
    const { stats } = req.body as {
      stats: {
        tasksByCategory:   Record<string, number>;
        completionRates:   Record<string, number>;
        delayPatterns:     Record<string, number>;
        overdueCount:      number;
        tomorrowTaskCount: number;
        streak:            number;
      };
    };

    const completion = await groq.chat.completions.create({
      model:      TEXT_MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Analyze these productivity stats and generate 2-3 concise, actionable insights.

Stats:
- Tasks by category: ${JSON.stringify(stats.tasksByCategory)}
- Completion rates: ${JSON.stringify(stats.completionRates)}
- Delay patterns (avg days late): ${JSON.stringify(stats.delayPatterns)}
- Overdue tasks: ${stats.overdueCount}
- Tasks due tomorrow: ${stats.tomorrowTaskCount}
- Current streak: ${stats.streak} days

Respond with JSON only:
{
  "insights": [
    {
      "type": "overbooked|delay_pattern|completion_trend|category_imbalance|missed_tasks|workload_warning",
      "title": "Short title",
      "body": "1-2 sentence insight with specific numbers",
      "severity": "info|warning|critical"
    }
  ]
}`
      }]
    });

    const raw = completion.choices[0].message.content ?? '{}';
    let parsed: { insights: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { insights: [] };
    }

    const batch = admin.firestore().batch();
    for (const insight of parsed.insights as Array<{ type: string; title: string; body: string; severity: string }>) {
      const ref = admin.firestore().collection('insights').doc();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      batch.set(ref, {
        ...insight,
        userId:    user.uid,
        icon:      getInsightIcon(insight.type),
        read:      false,
        dismissed: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt)
      });
    }
    await batch.commit();

    res.json(parsed);
  } catch (err) {
    console.error('generateInsights error:', err);
    res.status(500).json({ error: 'Insights generation failed' });
  }
});

// ============================================================
// suggestSchedule — AI scheduling suggestions
// ============================================================
export const suggestSchedule = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    await verifyToken(req);
    const { tasks, availableSlots, preferences } = req.body as {
      tasks: Array<{ id: string; title: string; estimatedHours: number; priority: string; dueDate?: string }>;
      availableSlots: Array<{ start: string; end: string }>;
      preferences: { workingHours: { start: string; end: string }; timezone: string };
    };

    const completion = await groq.chat.completions.create({
      model:      TEXT_MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Create an optimal schedule for these tasks:

Tasks to schedule:
${tasks.map(t => `- [${t.id}] "${t.title}" (${t.estimatedHours}h, ${t.priority} priority${t.dueDate ? `, due ${t.dueDate}` : ''})`).join('\n')}

Available time slots:
${availableSlots.map(s => `- ${s.start} to ${s.end}`).join('\n')}

Working hours: ${preferences.workingHours.start}–${preferences.workingHours.end}
Timezone: ${preferences.timezone}

Rules:
- Schedule high priority tasks first
- Respect due dates (schedule before, not on)
- Leave buffer time between tasks
- Prefer focused time blocks (no fragmentation)

Respond with JSON only:
{
  "schedule": [
    {
      "taskId": "string",
      "suggestedStart": "ISO 8601 datetime",
      "suggestedEnd": "ISO 8601 datetime",
      "reason": "brief explanation"
    }
  ]
}`
      }]
    });

    const raw = completion.choices[0].message.content ?? '{}';
    let parsed: { schedule: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { schedule: [] };
    }

    res.json(parsed);
  } catch (err) {
    console.error('suggestSchedule error:', err);
    res.status(500).json({ error: 'Schedule suggestion failed' });
  }
});

// ============================================================
// transformText — writing assistant used by the notes editor
// ============================================================
export const transformText = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const user = await verifyToken(req);
    const { instruction, text } = req.body as { instruction: string; text: string };
    if (!text) { res.status(400).json({ error: 'text required' }); return; }

    const completion = await groq.chat.completions.create({
      model:      TEXT_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `You are a writing assistant embedded in a notes editor. ${instruction}
Return ONLY the resulting text — no preamble, no surrounding quotes, no markdown code fences, no explanation.`
        },
        { role: 'user', content: text }
      ]
    });

    const out = (completion.choices[0].message.content ?? '')
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    await admin.firestore()
      .collection('usage')
      .add({ userId: user.uid, type: 'transform', createdAt: admin.firestore.FieldValue.serverTimestamp() });

    res.json({ text: out });
  } catch (err) {
    console.error('transformText error:', err);
    res.status(500).json({ error: 'Text transform failed' });
  }
});

// ============================================================
// joinGroup — redeem an invite token and add caller to the group
// (server-side because membership rules forbid a non-owner self-add)
// ============================================================
export const joinGroup = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const user = await verifyToken(req);
    const { token } = req.body as { token: string };
    if (!token) { res.status(400).json({ error: 'token required' }); return; }

    const db = admin.firestore();

    const result = await db.runTransaction(async (tx) => {
      // ---- Reads first (Firestore transaction requirement) ----
      const inviteRef  = db.collection('invites').doc(token);
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'This invite link is invalid.');
      }
      const invite = inviteSnap.data() as {
        groupId:  string;
        role:     'editor' | 'viewer';
        revoked:  boolean;
        maxUses:  number | null;
        useCount: number;
        expiresAt: admin.firestore.Timestamp | null;
      };

      if (invite.revoked) {
        throw new functions.https.HttpsError('failed-precondition', 'This invite has been revoked.');
      }
      if (invite.expiresAt && invite.expiresAt.toMillis() < Date.now()) {
        throw new functions.https.HttpsError('failed-precondition', 'This invite link has expired.');
      }
      if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
        throw new functions.https.HttpsError('failed-precondition', 'This invite link has already been used.');
      }

      const groupRef  = db.collection('groups').doc(invite.groupId);
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'That group no longer exists.');
      }
      const group = groupSnap.data() as {
        name: string; icon: string;
        memberIds: string[];
        roles: Record<string, string>;
      };

      const alreadyMember = (group.memberIds ?? []).includes(user.uid);

      const profileSnap = await tx.get(db.collection('users').doc(user.uid));
      const profile = profileSnap.data() as { displayName?: string; photoURL?: string | null } | undefined;
      const displayName = profile?.displayName ?? user.name ?? user.email ?? 'Member';
      const photoURL    = profile?.photoURL ?? user.picture ?? null;

      // ---- Writes ----
      if (!alreadyMember) {
        tx.update(groupRef, {
          memberIds: admin.firestore.FieldValue.arrayUnion(user.uid),
          [`roles.${user.uid}`]:          invite.role,
          [`memberProfiles.${user.uid}`]: { displayName, photoURL },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        tx.update(inviteRef, { useCount: admin.firestore.FieldValue.increment(1) });
      }

      return {
        groupId:     invite.groupId,
        groupName:   group.name,
        groupIcon:   group.icon,
        role:        alreadyMember ? (group.roles[user.uid] ?? invite.role) : invite.role,
        memberCount: (group.memberIds ?? []).length + (alreadyMember ? 0 : 1),
        alreadyMember
      };
    });

    await admin.firestore()
      .collection('usage')
      .add({ userId: user.uid, type: 'join_group', createdAt: admin.firestore.FieldValue.serverTimestamp() });

    res.json(result);
  } catch (err) {
    if (err instanceof functions.https.HttpsError) {
      const statusByCode: Record<string, number> = {
        'unauthenticated':     401,
        'not-found':           404,
        'failed-precondition': 409
      };
      res.status(statusByCode[err.code] ?? 400).json({ error: err.message });
      return;
    }
    console.error('joinGroup error:', err);
    res.status(500).json({ error: 'Could not join the group.' });
  }
});

// ============================================================
// Scheduled: clean up expired insights
// ============================================================
export const cleanupExpiredInsights = functions.pubsub.schedule('every 24 hours').onRun(async () => {
  const now = admin.firestore.Timestamp.now();
  const snap = await admin.firestore()
    .collection('insights')
    .where('expiresAt', '<', now)
    .get();

  const batch = admin.firestore().batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  console.log(`Deleted ${snap.size} expired insights`);
});

function getInsightIcon(type: string): string {
  const icons: Record<string, string> = {
    overbooked:         '🔥',
    delay_pattern:      '⏰',
    completion_trend:   '📈',
    category_imbalance: '⚖️',
    missed_tasks:       '⚠️',
    workload_warning:   '🚨',
    focus_time:         '🎯',
    peak_productivity:  '⚡'
  };
  return icons[type] ?? '💡';
}
