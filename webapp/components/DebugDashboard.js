// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * DebugDashboard - WebSocket Health Monitor Debug Dashboard
 *
 * A developer tool that visualizes WebSocket connection health in real-time.
 * Only loaded when ?debug=true URL parameter is present.
 *
 * Features:
 * - Real-time health monitoring for Agent and Customer WebSocket connections
 * - Quality timeline visualization (60 seconds of history)
 * - VAD-aware indicators showing speaking/silent states
 * - Configuration override sliders with tooltips
 * - Export health data to JSON
 * - Reconnection history tracking
 * - Raw JSON data inspector
 *
 * Usage:
 * 1. Add ?debug=true to URL
 * 2. Dashboard appears at bottom of screen (collapsed by default)
 * 3. Click header to expand/collapse
 * 4. Access via console: window.debugDashboard
 */

import './DebugDashboard.css';

export class DebugDashboard {
  constructor(options = {}) {
    // Store options object to preserve getter functions
    this.options = options;

    this.isCollapsed = true;
    this.isInspectorExpanded = false;
    this.updateInterval = null;
    this.element = null;

    // Cache DOM references
    this.refs = {};

    // Store previous values for efficient updates
    this.previousState = {
      agent: {},
      customer: {},
    };

    // Default config values
    this.defaultConfig = {
      zombieTimeoutSpeaking: 10000,
      zombieTimeoutSilent: 60000,
      speechGracePeriod: 5000,
    };

    // Load saved config overrides
    this.loadConfigOverrides();
  }

  /**
   * Mount dashboard to DOM
   */
  mount(parentElement) {
    console.log('🔧 Mounting WebSocket Health Debug Dashboard...');

    // Create DOM structure
    this.element = this.createDashboardElement();
    parentElement.appendChild(this.element);

    // Cache DOM references
    this.cacheReferences();

    // Load collapsed state from sessionStorage
    const savedState = sessionStorage.getItem('debugDashboard_collapsed');
    if (savedState !== null) {
      this.isCollapsed = savedState === 'true';
    }

    // Load inspector state
    const savedInspectorState = sessionStorage.getItem('debugDashboard_rawDataExpanded');
    if (savedInspectorState !== null) {
      this.isInspectorExpanded = savedInspectorState === 'true';
    }

    this.updateCollapsedState();
    this.updateInspectorState();

    // Attach event listeners
    this.attachEventListeners();

    // Start update loop (1Hz)
    this.startUpdates();

    // Initial update
    this.update();
  }

