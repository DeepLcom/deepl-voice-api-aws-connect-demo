// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  LOGGER_PREFIX,
  HEALTH_CHECK_INTERVAL_MS,
  DEGRADED_THRESHOLD_MS,
  POOR_THRESHOLD_MS,
  ZOMBIE_DETECTION_TIMEOUT_SPEAKING_MS,
  ZOMBIE_DETECTION_TIMEOUT_SILENT_MS,
  SPEECH_GRACE_PERIOD_MS,
  MAX_RECONNECT_ATTEMPTS,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS
} from "../constants";

/**
 * ConnectionHealthMonitor
 *
 * Monitors WebSocket connection health by tracking message frequency
 * and automatically triggering reconnection when connection appears dead.
 *
 * States:
 * - unknown: Initial state, no data yet
 * - good: Messages arriving frequently (< 1s ago)
 * - degraded: Messages slowing down (1-3s ago)
 * - poor: Messages very slow (3-5s ago)
 * - dead: No messages for extended period (> threshold)
 * - reconnecting: Attempting to reconnect
 * - offline: Connection closed
 */
export class ConnectionHealthMonitor {
  constructor(options = {}) {
    this.type = options.type || 'unknown'; // 'agent' or 'customer'
    this.onQualityChange = options.onQualityChange || null;
    this.onReconnectNeeded = options.onReconnectNeeded || null;
    this.audioLatencyTrackManager = options.audioLatencyTrackManager || null; // For VAD state

    // Health tracking
    this.lastMessageTime = null;
    this.lastSpeechTime = null; // Track when user last spoke (for grace period)
    this.quality = 'unknown'; // unknown, good, degraded, poor, dead, reconnecting, offline
    this.heartbeatInterval = null;

    // Reconnection tracking
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.reconnectTimer = null;

    // Statistics
    this.stats = {
      totalMessages: 0,
      totalErrors: 0,
      connectionStartTime: null,
      lastConnectionTime: null,
      reconnections: [],
      qualityHistory: [] // Last 60 seconds of quality states
    };

    // Configuration (can be overridden via updateConfig() for dashboard)
    this.config = {
      degradedThreshold: options.degradedThreshold || DEGRADED_THRESHOLD_MS,
      poorThreshold: options.poorThreshold || POOR_THRESHOLD_MS,
      zombieTimeoutSpeaking: options.zombieTimeoutSpeaking || ZOMBIE_DETECTION_TIMEOUT_SPEAKING_MS,
      zombieTimeoutSilent: options.zombieTimeoutSilent || ZOMBIE_DETECTION_TIMEOUT_SILENT_MS,
      speechGracePeriod: options.speechGracePeriod || SPEECH_GRACE_PERIOD_MS,
      maxReconnectAttempts: options.maxReconnectAttempts || MAX_RECONNECT_ATTEMPTS,
      initialBackoff: options.initialBackoff || INITIAL_BACKOFF_MS,
      maxBackoff: options.maxBackoff || MAX_BACKOFF_MS
    };

    console.log(`${LOGGER_PREFIX} - ConnectionHealthMonitor created for ${this.type}`);
  }

  /**
   * Start monitoring connection health
   * Call this when WebSocket opens
   */
  start() {
    console.log(`${LOGGER_PREFIX} - ConnectionHealthMonitor.start() for ${this.type}`);

    this.lastMessageTime = Date.now();
    this.quality = 'good';
    this.stats.connectionStartTime = Date.now();
    this.stats.lastConnectionTime = Date.now();
    this.reconnectAttempts = 0;
    this.isReconnecting = false;

    // Clear any existing interval
    this.stop();

    // Start heartbeat check
    this.heartbeatInterval = setInterval(() => {
      this._checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);

    // Record quality snapshot
    this._recordQualitySnapshot();
  }

  /**
   * Stop monitoring
   * Call this when WebSocket closes
   */
  stop() {
    console.log(`${LOGGER_PREFIX} - ConnectionHealthMonitor.stop() for ${this.type}`);

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this._updateQuality('offline');
  }

  /**
   * Update last message timestamp
   * Call this in ws.onmessage handler
   */
  recordMessage() {
    this.lastMessageTime = Date.now();
    this.stats.totalMessages++;

    // If we were in a bad state, recovery might be happening
    if (this.quality === 'poor' || this.quality === 'dead') {
      console.log(`${LOGGER_PREFIX} - ${this.type} connection recovering (message received)`);
    }
  }

  /**
   * Record error
   * Call this in ws.onerror handler
   */
  recordError() {
    this.stats.totalErrors++;
    console.warn(`${LOGGER_PREFIX} - ${this.type} WebSocket error recorded (total: ${this.stats.totalErrors})`);
  }

  /**
   * Notify that reconnection started
   */
  startReconnecting() {
    this.isReconnecting = true;
    this._updateQuality('reconnecting');
  }

  /**
   * Notify that reconnection succeeded
   */
  reconnectionSucceeded() {
    console.log(`${LOGGER_PREFIX} - ${this.type} reconnection succeeded`);

    this.stats.reconnections.push({
      timestamp: Date.now(),
      attempts: this.reconnectAttempts,
      success: true,
      duration: Date.now() - this.stats.lastConnectionTime
    });

    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.start(); // Restart monitoring
  }

  /**
   * Notify that reconnection failed
   */
  reconnectionFailed() {
    console.warn(`${LOGGER_PREFIX} - ${this.type} reconnection failed (attempt ${this.reconnectAttempts})`);

    this.reconnectAttempts++;

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`${LOGGER_PREFIX} - ${this.type} max reconnection attempts reached`);

      this.stats.reconnections.push({
        timestamp: Date.now(),
        attempts: this.reconnectAttempts,
        success: false,
        duration: Date.now() - this.stats.lastConnectionTime
      });

      this.isReconnecting = false;
      this._updateQuality('offline');
      return false; // Give up
    }

