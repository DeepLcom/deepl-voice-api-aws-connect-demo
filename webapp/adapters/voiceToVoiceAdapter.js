import { getTranscribeAudioStream } from "../utils/transcribeUtils";
import { SUPPORTED_SOURCE_LANGUAGES, SUPPORTED_TARGET_LANGUAGES } from "../supportedLanguages.js";


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
    this.sampleRate = 48000;
    this.bytesPerSample = 2;  // 16-bit audio
    
    this.latencyMetrics = {
      transcription: [],      // Audio → Transcription
      translation: [],        // Audio → Translation text
      audioSynthesis: [],     // Translation text → Synthesized audio (NEW)
    };
    this.audioLatencyTrackManager = options.audioLatencyTrackManager;
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
   * @param {string} [config.targetMediaVoice] - Optional desired voice for TTS output (e.g., 'female1', 'male1')
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
    console.log('Requesting session with body:', body);

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
        console.log('WebSocket connection established');
        this.isConnected = true;

        if (this.onConnect) {
          this.onConnect();
        }
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
      
      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };
      
      this.ws.onclose = (event) => {
        console.log('🔴 WebSocket closed: ', event.reason);
        this.isConnected = false;

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
    if (this.ws) {
      // Set flag to prevent auto-reconnect
      this.ws.close();
      this.ws = null;
    }
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
                console.log(`${this.type} transcription update - concluded text: ${concludedText}`);
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
                console.log(`${this.type} translation update - concluded text: ${concludedText}`);
                this.onTranslation(concludedText);

            }
        }
      }
      else if (message.target_media_chunk) {
        const update = message.target_media_chunk;
        
        if (update.data && update.data.length > 0) {
          if (this.onAudio) {
              const targetMediaChunk = message.target_media_chunk;
              const data = targetMediaChunk.data;
              console.log(`${this.type} target media chunk update: ${data.length} bytes`);
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
          // close and restart the session
          this.disconnect();
          this.startSession(this.sessionConfig).catch(error => {
              console.error('Failed to restart session after error:', error);
          });
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
        const chunkSize = 9600; // 100ms of audio at 48kHz mono PCM (16000 samples/sec * 0.1 sec * 2 bytes/sample)
        for await (const audioEvent of getTranscribeAudioStream(audioStream, sampleRate)) {
            let chunk = audioEvent.AudioEvent.AudioChunk;
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= chunkSize) {
                const chunkToSend = buffer.slice(0, chunkSize);
                buffer = buffer.slice(chunkSize);

                this.audioLatencyTrackManager.enqueueAudio(this.type, chunkToSend, performance.now());
                this.sendAudio(chunkToSend);
            }
        }  
    } catch (error) {
        console.error('Error streaming audio:', error);
        throw error;
    } finally {
        console.log('streamAudio ended');
    }
  }

  sendAudio(audioBuffer) {
    if (!this.isConnected) {
      if (this.shouldReconnect) {
        console.warn('WebSocket not connected, attempting to start new session...');
        this.audioLatencyTrackManager.resetLatencyTracking(this.type);
        this.startSession(this.sessionConfig).catch(error => {
            console.error('Failed to start new session during sendAudio:', error);
        });
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
        console.error('Error sending audio chunk:', error);
    }
  }

  // Signal end of audio stream
  endAudio() {
    if (!this.isConnected) {
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
}

export { DeepLVoiceClient };
