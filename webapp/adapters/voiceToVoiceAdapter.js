import { getTranscribeAudioStream } from "../utils/transcribeUtils";
import { SUPPORTED_SOURCE_LANGUAGES, SUPPORTED_TARGET_LANGUAGES } from "../supportedLanguages.js";
import { ConnectionHealthMonitor } from "../managers/ConnectionHealthMonitor.js";
import { AUDIO_INGEST_SAMPLE_RATE, BUFFER_LEN } from "../constants.js";


class DeepLVoiceClient {
  constructor(options = {}) {
    this.type = options.type; // "agent" or "customer"
    this.baseUrl = options.baseUrl || "https://api.deepl.com";
    this.getLanguagesProxy = options.getLanguagesProxy || import.meta.env.VITE_GET_LANGUAGES_PROXY || "https://wjjabkvfyvqxqpizezx7jdsqny0hrpsa.lambda-url.eu-west-2.on.aws/"
    this.requestSessionProxy = options.requestSessionProxy || import.meta.env.VITE_REQUEST_SESSION_PROXY || "https://uexiwsmey6vz43rr3szwu6udeq0jotax.lambda-url.eu-west-2.on.aws/";

    this.ws = null;
    this.streamingUrl = null;
    this.currentToken = null;
    this.sessionConfig = null;
    this.shouldReconnect = true;
    this.isConnected = false;
    this.isReconnecting = false; // Guard flag to prevent duplicate reconnections

    // ⚠️ DIAGNOSTIC: Track audio drops during reconnection
    this.droppedAudioStats = {
      totalDroppedBytes: 0,
      totalDroppedChunks: 0,
      dropEvents: [] // { timestamp, bytes, reason, isReconnecting }
    };

    // 🔧 FIX: Buffer audio during brief reconnections (max 10 seconds)
    this.reconnectionBuffer = [];
    this.maxReconnectionBufferMs = 10000; // Buffer up to 10s of audio during reconnection
    
    // Event handlers
    this.onTranscription = options.onTranscription || null;
    this.onTranslation = options.onTranslation || null;
    this.onAudio = options.onAudio || null;
    this.onStreamEnd = null;
    this.onError = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onAudioProcessingComplete = null;

    // Track chunks with their cumulative audio time
    this.audioChunks = [];  // { sentAt, audioStartMs, audioEndMs }
    this.concludedTargetTranscriptTimes = [];  // { receivedAt, audioEndTime }
    this.cumulativeAudioTime = 0;  // Total audio sent so far in ms
    this.sampleRate = AUDIO_INGEST_SAMPLE_RATE;
    this.bytesPerSample = 2;  // 16-bit audio

    this.audioLatencyTrackManager = options.audioLatencyTrackManager;

    // Connection health monitoring with VAD-aware zombie detection
    this.healthMonitor = new ConnectionHealthMonitor({
      type: this.type,
      audioLatencyTrackManager: this.audioLatencyTrackManager, // For VAD state
      onQualityChange: (newQuality, oldQuality) => {
        // Only log significant state changes (not degraded/poor transitions)
        const significantStates = ['dead', 'reconnecting', 'offline'];
        if (significantStates.includes(newQuality) || significantStates.includes(oldQuality)) {
          console.log(`${this.type} connection: ${oldQuality} → ${newQuality}`);
        }
      },
      onReconnectNeeded: () => {
        this._handleReconnection();
      }
    });
  }

  async getLanguages(type = "source") {
    // Return hard-coded supported languages from config
    return type === "source" ? SUPPORTED_SOURCE_LANGUAGES : SUPPORTED_TARGET_LANGUAGES;

    // Lambda proxy code (commented out - uncomment to fetch from API)
    // try {
    //   const response = await fetch(this.getLanguagesProxy, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //       'Accept': 'application/json',
    //     },
    //     body: JSON.stringify({ type }),
    //   });
    //
    //   if (!response.ok) {
    //     const error = await response.json().catch(() => ({}));
    //     throw new Error(`Get languages failed: ${response.status} - ${error.message || response.statusText}`);
    //   }
    //
    //   const data = await response.json();
    //   return data;
    // } catch (error) {
    //   if (this.onError) {
    //     this.onError(error);
    //   }
    //   throw error;
    // }
  }