  /**
   * Unmount dashboard and cleanup
   */
  unmount() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.refs = {};
  }

  /**
   * Create dashboard DOM structure
   */
  createDashboardElement() {
    const dashboard = document.createElement('div');
    dashboard.className = 'debug-dashboard collapsed';
    dashboard.innerHTML = `
      <div class="dashboard-header" data-ref="header">
        <div class="dashboard-header-title">
          <span>🔧 WebSocket Health Monitor (Debug)</span>
        </div>
        <div class="dashboard-header-toggle" data-ref="toggleBtn">
          <div class="dashboard-header-summary" data-ref="summary">
            <div class="connection-summary">
              Customer: <span class="status-dot offline" data-ref="customerDot"></span> <span data-ref="customerStatusText">Offline</span>
            </div>
            <div class="connection-summary">
              Agent: <span class="status-dot offline" data-ref="agentDot"></span> <span data-ref="agentStatusText">Offline</span>
            </div>
          </div>
          <span data-ref="toggleIcon">▼</span>
        </div>
      </div>

      <div class="dashboard-content" data-ref="content">
        <!-- Health Grid -->
        <div class="health-grid">
          <!-- Customer Card -->
          <div class="health-card">
            <div class="health-card-header">
              🎧 CUSTOMER
            </div>

            <div class="status-badge offline" data-ref="customerBadge">
              ⚪ Not Connected
            </div>

            <div class="metric-row">
              <span class="metric-label">
                Last Message
                <span class="info-icon" title="Time since last WebSocket message received (any type: transcription, translation, or audio). This measures connection liveness, not translation quality.">ℹ️</span>
              </span>
              <span class="metric-value" data-ref="customerLastMessage">—</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">
                Zombie Threshold
                <span class="info-icon" title="How long we wait without receiving ANY WebSocket message before declaring the connection dead and triggering reconnection.">ℹ️</span>
              </span>
              <span class="metric-value" data-ref="customerThreshold">—</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">VAD State</span>
              <span class="vad-indicator silent" data-ref="customerVad">🔇 Silent</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">Uptime</span>
              <span class="metric-value" data-ref="customerUptime">—</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">Messages</span>
              <span class="metric-value" data-ref="customerMessages">0</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">Errors</span>
              <span class="metric-value" data-ref="customerErrors">0</span>
            </div>

            <div class="quality-timeline-container">
              <div class="quality-timeline-label">
                Message Freshness History (Last 60 Seconds)
                <span class="info-icon" title="Shows how recently WebSocket messages were received. Each block = 3 seconds. Green (Healthy) = messages within 3s, Yellow (Slow) = 3-5s gap, Orange (Degrading) = 5-10s gap, Red (Dead) = exceeded zombie threshold, Blue = Reconnecting, Gray = Offline. This measures connection liveness, NOT translation quality or latency.">ℹ️</span>
              </div>
              <div class="quality-timeline" data-ref="customerTimeline">▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂</div>
            </div>
          </div>

          <!-- Agent Card -->
          <div class="health-card">
            <div class="health-card-header">
              👤 AGENT
            </div>

            <div class="status-badge offline" data-ref="agentBadge">
              ⚪ Not Connected
            </div>

            <div class="metric-row">
              <span class="metric-label">
                Last Message
                <span class="info-icon" title="Time since last WebSocket message received (any type: transcription, translation, or audio). This measures connection liveness, not translation quality.">ℹ️</span>
              </span>
              <span class="metric-value" data-ref="agentLastMessage">—</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">
                Zombie Threshold
                <span class="info-icon" title="How long we wait without receiving ANY WebSocket message before declaring the connection dead and triggering reconnection.">ℹ️</span>
              </span>
              <span class="metric-value" data-ref="agentThreshold">—</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">VAD State</span>
              <span class="vad-indicator silent" data-ref="agentVad">🔇 Silent</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">Uptime</span>
              <span class="metric-value" data-ref="agentUptime">—</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">Messages</span>
              <span class="metric-value" data-ref="agentMessages">0</span>
            </div>

            <div class="metric-row">
              <span class="metric-label">Errors</span>
              <span class="metric-value" data-ref="agentErrors">0</span>
            </div>

            <div class="quality-timeline-container">
              <div class="quality-timeline-label">
                Message Freshness History (Last 60 Seconds)
                <span class="info-icon" title="Shows how recently WebSocket messages were received. Each block = 3 seconds. Green (Healthy) = messages within 3s, Yellow (Slow) = 3-5s gap, Orange (Degrading) = 5-10s gap, Red (Dead) = exceeded zombie threshold, Blue = Reconnecting, Gray = Offline. This measures connection liveness, NOT translation quality or latency.">ℹ️</span>
              </div>
              <div class="quality-timeline" data-ref="agentTimeline">▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂</div>
            </div>
          </div>
        </div>

        <!-- Configuration Override Section -->
        <div class="controls-section">
          <div class="controls-header">⚙️ Configuration Override</div>

          <div class="config-slider-group">
            <div class="config-slider-label">
              <span>
                Speaking Timeout
                <span class="info-icon" title="Zombie detection timeout when user is actively speaking or recently spoke. Lower = faster detection but more false positives.">ℹ️</span>
              </span>
              <span class="config-slider-value" data-ref="speakingTimeoutValue">10s</span>
            </div>
            <div class="config-slider-description">
              Trigger reconnection if no data received for this duration while speaking (5-30 seconds)
            </div>
            <input
              type="range"
              class="config-slider"
              data-ref="speakingTimeoutSlider"
              min="5000"
              max="30000"
              step="1000"
              value="10000">
          </div>

          <div class="config-slider-group">
            <div class="config-slider-label">
              <span>
                Silent Timeout
                <span class="info-icon" title="Zombie detection timeout during silence. Higher = fewer false positives during natural pauses in conversation.">ℹ️</span>
              </span>
              <span class="config-slider-value" data-ref="silentTimeoutValue">60s</span>
            </div>
            <div class="config-slider-description">
              Trigger reconnection if no data received for this duration while silent (20-120 seconds)
            </div>
            <input
              type="range"
              class="config-slider"
              data-ref="silentTimeoutSlider"
              min="20000"
              max="120000"
              step="5000"
              value="60000">
          </div>

          <div class="config-slider-group">
            <div class="config-slider-label">
              <span>
                Grace Period
                <span class="info-icon" title="Time after speech ends where fast timeout still applies. Accounts for translation pipeline latency.">ℹ️</span>
              </span>
              <span class="config-slider-value" data-ref="gracePeriodValue">5s</span>
            </div>
            <div class="config-slider-description">
              Keep using speaking timeout for this duration after speech ends (2-10 seconds)
            </div>
            <input
              type="range"
              class="config-slider"
              data-ref="gracePeriodSlider"
              min="2000"
              max="10000"
              step="1000"
              value="5000">
          </div>

          <div class="button-group">
            <button class="btn" data-ref="resetConfigBtn">Reset to Defaults</button>
            <button class="btn" data-ref="exportDataBtn">Export Health Data</button>
            <button class="btn" data-ref="resetStatsBtn">Reset Stats</button>
          </div>
        </div>

        <!-- Reconnection History Section -->
        <div class="history-section">
          <div class="history-header">📊 Reconnection History (Last 5)</div>
          <ul class="history-list" data-ref="historyList">
            <li class="history-empty">No reconnections yet</li>
          </ul>
        </div>

        <!-- Raw Data Inspector -->
        <div class="inspector-section">
          <div class="inspector-header" data-ref="inspectorHeader">
            <div class="inspector-header-title">
              🔍 Raw Health Data
            </div>
            <span class="inspector-toggle" data-ref="inspectorToggle">▼ Expand</span>
          </div>
          <div class="inspector-content" data-ref="inspectorContent">
            <div class="inspector-column">
              <div class="inspector-column-header">Customer</div>
              <pre class="inspector-json" data-ref="customerJson">{}</pre>
            </div>
            <div class="inspector-column">
              <div class="inspector-column-header">Agent</div>
              <pre class="inspector-json" data-ref="agentJson">{}</pre>
            </div>
          </div>
        </div>
      </div>
    `;
    return dashboard;
  }

  /**
   * Cache DOM references for efficient updates
   */
  cacheReferences() {
    const refs = {};
    this.element.querySelectorAll('[data-ref]').forEach(el => {
      refs[el.dataset.ref] = el;
    });
    this.refs = refs;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Toggle collapse/expand - entire header is clickable
    this.refs.header.addEventListener('click', () => {
      this.toggleCollapsed();
    });

    // Config sliders
    this.refs.speakingTimeoutSlider.addEventListener('input', (e) => {
      this.updateConfig('zombieTimeoutSpeaking', parseInt(e.target.value));
    });

    this.refs.silentTimeoutSlider.addEventListener('input', (e) => {
      this.updateConfig('zombieTimeoutSilent', parseInt(e.target.value));
    });

    this.refs.gracePeriodSlider.addEventListener('input', (e) => {
      this.updateConfig('speechGracePeriod', parseInt(e.target.value));
    });

    // Control buttons
    this.refs.resetConfigBtn.addEventListener('click', () => {
      this.resetConfig();
    });

    this.refs.exportDataBtn.addEventListener('click', () => {
      this.exportHealthData();
    });

    this.refs.resetStatsBtn.addEventListener('click', () => {
      this.resetStats();
    });

    // Inspector toggle
    this.refs.inspectorHeader.addEventListener('click', () => {
      this.toggleInspector();
    });
  }

  /**
   * Start update loop
   */
  startUpdates() {
    // Update every 1 second using RAF + setInterval pattern
    this.updateInterval = setInterval(() => {
      requestAnimationFrame(() => this.update());
    }, 1000);
  }

  /**
   * Main update function (called every 1 second)
   */
  update() {
    try {
      // Get health data from clients
      const customerHealth = this.getHealthData('customer');
      const agentHealth = this.getHealthData('agent');

      // Debug logging (only on first update with data)
      if (!this._hasLoggedClients && (customerHealth || agentHealth)) {
        console.log('🔧 Dashboard received health data:', {
          customer: customerHealth ? 'Connected' : 'Not available',
          agent: agentHealth ? 'Connected' : 'Not available'
        });
        this._hasLoggedClients = true;
      }

      // Update displays
      this.updateHealthDisplay('customer', customerHealth);
      this.updateHealthDisplay('agent', agentHealth);

      // Update summary in collapsed header
      this.updateSummary(customerHealth, agentHealth);

      // Update reconnection history
      this.updateReconnectionHistory(customerHealth, agentHealth);

      // Update raw data (only if inspector is expanded)
      if (this.isInspectorExpanded) {
        this.updateRawData(customerHealth, agentHealth);
      }
    } catch (error) {
      console.error('DebugDashboard update error:', error);
    }
  }

  /**
   * Get health data from client with error handling
   */
  getHealthData(type) {
    try {
      const client = type === 'agent' ? this.options.agentClient : this.options.customerClient;

      // Debug: Log client availability on first check
      if (!this._debugLoggedClients) {
        this._debugLoggedClients = {};
      }
      if (!this._debugLoggedClients[type]) {
        console.log(`🔧 Checking ${type} client:`, {
          exists: !!client,
          hasMethod: client ? typeof client.getConnectionHealth === 'function' : false,
          windowClient: type === 'agent' ? !!window.DeepLVoiceClientAgent : !!window.DeepLVoiceClientCustomer
        });
        this._debugLoggedClients[type] = true;
      }

      if (!client || typeof client.getConnectionHealth !== 'function') {
        return null;
      }
      return client.getConnectionHealth();
    } catch (error) {
      console.error(`Error getting ${type} health data:`, error);
      return null;
    }
  }

  /**
   * Update health display for a connection
   */
  updateHealthDisplay(type, health) {
    const prefix = type;

    if (!health) {
      // Client not initialized
      this.refs[`${prefix}Badge`].className = 'status-badge offline';
      this.refs[`${prefix}Badge`].textContent = '⚪ Not Initialized';
      this.refs[`${prefix}LastMessage`].textContent = '—';
      this.refs[`${prefix}Threshold`].textContent = '—';
      this.refs[`${prefix}Vad`].className = 'vad-indicator silent';
      this.refs[`${prefix}Vad`].textContent = '🔇 N/A';
      this.refs[`${prefix}Uptime`].textContent = '—';
      this.refs[`${prefix}Messages`].textContent = '0';
      this.refs[`${prefix}Errors`].textContent = '0';
      this.refs[`${prefix}Timeline`].textContent = '▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂';
      return;
    }

    // Update status badge
    const quality = health.quality || 'offline';
    const badgeIcons = {
      good: '🟢',
      degraded: '🟡',
      poor: '🟠',
      dead: '🔴',
      reconnecting: '🔵',
      offline: '⚪'
    };
    const badgeLabels = {
      good: 'Healthy',
      degraded: 'Slow',
      poor: 'Degrading',
      dead: 'Dead',
      reconnecting: 'Reconnecting',
      offline: 'Offline'
    };
    this.refs[`${prefix}Badge`].className = `status-badge ${quality}`;
    this.refs[`${prefix}Badge`].textContent = `${badgeIcons[quality]} ${badgeLabels[quality]}`;

    // Update last message time
    const timeSince = this.formatTimeSince(health.timeSinceLastMessage);
    this.refs[`${prefix}LastMessage`].textContent = timeSince;

    // Update threshold
    const threshold = this.getActiveThreshold(type, health);
    this.refs[`${prefix}Threshold`].textContent = threshold;

    // Update VAD state
    const vadState = this.getVADState(type);
    const vadClass = vadState.speaking ? 'vad-indicator speaking' : 'vad-indicator silent';
    const vadIcon = vadState.speaking ? '🎤' : '🔇';
    const vadLabel = vadState.speaking ? 'Speaking' : 'Silent';
    this.refs[`${prefix}Vad`].className = vadClass;
    this.refs[`${prefix}Vad`].textContent = `${vadIcon} ${vadLabel}`;

    // Update uptime
    const uptime = this.formatDuration(health.stats?.uptime || 0);
    this.refs[`${prefix}Uptime`].textContent = uptime;

    // Update message/error counters
    this.refs[`${prefix}Messages`].textContent = this.formatNumber(health.stats?.totalMessages || 0);
    this.refs[`${prefix}Errors`].textContent = health.stats?.totalErrors || 0;

    // Update quality timeline
    this.updateQualityTimeline(prefix, health.stats?.qualityHistory || []);
  }

  /**
   * Update summary in collapsed header
   * Simplified: Active (green) vs Dead/Offline (red)
   */
  updateSummary(customerHealth, agentHealth) {
    // Customer status - simplified to Active/Dead/Offline
    const customerQuality = customerHealth?.quality || 'offline';
    const customerSimplified = this.simplifyStatus(customerQuality);
    this.refs.customerDot.className = `status-dot ${customerSimplified.cssClass}`;
    this.refs.customerStatusText.textContent = customerSimplified.label;

    // Agent status - simplified to Active/Dead/Offline
    const agentQuality = agentHealth?.quality || 'offline';
    const agentSimplified = this.simplifyStatus(agentQuality);
    this.refs.agentDot.className = `status-dot ${agentSimplified.cssClass}`;
    this.refs.agentStatusText.textContent = agentSimplified.label;
  }

  /**
   * Simplify quality status to binary: Active (green) vs Dead (red)
   * - good/degraded/poor = "Active" (connection is working)
   * - dead/reconnecting/offline = "Dead" (connection is broken)
   */
  simplifyStatus(quality) {
    switch (quality) {
      case 'good':
      case 'degraded':
      case 'poor':
        return { cssClass: 'active', label: 'Active' };

      case 'reconnecting':
        return { cssClass: 'dead', label: 'Reconnecting' };

      case 'dead':
        return { cssClass: 'dead', label: 'Dead' };

      case 'offline':
      default:
        return { cssClass: 'offline', label: 'Offline' };
    }
  }

  /**
   * Update quality timeline visualization
   */
  updateQualityTimeline(prefix, qualityHistory) {
    const blockCount = 20; // 20 blocks = 60 seconds (3s per block)
    const blockInterval = 3000; // 3 seconds per block

    if (!qualityHistory || qualityHistory.length === 0) {
      this.refs[`${prefix}Timeline`].innerHTML = '<span style="color: #6b7280;">▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂</span>';
      return;
    }

    const now = Date.now();
    const blocks = [];
    const blockChars = {
      good: '▇',
      degraded: '▆',
      poor: '▅',
      dead: '▄',
      reconnecting: '▃',
      offline: '▂'
    };

    const colors = {
      good: '#10b981',       // Green
      degraded: '#f59e0b',   // Yellow/Amber
      poor: '#f97316',       // Orange
      dead: '#ef4444',       // Red
      reconnecting: '#3b82f6', // Blue
      offline: '#6b7280'     // Gray
    };

    for (let i = 0; i < blockCount; i++) {
      const blockTime = now - (blockCount - i - 1) * blockInterval;

      // Find the quality at this time (most recent entry before blockTime)
      let quality = 'offline';
      for (const entry of qualityHistory) {
        if (entry.timestamp <= blockTime) {
          quality = entry.quality;
        } else {
          break;
        }
      }

      const char = blockChars[quality] || '▂';
      const color = colors[quality] || colors.offline;
      blocks.push(`<span style="color: ${color};">${char}</span>`);
    }

    this.refs[`${prefix}Timeline`].innerHTML = blocks.join('');
  }

  /**
   * Get active threshold for connection
   */
  getActiveThreshold(type, health) {
    if (!health || !health.config) return '—';

    const vadState = this.getVADState(type);
    const threshold = vadState.speaking
      ? health.config.zombieTimeoutSpeaking
      : health.config.zombieTimeoutSilent;

    const seconds = Math.floor(threshold / 1000);
    const label = vadState.speaking ? 'speaking' : 'silent';

    return `${seconds}s (${label})`;
  }

  /**
   * Get VAD state from audioLatencyTrackManager
   */
  getVADState(type) {
    try {
      const manager = this.options.audioLatencyTrackManager;
      if (!manager || typeof manager.isSpeaking !== 'function') {
        return { speaking: false, available: false };
      }
      const speaking = manager.isSpeaking(type);
      return { speaking, available: true };
    } catch (error) {
      return { speaking: false, available: false };
    }
  }

  /**
   * Update reconnection history
   */
  updateReconnectionHistory(customerHealth, agentHealth) {
    const allReconnections = [];

    // Collect reconnections from both connections
    if (customerHealth?.stats?.reconnections) {
      customerHealth.stats.reconnections.forEach(r => {
        allReconnections.push({ ...r, type: 'Customer' });
      });
    }

    if (agentHealth?.stats?.reconnections) {
      agentHealth.stats.reconnections.forEach(r => {
        allReconnections.push({ ...r, type: 'Agent' });
      });
    }

    // Sort by timestamp (most recent first)
    allReconnections.sort((a, b) => b.timestamp - a.timestamp);

    // Take last 5
    const last5 = allReconnections.slice(0, 5);

    if (last5.length === 0) {
      this.refs.historyList.innerHTML = '<li class="history-empty">No reconnections yet</li>';
      return;
    }

    const now = Date.now();
    const items = last5.map(r => {
      const timeAgo = this.formatTimeAgo(now - r.timestamp);
      const duration = (r.duration / 1000).toFixed(1);
      const icon = r.success ? '✅' : '❌';
      const status = r.success ? 'Success' : 'Failed';

      return `<li class="history-item">${timeAgo} - ${r.type} - ${r.attempts} attempt(s) - ${duration}s - ${icon} ${status}</li>`;
    });

    this.refs.historyList.innerHTML = items.join('');
  }

  /**
   * Update raw JSON data inspector
   */
  updateRawData(customerHealth, agentHealth) {
    const customerJson = customerHealth
      ? JSON.stringify(customerHealth, null, 2)
      : '{\n  "status": "Not initialized"\n}';

    const agentJson = agentHealth
      ? JSON.stringify(agentHealth, null, 2)
      : '{\n  "status": "Not initialized"\n}';

    this.refs.customerJson.textContent = customerJson;
    this.refs.agentJson.textContent = agentJson;
  }

  /**
   * Toggle collapsed/expanded state
   */
  toggleCollapsed() {
    this.isCollapsed = !this.isCollapsed;
    this.updateCollapsedState();
    sessionStorage.setItem('debugDashboard_collapsed', String(this.isCollapsed));
  }

  /**
   * Update UI based on collapsed state
   */
  updateCollapsedState() {
    if (this.isCollapsed) {
      this.element.classList.add('collapsed');
      this.element.classList.remove('expanded');
      this.refs.toggleIcon.textContent = '▼';
    } else {
      this.element.classList.remove('collapsed');
      this.element.classList.add('expanded');
      this.refs.toggleIcon.textContent = '▲';
    }
  }

  /**
   * Toggle raw data inspector
   */
  toggleInspector() {
    this.isInspectorExpanded = !this.isInspectorExpanded;
    this.updateInspectorState();
    sessionStorage.setItem('debugDashboard_rawDataExpanded', String(this.isInspectorExpanded));
  }

  /**
   * Update inspector UI based on state
   */
  updateInspectorState() {
    if (this.isInspectorExpanded) {
      this.refs.inspectorContent.classList.add('expanded');
      this.refs.inspectorToggle.textContent = '▲ Collapse';
      // Trigger immediate update
      this.update();
    } else {
      this.refs.inspectorContent.classList.remove('expanded');
      this.refs.inspectorToggle.textContent = '▼ Expand';
    }
  }

  /**
   * Update configuration
   */
  updateConfig(key, value) {
    const config = this.loadConfigOverrides();
    config[key] = value;

    // Save to localStorage
    localStorage.setItem('debugDashboard_healthConfig', JSON.stringify(config));

    // Update slider displays
    if (key === 'zombieTimeoutSpeaking') {
      this.refs.speakingTimeoutValue.textContent = `${value / 1000}s`;
      this.refs.speakingTimeoutSlider.value = value;
    } else if (key === 'zombieTimeoutSilent') {
      this.refs.silentTimeoutValue.textContent = `${value / 1000}s`;
      this.refs.silentTimeoutSlider.value = value;
    } else if (key === 'speechGracePeriod') {
      this.refs.gracePeriodValue.textContent = `${value / 1000}s`;
      this.refs.gracePeriodSlider.value = value;
    }

    // Update clients
    this.applyConfigToClients(config);
  }

  /**
   * Apply config to both clients
   */
  applyConfigToClients(config) {
    try {
      const agentClient = this.options.agentClient;
      const customerClient = this.options.customerClient;

      if (agentClient && typeof agentClient.updateHealthConfig === 'function') {
        agentClient.updateHealthConfig(config);
      }
      if (customerClient && typeof customerClient.updateHealthConfig === 'function') {
        customerClient.updateHealthConfig(config);
      }
    } catch (error) {
      console.error('Error applying config to clients:', error);
    }
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig() {
    const config = { ...this.defaultConfig };

    localStorage.setItem('debugDashboard_healthConfig', JSON.stringify(config));

    // Update UI
    this.refs.speakingTimeoutSlider.value = config.zombieTimeoutSpeaking;
    this.refs.speakingTimeoutValue.textContent = `${config.zombieTimeoutSpeaking / 1000}s`;
    this.refs.silentTimeoutSlider.value = config.zombieTimeoutSilent;
    this.refs.silentTimeoutValue.textContent = `${config.zombieTimeoutSilent / 1000}s`;
    this.refs.gracePeriodSlider.value = config.speechGracePeriod;
    this.refs.gracePeriodValue.textContent = `${config.speechGracePeriod / 1000}s`;

    // Apply to clients
    this.applyConfigToClients(config);

    console.log('✅ Configuration reset to defaults');
  }

  /**
   * Load config overrides from localStorage
   */
  loadConfigOverrides() {
    try {
      const saved = localStorage.getItem('debugDashboard_healthConfig');
      if (saved) {
        const config = JSON.parse(saved);

        // Update sliders if they exist
        if (this.refs.speakingTimeoutSlider) {
          this.refs.speakingTimeoutSlider.value = config.zombieTimeoutSpeaking || this.defaultConfig.zombieTimeoutSpeaking;
          this.refs.speakingTimeoutValue.textContent = `${(config.zombieTimeoutSpeaking || this.defaultConfig.zombieTimeoutSpeaking) / 1000}s`;
        }
        if (this.refs.silentTimeoutSlider) {
          this.refs.silentTimeoutSlider.value = config.zombieTimeoutSilent || this.defaultConfig.zombieTimeoutSilent;
          this.refs.silentTimeoutValue.textContent = `${(config.zombieTimeoutSilent || this.defaultConfig.zombieTimeoutSilent) / 1000}s`;
        }
        if (this.refs.gracePeriodSlider) {
          this.refs.gracePeriodSlider.value = config.speechGracePeriod || this.defaultConfig.speechGracePeriod;
          this.refs.gracePeriodValue.textContent = `${(config.speechGracePeriod || this.defaultConfig.speechGracePeriod) / 1000}s`;
        }

        // Apply to clients
        this.applyConfigToClients(config);

        return config;
      }
    } catch (error) {
      console.error('Error loading config overrides:', error);
    }

    return { ...this.defaultConfig };
  }

  /**
   * Export health data to JSON file
   */
  exportHealthData() {
    try {
      const customerHealth = this.getHealthData('customer');
      const agentHealth = this.getHealthData('agent');

      const data = {
        exportedAt: new Date().toISOString(),
        customer: customerHealth || { status: 'Not initialized' },
        agent: agentHealth || { status: 'Not initialized' },
      };

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const now = new Date();
      const filename = `websocket-health-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();

      URL.revokeObjectURL(url);

      console.log(`✅ Health data exported: ${filename}`);
    } catch (error) {
      console.error('Error exporting health data:', error);
      alert(`Failed to export health data: ${error.message}`);
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    try {
      const agentClient = this.options.agentClient;
      const customerClient = this.options.customerClient;

      if (agentClient && typeof agentClient.resetHealthStats === 'function') {
        agentClient.resetHealthStats();
      }
      if (customerClient && typeof customerClient.resetHealthStats === 'function') {
        customerClient.resetHealthStats();
      }
      console.log('✅ Statistics reset');
    } catch (error) {
      console.error('Error resetting stats:', error);
    }
  }

  /**
   * Format time since last message
   */
  formatTimeSince(ms) {
    if (ms == null || ms < 0) return '—';

    const seconds = Math.floor(ms / 1000);

    if (seconds < 1) {
      return `${(ms / 1000).toFixed(1)}s ago`;
    } else if (seconds < 60) {
      return `${seconds}s ago`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s ago`;
    }
  }

  /**
   * Format duration (uptime)
   */
  formatDuration(ms) {
    if (ms == null || ms < 0) return '—';

    const seconds = Math.floor(ms / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

  /**
   * Format time ago (for reconnection history)
   */
  formatTimeAgo(ms) {
    const seconds = Math.floor(ms / 1000);

    if (seconds < 5) {
      return 'just now';
    } else if (seconds < 60) {
      return `${seconds}s ago`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m ago`;
    } else {
      const hours = Math.floor(seconds / 3600);
      return `${hours}h ago`;
    }
  }

  /**
   * Format number with commas
   */
  formatNumber(num) {
    if (num == null) return '0';
    return num.toLocaleString();
  }
}