    return true; // Keep trying
  }

  /**
   * Calculate next reconnection backoff time
   * @returns {number} - Milliseconds to wait before next attempt
   */
  getNextBackoff() {
    // Exponential backoff: 2^attempt * initialBackoff
    // Capped at maxBackoff
    const backoff = Math.min(
      this.config.initialBackoff * Math.pow(2, this.reconnectAttempts),
      this.config.maxBackoff
    );

    console.log(`${LOGGER_PREFIX} - ${this.type} next reconnection in ${backoff}ms (attempt ${this.reconnectAttempts + 1}/${this.config.maxReconnectAttempts})`);

    return backoff;
  }

  /**
   * Get current connection health data
   * @returns {Object} - Health statistics
   */
  getHealth() {
    const timeSinceLastMessage = this.lastMessageTime
      ? Date.now() - this.lastMessageTime
      : null;

    const uptime = this.stats.connectionStartTime
      ? Date.now() - this.stats.connectionStartTime
      : 0;

    return {
      type: this.type,
      quality: this.quality,
      timeSinceLastMessage,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      stats: {
        totalMessages: this.stats.totalMessages,
        totalErrors: this.stats.totalErrors,
        uptime,
        reconnectionCount: this.stats.reconnections.length,
        reconnections: this.stats.reconnections,
        qualityHistory: this.stats.qualityHistory.slice(-60) // Last 60 seconds
      },
      config: this.config
    };
  }

  /**
   * Update configuration (allows runtime changes)
   * @param {Object} newConfig - Partial config to update
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`${LOGGER_PREFIX} - ${this.type} config updated:`, this.config);
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Check connection health with VAD-aware adaptive timeout
   * @private
   */
  _checkHealth() {
    if (!this.lastMessageTime) {
      // No messages yet, stay in unknown state
      return;
    }

    const timeSinceLastMessage = Date.now() - this.lastMessageTime;

    // Get current VAD (Voice Activity Detection) state
    const isSpeaking = this.audioLatencyTrackManager?.isSpeaking(this.type) || false;

    // Update last speech time if currently speaking
    if (isSpeaking) {
      this.lastSpeechTime = Date.now();
    }

    // Calculate grace period: expect responses for 5s after speech ends (accounts for pipeline latency)
    const timeSinceLastSpeech = this.lastSpeechTime
      ? Date.now() - this.lastSpeechTime
      : Infinity;

    const expectingResponse = timeSinceLastSpeech < this.config.speechGracePeriod;

    // Adaptive zombie detection threshold based on speech activity
    const zombieThreshold = expectingResponse
      ? this.config.zombieTimeoutSpeaking  // 10s - speaking or just finished speaking
      : this.config.zombieTimeoutSilent;   // 60s - true silence (no false positives)

    // Determine quality based on time since last message
    let newQuality = this.quality;

    if (timeSinceLastMessage >= zombieThreshold) {
      newQuality = 'dead';
    } else if (timeSinceLastMessage >= this.config.poorThreshold) {
      newQuality = 'poor';
    } else if (timeSinceLastMessage >= this.config.degradedThreshold) {
      newQuality = 'degraded';
    } else {
      newQuality = 'good';
    }

    // Update quality if changed
    if (newQuality !== this.quality) {
      this._updateQuality(newQuality);

      // Only log significant transitions (dead, reconnecting, offline, or recovery to good)
      const significantTransitions =
        newQuality === 'dead' ||
        newQuality === 'reconnecting' ||
        newQuality === 'offline' ||
        (newQuality === 'good' && ['poor', 'dead', 'reconnecting'].includes(this.quality));

      if (significantTransitions) {
        const activityInfo = expectingResponse
          ? `(expecting response, zombie threshold: ${zombieThreshold}ms)`
          : `(silence OK, zombie threshold: ${zombieThreshold}ms)`;

        console.log(`${LOGGER_PREFIX} - ${this.type} connection: ${this.quality} → ${newQuality} (${timeSinceLastMessage}ms since last message) ${activityInfo}`);
      }

      // If connection is dead and we're not already reconnecting, trigger reconnection
      if (newQuality === 'dead' && !this.isReconnecting && this.onReconnectNeeded) {
        console.error(`${LOGGER_PREFIX} - 💀 ${this.type} connection is DEAD (${timeSinceLastMessage}ms, threshold: ${zombieThreshold}ms)`);
        console.log(`${LOGGER_PREFIX} - 🔄 Triggering reconnection for ${this.type}...`);
        this.onReconnectNeeded();
      }
    }

    // Record quality snapshot every second
    this._recordQualitySnapshot();
  }

  /**
   * Update quality state and notify listeners
   * @private
   */
  _updateQuality(newQuality) {
    const oldQuality = this.quality;
    this.quality = newQuality;

    if (this.onQualityChange) {
      this.onQualityChange(newQuality, oldQuality);
    }
  }

  /**
   * Record current quality for history timeline
   * @private
   */
  _recordQualitySnapshot() {
    this.stats.qualityHistory.push({
      timestamp: Date.now(),
      quality: this.quality
    });

    // Keep only last 60 seconds
    const oneMinuteAgo = Date.now() - 60000;
    this.stats.qualityHistory = this.stats.qualityHistory.filter(
      snapshot => snapshot.timestamp > oneMinuteAgo
    );
  }
}