  /**
   * Request a new streaming session
   * 
   * @param {Object} config - Session configuration
   * @param {string} config.sourceLanguage - Source language code (e.g., 'en', 'de')
   * @param {string} [config.targetLanguages] - Array of target language codes (max 5)
   * @param {string} [config.targetMediaLanguages] - Optional array of target media language codes (if different from targetLanguages)
   * @param {string} config.sourceLanguageMode - 'auto' for auto-detection or 'fixed' for specific language code
   * @param {string} config.sourceMediaContentType - Audio format (e.g., 'audio/l16;rate=16000', 'audio/opus', 'audio/webm;codecs=opus')
   * @param {string} config.targetMediaContentType - Desired output audio format (e.g., 'audio/l16;rate=16000', 'audio/opus', 'audio/webm;codecs=opus')
   * @param {string} [config.targetMediaVoice] - Optional desired voice for TTS output (e.g., 'female', 'male')
   * @param {string} config.formality - Optional desired translation formality (formal, informal, default)
   * @param {string[]} [config.glossaryIds] - Optional array of glossary IDs
   * @param {boolean} [config.enableTranscription=true] - Enable source transcription
   * @returns {Promise<Object>} Session details with streaming_url and token
   */
  async requestSession(config) {
    if (!config.targetLanguages || config.targetLanguages.length === 0) {
      throw new Error('At least one target language is required');
    }
    
    if (config.targetLanguages.length > 5) {
      throw new Error('Maximum 5 target languages allowed per session');
    }

    this.sessionConfig = config;
    
    const body = {
      source_language: config.sourceLanguage.toLowerCase(),
      target_languages: config.targetLanguages.map(lang => lang.toLowerCase()),
      target_media_languages: config.targetMediaLanguages.map(lang => lang.toLowerCase()) || config.targetLanguages.map(lang => lang.toLowerCase()),
      source_media_content_type: config.sourceMediaContentType,
      target_media_content_type: config.targetMediaContentType,
      target_media_voice: config.targetMediaVoice || 'female',
      formality: config.formality || 'default',
      source_language_mode: config.sourceLanguageMode || 'fixed',
    };
    
    if (config.glossaryIds && config.glossaryIds.length > 0) {
      body.glossary_ids = config.glossaryIds;
    }
    
    if (config.enableTranscription !== undefined) {
      body.enable_transcription = config.enableTranscription;
    }

    // Log TTS provider selection
    const usingElevenLabs = body.early_access_experimental_mode === 'use_external_speech_provider';
    console.log(`🚀 Requesting ${this.type} session with ${usingElevenLabs ? 'ElevenLabs' : 'DeepL Internal'} TTS`);
    console.log('Session request body:', JSON.stringify(body, null, 2));

    try {
      const response = await fetch(this.requestSessionProxy, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Session request failed: ${response.status} - ${error.message || response.statusText}`);
      }

      const data = await response.json();
      console.log('Session request successful, response data:', data);
      this.streamingUrl = data.streaming_url;
      this.currentToken = data.token;
      
      return data
    } catch (error) {
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
  }

  /**
   * Connect to the WebSocket streaming endpoint
   * 
   * @param {string} streamingUrl - WebSocket URL from session request
   * @param {string} token - Authentication token from session request
   * @returns {Promise<void>}
   */
  async connect(streamingUrl, token) {
    return new Promise((resolve, reject) => {
      const wsUrl = `${streamingUrl}?token=${token}`;

      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => {
        console.log('✅ WebSocket connection established');
        this.isConnected = true;

        // Start health monitoring
        this.healthMonitor.start();

        if (this.onConnect) {
          this.onConnect();
        }
        resolve();
      };

      this.ws.onmessage = (event) => {
        // Record message received for health monitoring
        this.healthMonitor.recordMessage();
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        // Record error for health monitoring
        this.healthMonitor.recordError();
      };

      this.ws.onclose = (event) => {
        console.log('🔴 WebSocket closed:', event.reason);
        this.isConnected = false;

        // Stop health monitoring
        this.healthMonitor.stop();

        if (this.onDisconnect) {
          this.onDisconnect(event);
        }
      };
    });
  }
  
  disconnect() {
    if (this.connecting) {
      return;
    }
    console.log('Disconnecting...');
    this.isConnected = false;
    this.shouldReconnect = false;

    // Stop health monitoring
    this.healthMonitor.stop();

    if (this.ws) {
      // Set flag to prevent auto-reconnect
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get connection health metrics
   * @returns {Object} - Health data
   */
  getConnectionHealth() {
    return this.healthMonitor.getHealth();
  }

  /**
   * ⚠️ DIAGNOSTIC: Get audio drop statistics
   * @returns {Object} - Drop statistics
   */
  getDroppedAudioStats() {
    const audioMs = (this.droppedAudioStats.totalDroppedBytes / (this.sampleRate * this.bytesPerSample)) * 1000;
    return {
      ...this.droppedAudioStats,
      totalDroppedMs: audioMs.toFixed(0),
      totalDroppedSeconds: (audioMs / 1000).toFixed(2)
    };
  }

  /**
   * Update health monitoring configuration
   * @param {Object} config - Partial configuration to update
   */
  updateHealthConfig(config) {
    this.healthMonitor.updateConfig(config);
  }

  handleMessage(data) {
    const receiveTime = performance.now();

    try {
      const message = JSON.parse(data);
      console.log('Received message:', message);

      if (message.source_transcript_update) {
        const update = message.source_transcript_update;

        if (update.concluded && update.concluded.length > 0) {
            const lastSegment = update.concluded[update.concluded.length - 1];
            const audioEndTime = lastSegment.end_time;

            this.audioLatencyTrackManager.enqueueTranscription(this.type, receiveTime, audioEndTime);

            if (this.onTranscription) {
                const concludedText = update.concluded
                    .map(item => item.text)
                    .join('');
                console.log(`[${this.type}] 📝 Transcription: "${concludedText}"`);
                this.onTranscription(concludedText);
            }
          }
      }
      else if (message.target_transcript_update) {
        const update = message.target_transcript_update;

        if (update.concluded && update.concluded.length > 0) {
            const lastSegment = update.concluded[update.concluded.length - 1];
            const audioEndTime = lastSegment.end_time;

            this.audioLatencyTrackManager.enqueueTranslation(this.type, receiveTime, audioEndTime);

            if (this.onTranslation) {
                const concludedText = update.concluded
                    .map(item => item.text)
                    .join('');
                console.log(`[${this.type}] 🌐 Translation: "${concludedText}"`);
                this.onTranslation(concludedText);

            }
        }
      }
      else if (message.target_media_chunk) {
        const update = message.target_media_chunk;
        const data = update.data;

        if (data && data.length > 0) {
          console.log(`[${this.type}] 🔊 Received audio: ${data.length} bytes`);
          if (this.onAudio) {
              this.onAudio(data);
          }
          this.audioLatencyTrackManager.enqueueSynthesis(this.type, receiveTime);
        }
      }
      else if (message.end_of_source_transcript) {
        console.log('Source transcription ended');
      } 
      else if (message.end_of_target_transcript) {
        console.log('Target transcription ended');
      }
      else if (message.end_of_target_media) {
        console.log('Target media streaming ended');
      } 
      else if (message.end_of_stream) {
        console.log('Stream ended');
        if (this.onStreamEnd) {
          this.onStreamEnd();
        }
      }
      else if (message.error) {
        if (this.onError) {
          this.onError(new Error(message.error));
          // Trigger reconnection through health monitor (with backoff)
          if (!this.isReconnecting) {
            this._handleReconnection();
          }
        }
      }
      else {
        console.warn('Unknown message type:', message);
      }
    } catch (error) {
        console.error('Error handling message:', error);
        if (this.onError) {
          this.onError(error);
        }
    }
  }

  _downsample(buffer, fromRate, toRate) {
      if (fromRate === toRate) return buffer;

      const ratio = fromRate / toRate;
      const input = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
      const outputLength = Math.floor(input.length / ratio);
      const output = new Int16Array(outputLength);

      for (let i = 0; i < outputLength; i++) {
          // Average the samples in each window to avoid aliasing
          const start = Math.floor(i * ratio);
          const end = Math.floor((i + 1) * ratio);
          let sum = 0;
          for (let j = start; j < end; j++) {
              sum += input[j];
          }
          output[i] = Math.round(sum / (end - start));
      }

      return Buffer.from(output.buffer);
  }

  /**
     * Send audio data to the server
     * 
     * @param {ArrayBuffer|Uint8Array} audioData - Audio data chunk
     * @param {Object} [options] - Optional metadata
     * @param {number} [options.timestamp] - Timestamp in milliseconds
     */ 
  async streamAudio(audioStream, sampleRate) {
    try {
        let buffer = Buffer.alloc(0);
        const targetSampleRate = AUDIO_INGEST_SAMPLE_RATE;
        const chunkSize = BUFFER_LEN; // 100ms of audio at 48kHz mono PCM (16000 samples/sec * 0.1 sec * 2 bytes/sample)
        let totalChunksReceived = 0;
        let totalChunksSent = 0;
        let lastLogTime = Date.now();
        const logInterval = 5000; // Log summary every 5 seconds

        console.log(`[${this.type}] 🎬 streamAudio started - chunkSize: ${chunkSize} bytes (${(chunkSize / (targetSampleRate * 2) * 1000).toFixed(0)}ms @ ${targetSampleRate}Hz)`);

        for await (const audioEvent of getTranscribeAudioStream(audioStream, sampleRate)) {
            // Stop streaming if we've been disconnected (e.g., call ended)
            if (!this.shouldReconnect) {
                console.log(`[${this.type}] 🛑 Stopping audio stream - call disconnected`);
                break;
            }

            let chunk = audioEvent.AudioEvent.AudioChunk;
            totalChunksReceived++;

            if (sampleRate > targetSampleRate) {
                chunk = this._downsample(chunk, sampleRate, targetSampleRate);
            }

            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length >= chunkSize) {
                const chunkToSend = buffer.slice(0, chunkSize);
                buffer = buffer.slice(chunkSize);
                totalChunksSent++;

                this.audioLatencyTrackManager.enqueueAudio(this.type, chunkToSend, performance.now());
                this.sendAudio(chunkToSend);
            }

            // Periodic summary logging
            const now = Date.now();
            if (now - lastLogTime > logInterval) {
                console.log(`[${this.type}] 📊 Streaming - Received: ${totalChunksReceived} chunks, Sent: ${totalChunksSent} chunks, Buffer: ${buffer.length} bytes`);
                lastLogTime = now;
            }
        }

        // Final buffer check - CRITICAL: Log if audio was lost
        if (buffer.length > 0) {
            const unsentMs = ((buffer.length / (sampleRate * 2)) * 1000).toFixed(0);
            console.error(`[${this.type}] 🚨 Stream ended with ${buffer.length} bytes (${unsentMs}ms) UNSENT in buffer!`);
            console.warn(`[${this.type}] This audio was NEVER sent to the API and will be LOST`);
        } else {
            console.log(`[${this.type}] ✅ Stream ended cleanly - buffer empty`);
        }

    } catch (error) {
        console.error(`[${this.type}] ❌ Error streaming audio:`, error);
        throw error;
    } finally {
        console.log(`[${this.type}] 🏁 streamAudio ended`);
    }
  }

  sendAudio(audioBuffer) {
    // Drop audio chunks if not connected or WebSocket is null (e.g., during reconnection)
    if (!this.isConnected || !this.ws) {
      const wsState = this.ws ? `readyState=${this.ws.readyState}` : 'ws=null';
      const dropReason = this.isReconnecting ? 'RECONNECTING' : 'DISCONNECTED';

      // ⚠️ ALWAYS log drops (not just in debug mode) - this is critical data!
      console.error(`[${this.type}] 🚫 DROPPING ${audioBuffer.length} bytes - Reason: ${dropReason}, isConnected=${this.isConnected}, ${wsState}`);
      console.warn(`[${this.type}] ⚠️  This audio will NOT be transcribed/translated!`);

      // Track drop statistics
      this.droppedAudioStats.totalDroppedBytes += audioBuffer.length;
      this.droppedAudioStats.totalDroppedChunks++;
      this.droppedAudioStats.dropEvents.push({
        timestamp: Date.now(),
        bytes: audioBuffer.length,
        reason: dropReason,
        isReconnecting: this.isReconnecting,
        isConnected: this.isConnected,
        hasWebSocket: !!this.ws
      });

      // Keep only last 100 drop events to prevent memory leak
      if (this.droppedAudioStats.dropEvents.length > 100) {
        this.droppedAudioStats.dropEvents.shift();
      }

      return;
    }

    try {
        const base64Audio = audioBuffer.toString('base64');
        const payload = JSON.stringify({
            source_media_chunk: {
                data: base64Audio
            }
        });

        this.ws.send(payload);
    } catch (error) {
        console.error(`[${this.type}] ❌ Error sending audio chunk:`, error);
    }
  }

  // Signal end of audio stream
  endAudio() {
    if (!this.isConnected || !this.ws) {
        return;
    }
    console.log('Signaling end of audio stream');
    this.ws.send(JSON.stringify({
        end_of_source_media: {}
    }));
  }

  /**
   * Start a complete session: request + connect
   * 
   * @param {Object} config - Session configuration (same as requestSession)
   * @returns {Promise<void>}
   */
  async startSession(config) {
    if (this.connecting) {
      return;
    }
    this.connecting = true;
    console.log('Starting session with config:', config);
    const session = await this.requestSession(config);
    if (session && session.streaming_url && session.token) {
      await this.connect(session.streaming_url, session.token);
    } else {
      throw new Error('Invalid session response: missing streaming_url or token');
    }
    this.connecting = false;
  }

  /**
   * Reconnect to an existing session
   *
   * @returns {Promise<void>}
   */
  async reconnect() {
    const session = await this.requestReconnection();
    await this.connect(session.streaming_url, session.token);
  }

  /**
   * Handle automatic reconnection when connection is dead
   * @private
   */
  async _handleReconnection() {
    if (!this.shouldReconnect) {
      console.log(`🔄 Auto-reconnection disabled for ${this.type}, skipping`);
      return;
    }

    // ⚠️ CRITICAL: Track reconnection timing
    const reconnectionStartTime = Date.now();

    // Set guard flag to prevent duplicate reconnections
    this.isReconnecting = true;

    // Mark as reconnecting
    this.healthMonitor.startReconnecting();

    // Close zombie connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Calculate backoff
    const backoffMs = this.healthMonitor.getNextBackoff();

    console.error(`🚨 [${this.type}] RECONNECTION STARTED - WebSocket set to NULL, audio will be DROPPED for ${backoffMs}ms!`);
    console.log(`🔄 ${this.type} reconnecting in ${backoffMs}ms...`);

    // Wait for backoff
    const backoffStartTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, backoffMs));
    const actualBackoffMs = Date.now() - backoffStartTime;

    console.log(`⏱️  [${this.type}] Backoff complete after ${actualBackoffMs}ms (expected ${backoffMs}ms)`);

    try {
      console.log(`🔄 Attempting reconnection for ${this.type}...`);

      // Reset latency tracking for new connection
      if (this.audioLatencyTrackManager) {
        this.audioLatencyTrackManager.resetLatencyTracking(this.type);
      }

      // Start new session
      await this.startSession(this.sessionConfig);

      // Success!
      const totalReconnectionTimeMs = Date.now() - reconnectionStartTime;
      console.log(`✅ ${this.type} reconnected successfully after ${totalReconnectionTimeMs}ms`);
      console.warn(`⚠️  [${this.type}] Audio was DROPPED for ${totalReconnectionTimeMs}ms during reconnection!`);

      // Log drop statistics
      const dropStats = this.getDroppedAudioStats();
      console.log(`📊 [${this.type}] Total dropped audio: ${dropStats.totalDroppedSeconds}s (${dropStats.totalDroppedChunks} chunks)`);

      this.healthMonitor.reconnectionSucceeded();
      this.isReconnecting = false; // Clear guard flag

    } catch (error) {
      console.error(`❌ ${this.type} reconnection failed:`, error);

      // Check if we should keep trying
      const keepTrying = this.healthMonitor.reconnectionFailed();

      if (keepTrying && this.shouldReconnect) {
        console.log(`🔄 Retrying ${this.type} reconnection...`);
        // Recursively try again (will use new backoff)
        // Note: isReconnecting stays true for retry
        this._handleReconnection();
      } else {
        console.error(`❌ ${this.type} giving up after ${this.healthMonitor.reconnectAttempts} attempts`);
        this.isReconnecting = false; // Clear guard flag
      }
    }
  }
}

export { DeepLVoiceClient };
