# WebSocket Health Debug Dashboard

A comprehensive developer tool for monitoring and debugging WebSocket connection health in the DeepL Voice API AWS Connect Demo application.

## Table of Contents

- [Overview](#overview)
- [What This Dashboard Measures](#what-this-dashboard-measures)
- [Enabling the Dashboard](#enabling-the-dashboard)
- [Dashboard Sections](#dashboard-sections)
  - [Connection Health Cards](#connection-health-cards)
  - [Configuration Override](#configuration-override)
  - [Reconnection History](#reconnection-history)
  - [Raw Data Inspector](#raw-data-inspector)
- [Connection States Explained](#connection-states-explained)
- [VAD-Aware Zombie Detection](#vad-aware-zombie-detection)
- [Troubleshooting](#troubleshooting)
- [Advanced Usage](#advanced-usage)

---

## Overview

The Debug Dashboard provides real-time visibility into **WebSocket connection liveness** for both **Agent** and **Customer** connections to the DeepL Voice API.

### What It Does

- ✅ **Detects zombie connections** (TCP open but no data flowing)
- ✅ **Monitors message flow** with color-coded indicators
- ✅ **Tracks connection health** over time (60-second history)
- ✅ **Tunes detection thresholds** for optimal reconnection timing
- ✅ **Exports diagnostic data** for troubleshooting

### What It Does NOT Do

- ❌ **Measure translation quality** (accuracy, fluency)
- ❌ **Measure audio quality** (clarity, fidelity)
- ❌ **Measure end-to-end latency** (that's tracked by `AudioLatencyTrackManager`)

### Key Features

- **VAD-aware adaptive zombie detection** (10s timeout during speech, 60s during silence)
- **Real-time message freshness visualization** (color-coded timeline)
- **Exponential backoff reconnection** with configurable thresholds
- **Persistent configuration** across page reloads
- **Zero production impact** (debug-only code, dynamic import)

---

## What This Dashboard Measures

### Connection Liveness (Message Freshness)

**Primary Metric:** Time since last WebSocket message received

**Message Types Counted:**
- ✅ Source transcriptions (agent's speech transcribed) - arrives ~300ms
- ✅ Target transcriptions (translated text) - arrives ~800ms
- ✅ Target media chunks (synthesized audio) - arrives ~1500ms+
- ✅ End-of-stream messages
- ✅ Error messages
- ✅ **ANY** WebSocket message

**Important:** The dashboard measures **connection liveness**, not translation performance:

```
When Agent Speaks:
  Agent → Audio sent to DeepL
       ↓
  ~300ms: Transcription message → Customer receives ✓
  ~800ms: Translation message → Customer receives ✓
  ~1500ms: Audio chunk 1 → Customer receives ✓
  ~1700ms: Audio chunk 2 → Customer receives ✓

Result: Customer's "Last Message" stays < 300ms
        Customer status: 🟢 Healthy
```

**Key Insight:** Even when the customer isn't speaking, they should receive messages (translations from the agent). If a listener shows "Slow" or "Degrading" while the speaker is active, that's a real problem (translation pipeline delay or network issue).

---

## Enabling the Dashboard

### Method 1: URL Parameter
Add `?debug=true` to the application URL:
```
https://your-app.example.com/?debug=true
```

### Method 2: Browser Console
```javascript
// Check if debug mode is active
isDebugMode(); // Should return true

// Manually enable (if needed)
localStorage.setItem('debugMode', 'true');
location.reload();
```

### Verification
When enabled, console shows:
```
🔧 Debug mode enabled - loading health dashboard...
✅ Debug dashboard loaded successfully
💡 Access via: window.debugDashboard
```

**Collapsed Dashboard:**
```
┌──────────────────────────────────────────────────────────┐
│ 🔧 WebSocket Health Monitor (Debug)  Customer ● | Agent ● │
└──────────────────────────────────────────────────────────┘
```

**Click anywhere on the bar** to expand/collapse.

---

## Dashboard Sections

### Connection Health Cards

Side-by-side monitoring for **Agent** and **Customer** WebSocket connections.

#### Metrics Displayed

| Metric | What It Shows | Hover Tooltip (ℹ️) |
|--------|---------------|---------------------|
| **Status Badge** | Current connection state | Healthy/Slow/Degrading/Dead/Reconnecting/Not Connected |
| **Last Message** | Time since any WebSocket message received | "Time since last WebSocket message received (any type: transcription, translation, or audio). This measures connection liveness, not translation quality." |
| **Zombie Threshold** | Current timeout before declaring dead | "How long we wait without receiving ANY WebSocket message before declaring the connection dead and triggering reconnection." |
| **VAD State** | Voice activity detection | 🎤 Speaking (pulsing) or 🔇 Silent (static) |
| **Uptime** | Time since connection established | Resets on reconnection |
| **Messages** | Total WebSocket messages received | Cumulative count |
| **Errors** | Total WebSocket errors | Should be 0 or very low |
| **Message Freshness History** | 60-second visual timeline | Color-coded blocks showing message gaps |

---

#### Message Freshness History (Timeline)

Visual timeline showing how recently WebSocket messages were received:

```
Message Freshness History (Last 60 Seconds)
▇▇▇▇▇▇▇▆▅▇▇▇▇▇▇▇▇▇▇▇
└─ 60s ago    └─ Now
```

**Each block = 3 seconds** (20 blocks = 60 seconds total)

**Color Meanings:**

| Color | Block | State | Time Since Last Message |
|-------|-------|-------|------------------------|
| 🟢 Green | ▇ | **Healthy** | < 3 seconds |
| 🟡 Yellow | ▆ | **Slow** | 3-5 seconds |
| 🟠 Orange | ▅ | **Degrading** | 5-10 seconds |
| 🔴 Red | ▄ | **Dead** | > Zombie threshold (10s/60s) |
| 🔵 Blue | ▃ | **Reconnecting** | In reconnection flow |
| ⚪ Gray | ▂ | **Not Connected** | WebSocket closed/offline |

**Example Interpretations:**

**Healthy connection:**
```
▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ ✅ All green - messages flowing steadily
```

**Brief hiccup, recovered:**
```
▇▇▇▇▇▇▆▅▄▅▆▇▇▇▇▇▇▇▇▇ ⚠️ Temporary degradation, self-recovered
```

**Reconnection event:**
```
▇▇▇▇▇▄▄▄▃▃▃▇▇▇▇▇▇▇▇▇ 🔄 Dead → Reconnecting → Recovered (~12s)
```

**Progressive degradation:**
```
▇▇▇▇▇▆▆▆▅▅▅▄▄▄▄▄▄▄▄▄ ❌ Getting worse - reconnection imminent
```

**Recently connected:**
```
▂▂▂▂▂▂▂▂▂▂▂▂▇▇▇▇▇▇▇▇ 📶 Was offline, connected 24s ago
```

---

### Configuration Override

Adjust zombie detection thresholds in real-time for testing and optimization.

#### Speaking Timeout

**Default:** 10 seconds
**Range:** 5-30 seconds

**Description:**
"Trigger reconnection if no data received for this duration while speaking (5-30 seconds)"

**What It Means:**
Time to wait before declaring connection "dead" when user is actively speaking or recently spoke (within grace period).

**Tooltip:**
"Zombie detection timeout when user is actively speaking or recently spoke. Lower = faster detection but more false positives."

**Guidelines:**
- **5-7s:** Fast detection, risk of false positives if pipeline is slow
- **10s (default):** Balanced - recommended for most scenarios
- **15-30s:** Very tolerant, slower detection

---

#### Silent Timeout

**Default:** 60 seconds
**Range:** 20-120 seconds

**Description:**
"Trigger reconnection if no data received for this duration while silent (20-120 seconds)"

**What It Means:**
Time to wait before declaring connection "dead" when user is completely silent (no speech detected for > grace period).

**Tooltip:**
"Zombie detection timeout during silence. Higher = fewer false positives during natural pauses in conversation."

**Why So Long?**
During silence, there's **legitimately no data** to send/receive. A long timeout prevents unnecessary reconnections during conversation pauses.

**Guidelines:**
- **20-30s:** Faster detection, may interrupt during pauses
- **60s (default):** Prevents false positives - recommended
- **90-120s:** Very conservative, for debugging only

---

#### Grace Period

**Default:** 5 seconds
**Range:** 2-10 seconds

**Description:**
"Keep using speaking timeout for this duration after speech ends (2-10 seconds)"

**What It Means:**
Time after speech ends where the **speaking timeout** still applies instead of switching to silent timeout.

**Tooltip:**
"Time after speech ends where fast timeout still applies. Accounts for translation pipeline latency."

**Why It Exists:**
Translation has latency. Even after user stops speaking, responses may still arrive for several seconds as audio is processed, transcribed, translated, and synthesized.

**Example:**
```
User speaks:     [==========]
Grace period:                [----]
Timeout used:    10s  10s   10s 60s 60s...
                 └─ Speaking ─┘└─ Silent ─┘
```

**Guidelines:**
- **2-3s:** Very low-latency pipelines
- **5s (default):** Standard latency - recommended
- **7-10s:** High-latency or overloaded systems

---

#### Persistent Configuration

All settings are **automatically saved** to `localStorage` and persist across:
- Page refreshes
- Browser restarts
- Application updates

**Reset to Defaults:** Click "Reset to Defaults" button to restore:
- Speaking Timeout: 10s
- Silent Timeout: 60s
- Grace Period: 5s

---

### Reconnection History

Shows the last 5 reconnection events across both connections.

**Format:**
```
📊 Reconnection History (Last 5)
• 2m ago - Customer - 1 attempt - 1.2s - ✅ Success
• 8m ago - Agent - 2 attempts - 3.1s - ✅ Success
• 15m ago - Customer - 5 attempts - 31.0s - ❌ Failed
```

**Fields:**

| Field | Description |
|-------|-------------|
| **Time** | Relative time since reconnection occurred |
| **Connection** | "Customer" or "Agent" |
| **Attempts** | Number of reconnection attempts with exponential backoff |
| **Duration** | Total time from first attempt to final outcome |
| **Status** | ✅ Success or ❌ Failed (max attempts reached) |

**Interpreting Results:**

**✅ Single attempt success:**
```
• 2m ago - Customer - 1 attempt - 1.2s - ✅ Success
```
Ideal - reconnection succeeded immediately.

**⚠️ Multiple attempts:**
```
• 8m ago - Agent - 3 attempts - 7.1s - ✅ Success
```
Took 3 attempts with exponential backoff (1s + 2s + 4s = 7s). May indicate network instability.

**❌ Failed reconnection:**
```
• 15m ago - Customer - 5 attempts - 31.0s - ❌ Failed
```
Max attempts (5) reached. User must manually reload page.

**✅ No history:**
```
No reconnections yet
```
Connection has been stable since session started.

---

### Raw Data Inspector

Expandable section showing real-time JSON from `getConnectionHealth()` for both connections.

**Features:**
- Syntax-highlighted JSON
- Updates every second
- Copy-paste friendly for bug reports
- Shows internal data structure

**When to Use:**
- Reporting bugs with detailed diagnostics
- Understanding internal data format
- Verifying metric calculations
- Debugging custom integrations

**Example Output:**
```json
{
  "type": "customer",
  "quality": "good",
  "timeSinceLastMessage": 234,
  "isReconnecting": false,
  "reconnectAttempts": 0,
  "stats": {
    "totalMessages": 1247,
    "totalErrors": 0,
    "uptime": 332450,
    "reconnectionCount": 1,
    "reconnections": [...],
    "qualityHistory": [...]
  },
  "config": {...}
}
```

---

## Connection States Explained

The system tracks connection health using 6 distinct states based on **time since last WebSocket message received**:

### State Definitions

| State | Trigger | What It Means | Dashboard Display |
|-------|---------|---------------|-------------------|
| **Healthy** | < 3s since last message | Messages arriving frequently, connection alive | 🟢 Green |
| **Slow** | 3-5s since last message | Slight gap in message flow, monitoring | 🟡 Yellow |
| **Degrading** | 5-10s since last message | Significant gap, approaching zombie threshold | 🟠 Orange |
| **Dead** | > Zombie threshold | No messages, zombie detected, reconnecting | 🔴 Red |
| **Reconnecting** | In reconnection flow | Attempting to reconnect with backoff | 🔵 Blue |
| **Not Connected** | WebSocket closed | Connection terminated or not established | ⚪ Gray |

---

### Detailed State Descriptions

#### 🟢 Healthy (< 3s)

**Status:** Optimal
**Action:** None required

**What's Happening:**
- WebSocket messages arriving at least every 3 seconds
- Could be transcriptions, translations, or audio chunks
- Connection is alive and processing data normally

**When You See This:**
- ✅ During active speech (agent or customer talking)
- ✅ Shortly after speech (pipeline still processing)
- ✅ Normal operating state

---

#### 🟡 Slow (3-5s gap)

**Status:** Acceptable, but monitoring
**Action:** Watch for improvement or degradation

**What's Happening:**
- Small gap in message flow (3-5 seconds since last message)
- Not critical yet, may be temporary

**When You See This:**
- ⚠️ Brief pause in conversation (both silent for a few seconds)
- ⚠️ Slight delay in translation pipeline
- ⚠️ Minor network congestion

**Expected:** Occasional yellow during conversation pauses is normal.

---

#### 🟠 Degrading (5-10s gap)

**Status:** Warning
**Action:** Monitor closely

**What's Happening:**
- Significant gap in message flow (5-10 seconds)
- Approaching zombie threshold
- May trigger reconnection soon

**When You See This:**
- ⚠️ Extended silence (both parties not speaking)
- ⚠️ Translation pipeline severely delayed
- ⚠️ Network issues causing dropped packets

**If Prolonged:** Likely indicates a problem that will trigger reconnection.

---

#### 🔴 Dead (> Threshold)

**Status:** Critical
**Action:** Automatic reconnection triggered

**What's Happening:**
- No WebSocket messages for 10s (speaking) or 60s (silent)
- Zombie connection detected
- System automatically attempting reconnection with exponential backoff

**When You See This:**
- ❌ Server stopped responding (service outage)
- ❌ Network completely interrupted (WiFi dropped, VPN disconnected)
- ❌ WebSocket hung (TCP open but no data flowing)

**Recovery:** Automatic reconnection in progress. Will show "Reconnecting" state.

---

#### 🔵 Reconnecting

**Status:** Recovery in progress
**Action:** Wait for completion

**What's Happening:**
- Executing reconnection with exponential backoff
- Attempts: 1s → 2s → 4s → 8s → 16s (max 30s between attempts)
- Maximum 5 attempts before giving up

**When You See This:**
- 🔄 After "Dead" state detected
- 🔄 After receiving WebSocket error message
- 🔄 During network recovery

**Duration:** Typically 1-8 seconds for successful reconnection.

---

#### ⚪ Not Connected

**Status:** Offline
**Action:** Depends on context

**What's Happening:**
- WebSocket is closed or never established
- Either user-initiated (disconnect) or connection failed

**When You See This:**
- 📴 Before call starts (not connected yet)
- 📴 After call ends (intentional disconnect)
- ❌ After max reconnection attempts failed

---

### Simplified Header Display

The **collapsed header** shows simplified status for quick glance:

| Internal States | Header Display | Color | Meaning |
|----------------|----------------|-------|---------|
| Healthy, Slow, Degrading | **Active** | 🟢 Green | Connection is working |
| Dead, Reconnecting | **Dead** or **Reconnecting** | 🔴 Red | Connection broken/recovering |
| Not Connected | **Offline** | ⚪ Gray | WebSocket closed |

**Why Simplified?**
Users don't care about nuances like "Slow" vs "Degrading". They want binary: **Is my connection working?**

---

### State Transitions

```
        Connection Established
                 ↓
         ┌─────► Healthy ◄─────┐
         │          ↓           │
         │        Slow          │
         │          ↓           │
         │      Degrading       │
         │          ↓           │
         │        Dead ─────────┘
         │          ↓
         │    Reconnecting
         │    (exponential
         │     backoff)
         │          ↓
         └────── Success
                   ↓
              Healthy (reset)
```

---

## VAD-Aware Zombie Detection

**VAD = Voice Activity Detection**

The system uses **adaptive timeouts** based on whether the user is speaking:

### Timeout Selection Logic

```javascript
if (user is speaking OR speech ended < grace period ago) {
  use SPEAKING_TIMEOUT (10s)
} else {
  use SILENT_TIMEOUT (60s)
}
```

### Visual Flow

```
Timeline:    [Speaking]──[Grace]───[Silent]──────────
Threshold:      10s        10s        60s    60s
VAD State:      🎤         🎤         🔇     🔇

Example:
0s:  User starts speaking
5s:  User stops speaking
10s: Grace period ends → switch to silent timeout
70s: If no message received → declare DEAD
```

### Why Different Timeouts?

#### During Speech (10s Timeout)

**Rationale:**
- Expecting responses from translation pipeline
- Fast detection identifies real failures quickly
- Short timeout acceptable - user will retry anyway

**When Used:**
- User is actively speaking (VAD detects voice)
- Within grace period after speech ends (5s default)

---

#### During Silence (60s Timeout)

**Rationale:**
- NOT expecting responses (legitimately no data to send/receive)
- Long timeout prevents false positives during conversation pauses
- Trade-off: Slower detection of silent zombies vs avoiding unnecessary reconnections

**When Used:**
- User is silent (VAD detects no voice)
- More than grace period after speech ended

---

### Benefits

✅ **Fewer false positives** - Doesn't reconnect during natural conversation pauses
✅ **Fast failure detection** - Quickly catches zombies during active speech (10s)
✅ **Better UX** - No unnecessary reconnection interruptions
✅ **Adaptive** - Automatically adjusts based on conversation flow

---

### Example Scenarios

**Normal conversation:**
```
Agent speaks (10s) → Both silent briefly (12s) → Customer speaks (10s)
├─ Agent: Healthy (receiving customer's translations)
└─ Customer: Healthy (receiving agent's translations)
```

**Extended silence:**
```
Both silent for 30s (both using 60s timeout)
├─ Agent: Degrading (30s since last message, won't reconnect yet)
└─ Customer: Degrading (30s since last message, won't reconnect yet)
```

**True zombie during speech:**
```
Agent speaking but no messages arriving
├─ After 10s: Declared DEAD → Reconnecting
└─ Fast detection prevents prolonged dead air
```

---

## Troubleshooting

### Common Issues

#### 1. Dashboard Not Appearing

**Symptom:** No dashboard visible with `?debug=true`

**Checks:**
1. Verify URL has `?debug=true` parameter
2. Open browser console, look for: `🔧 Debug mode enabled`
3. Check for JavaScript errors
4. Clear browser cache and reload

**Console Commands:**
```javascript
// Check debug mode
isDebugMode(); // Should return true

// Check if dashboard loaded
window.debugDashboard; // Should be defined

// Manually check clients
window.DeepLVoiceClientAgent;
window.DeepLVoiceClientCustomer;
```

---

#### 2. Shows "Not Connected" During Active Call

**Symptom:** Dashboard shows all connections as "Not Connected" or "Offline"

**Checks:**
1. Verify call is actually connected (check Connect CCP)
2. Check browser console for client initialization errors
3. Confirm WebSocket connections exist (Network tab → WS filter)

**Console Commands:**
```javascript
// Get health data manually
window.DeepLVoiceClientAgent?.getConnectionHealth();
window.DeepLVoiceClientCustomer?.getConnectionHealth();

// Check if clients exist
!!window.DeepLVoiceClientAgent; // Should be true
!!window.DeepLVoiceClientCustomer; // Should be true
```

---

#### 3. False "Degrading" Status

**Symptom:** Connection shows "Slow" or "Degrading" frequently during normal conversation

**Diagnosis:**

**If agent is speaking AND customer shows Degrading:**
❌ **This is a real problem!**
- Customer should be receiving translated audio messages
- Translation pipeline is slow or broken
- Network issues on customer side

**If BOTH are silent AND both show Degrading:**
✅ **This is expected!**
- No one is speaking, so no messages are flowing
- Using 60s timeout, so won't reconnect unless > 60s

**Solutions:**
1. Check translation pipeline latency (use AudioLatencyTrackManager)
2. Increase **Speaking Timeout** to 12-15s if pipeline is legitimately slow
3. Increase **Grace Period** to 7-10s if translations take longer

---

#### 4. Slow Zombie Detection

**Symptom:** Obvious connection failures take too long to detect

**Likely Causes:**
- Silent timeout too conservative (> 60s)
- Currently in silent mode (using 60s timeout)

**Solutions:**
1. Check if VAD is working: `audioLatencyTrackManager.isSpeaking('agent')`
2. Reduce **Silent Timeout** to 30-45s for faster detection
3. Reduce **Speaking Timeout** to 7-8s
4. Monitor for increased false positives after changes

---

#### 5. Frequent Reconnections

**Symptom:** Dashboard shows many reconnections in history

**Likely Causes:**
- Speaking timeout too aggressive (< 10s)
- Translation pipeline has high variance
- Network instability

**Solutions:**
1. Increase **Speaking Timeout** to 12-15s
2. Increase **Grace Period** to 7-10s
3. Check network stability (throttle in DevTools)
4. Review reconnection history for patterns
5. Export health data and analyze message gaps

---

#### 6. Config Changes Not Working

**Symptom:** Slider changes don't affect behavior

**Checks:**
1. Verify sliders show updated values
2. Check localStorage: `localStorage.getItem('debugDashboard_healthConfig')`
3. Ensure connections were established AFTER config change
4. Try "Reset to Defaults" and reconfigure

**Console Commands:**
```javascript
// Force config update
window.DeepLVoiceClientAgent.updateHealthConfig({
  zombieTimeoutSpeaking: 15000,
  zombieTimeoutSilent: 45000,
  speechGracePeriod: 7000
});

// Verify config applied
window.DeepLVoiceClientAgent.getConnectionHealth().config;
```

---

## Advanced Usage

### Console Access

The dashboard is exposed to `window` for programmatic control:

```javascript
// Access dashboard instance
window.debugDashboard;

// Force expand/collapse
window.debugDashboard.isCollapsed = false;
window.debugDashboard.updateCollapsedState();

// Manually trigger update
window.debugDashboard.update();

// Export health data programmatically
window.debugDashboard.exportHealthData();

// Access individual clients
window.DeepLVoiceClientAgent.getConnectionHealth();
window.DeepLVoiceClientCustomer.getConnectionHealth();
```

---

### Monitoring Best Practices

#### During Development

1. **Keep dashboard expanded** to see real-time behavior
2. **Watch timeline** for patterns (should be mostly green during conversation)
3. **Test with different timeouts** to find optimal settings for your pipeline
4. **Simulate failures** using network throttling (Chrome DevTools)
5. **Export data** before/after changes for comparison

#### During Testing

1. **Test realistic network conditions** (3G, unstable WiFi)
2. **Verify no false positives** during normal conversations
3. **Confirm fast detection** when simulating zombies (block network in DevTools)
4. **Check reconnection history** for excessive attempts
5. **Monitor error counts** (should stay at 0)

#### In Production (Debug Mode)

1. **Only enable temporarily** for troubleshooting user-reported issues
2. **Export health data** when users experience problems
3. **Look for patterns** in reconnection history and timeline
4. **Compare against AudioLatencyTrackManager** data (translation latency)
5. **Disable after troubleshooting** (remove `?debug=true`)

---

### Performance Considerations

#### Dashboard Overhead

- **Update frequency:** 1Hz (once per second)
- **Memory usage:** ~2MB (history buffers)
- **CPU impact:** < 1% on modern devices
- **Network impact:** Zero (no additional requests)

#### Production Impact

When `?debug=true` is **NOT** present:
- **Bundle size:** +0 bytes (dynamic import, not bundled)
- **Memory:** +0 bytes (not loaded)
- **CPU:** +0% (not running)
- **Zero performance impact** ✅

---

### Debugging Tips

#### Watch Network Traffic

```javascript
// DevTools → Network → WS filter
// Watch for:
// - Frequency of messages
// - Message types (transcription, translation, audio)
// - Gaps in message arrival
```

#### Simulate Network Issues

```javascript
// DevTools → Network → Throttling
// Options:
// - Slow 3G (slow network)
// - Offline (complete disconnection)
// - Custom (set specific latency/bandwidth)
```

#### Timeline Analysis

```javascript
// Export and analyze quality history
const health = window.DeepLVoiceClientAgent.getConnectionHealth();
const history = health.stats.qualityHistory;

// Count state distribution
const counts = history.reduce((acc, entry) => {
  acc[entry.quality] = (acc[entry.quality] || 0) + 1;
  return acc;
}, {});

console.log('State distribution:', counts);
// Example: { good: 55, degraded: 3, poor: 2 }

// Calculate percentage healthy
const healthyPercent = (counts.good / history.length) * 100;
console.log(`Healthy: ${healthyPercent.toFixed(1)}%`);
```

#### Reconnection Analysis

```javascript
// Get all reconnections
const health = window.DeepLVoiceClientAgent.getConnectionHealth();
const reconnections = health.stats.reconnections;

// Average reconnection time
const avgTime = reconnections.reduce((sum, r) =>
  sum + r.duration, 0) / reconnections.length;
console.log(`Avg reconnection: ${avgTime.toFixed(0)}ms`);

// Success rate
const successRate = reconnections.filter(r => r.success).length /
  reconnections.length * 100;
console.log(`Success rate: ${successRate}%`);

// Attempts distribution
const attemptCounts = reconnections.reduce((acc, r) => {
  acc[r.attempts] = (acc[r.attempts] || 0) + 1;
  return acc;
}, {});
console.log('Attempts distribution:', attemptCounts);
// Example: { 1: 8, 2: 2, 3: 1 } = mostly first-try success
```

---

## Export Data Format

When you click **"Export Health Data"**, downloads:

**Filename:** `websocket-health-YYYY-MM-DD-HH-mm.json`

**Structure:**
```json
{
  "exportedAt": "2026-02-26T14:30:00.000Z",
  "customer": {
    "type": "customer",
    "quality": "good",
    "timeSinceLastMessage": 234,
    "isReconnecting": false,
    "reconnectAttempts": 0,
    "stats": {
      "totalMessages": 1247,
      "totalErrors": 0,
      "uptime": 332450,
      "reconnectionCount": 1,
      "reconnections": [
        {
          "timestamp": 1708963200000,
          "attempts": 1,
          "success": true,
          "duration": 1200
        }
      ],
      "qualityHistory": [
        { "timestamp": 1708963150000, "quality": "good" },
        { "timestamp": 1708963151000, "quality": "good" }
      ]
    },
    "config": {
      "degradedThreshold": 3000,
      "poorThreshold": 5000,
      "zombieTimeoutSpeaking": 10000,
      "zombieTimeoutSilent": 60000,
      "speechGracePeriod": 5000,
      "maxReconnectAttempts": 5,
      "initialBackoff": 1000,
      "maxBackoff": 30000
    }
  },
  "agent": {
    // Same structure as customer
  }
}
```

**Use Cases:**
- Attach to bug reports
- Analyze connection patterns offline
- Compare before/after configuration changes
- Share with team for collaborative debugging

---

## FAQ

### Q: What does this dashboard actually measure?

**A:** It measures **connection liveness** (time since last WebSocket message), NOT translation quality or latency. Think of it as "Is the WebSocket alive?" rather than "Is the translation good?". Any message (transcription, translation, audio chunk) resets the timer.

---

### Q: Why does it show "Healthy" even when translations are slow?

**A:** Because messages are still arriving (transcriptions come fast, ~300ms). The dashboard only cares if the WebSocket is alive, not how fast end-to-end translation is. For translation latency, use `AudioLatencyTrackManager`.

---

### Q: Can I use this in production?

**A:** Only temporarily for troubleshooting. The dashboard is meant for developers, not end users. Remove `?debug=true` after debugging.

---

### Q: Will it slow down my app?

**A:** No. When `?debug=true` is not present, the dashboard code isn't loaded at all (dynamic import). Zero production impact.

---

### Q: Why two different timeouts (10s speaking, 60s silent)?

**A:** To prevent false positives. During silence, there's legitimately no data flowing, so we use a longer timeout (60s) to avoid reconnecting during normal conversation pauses. During speech, we expect frequent messages, so we use a shorter timeout (10s) for faster zombie detection.

---

### Q: What's the difference between "Slow" and "Degrading"?

**A:**
- **Slow (3-5s gap):** Minor delay, might be temporary
- **Degrading (5-10s gap):** Significant gap, approaching reconnection threshold

Both measure time since last message. It's a gradient from healthy to dead.

---

### Q: Should I see "Degrading" during conversation pauses?

**A:** Yes, briefly. If BOTH parties are silent for 5-10 seconds, both connections will show "Degrading". This is normal and won't trigger reconnection until 60 seconds (silent timeout).

---

### Q: What if listener shows "Degrading" while speaker is talking?

**A:** That's a **real problem**! The listener should be receiving translated audio messages. If they're not receiving messages while the speaker is active, the translation pipeline is delayed or broken.

---

### Q: How do I reset everything?

**A:** Click **"Reset to Defaults"** in the Configuration Override section. This resets all thresholds and clears localStorage.

---

### Q: Can I customize the dashboard?

**A:** Yes! The code is in `webapp/components/DebugDashboard.js` and `DebugDashboard.css`. You can add custom metrics, charts, or controls as needed.

---

## Summary

The WebSocket Health Debug Dashboard is a powerful tool for monitoring **connection liveness**:

✅ **What it measures:** Time since last WebSocket message (any type)
✅ **What it detects:** Zombie connections (TCP open, no data)
✅ **What it does:** Triggers automatic reconnection with exponential backoff

❌ **What it doesn't measure:** Translation quality, audio quality, or end-to-end latency

**Key Insight:** This is about keeping the WebSocket alive, not about translation performance. Use `AudioLatencyTrackManager` for latency metrics.