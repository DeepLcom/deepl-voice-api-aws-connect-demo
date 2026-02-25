import {
    LOGGER_PREFIX,
    LATENCY_TRACKING_ENABLED,
    VAD_RMS_MIN_THRESHOLD,
    TURN_LATENCY_MAX_MS_GOOD,
    TURN_LATENCY_MAX_MS_OK,
} from "../constants";


export class AudioLatencyTrackManager {
    constructor() {

        // Track chunks with their cumulative audio time
        this.customerAudioChunks = [];  // { sentAt, audioStartMs, audioEndMs }
        this.agentAudioChunks = [];  // { sentAt, audioStartMs, audioEndMs }

        this.customerConcludedTargetTranscriptTimes = [];  // { receivedAt, audioEndTime }
        this.agentConcludedTargetTranscriptTimes = [];  // { receivedAt, audioEndTime }

        this.customerCumulativeAudioTime = 0;  // Total audio sent so far in ms
        this.agentCumulativeAudioTime = 0;  // Total audio sent so far in ms

        this.audioIngestSampleRate = 48000;
        this.bytesPerSample = 2;  // 16-bit audio
        
        this.customerPipelineLatencies = {
            transcription: [], // Audio → Transcription
            translation: [], // Audio → Translation text
            ttsDelta: [], // Translation text → Synthesized audio
        };
        this.agentPipelineLatencies = {
            transcription: [], // Audio → Transcription
            translation: [], // Audio → Translation text
            ttsDelta: [], // Translation text → Synthesized audio
        };

        this.firstCustomerVoiceDetected = null;
        this.lastCustomerVoiceDetected = null;
        this.lastCustomerSynthesizedAudio = null;
        this.customerSpeaking = false;
        this.firstAgentVoiceDetected = null;
        this.lastAgentVoiceDetected = null;
        this.lastAgentSynthesizedAudio = null;
        this.agentSpeaking = false;

        this.customerSynthesisToAgentSynthesisLatencies = [];
        this.agentSynthesisToCustomerSynthesisLatencies = [];
        this.customerSynthesisToAgentVoiceLatencies = [];
        this.agentSynthesisToCustomerVoiceLatencies = [];
        this.customerVoiceToAgentSynthesisLatencies = [];
        this.agentVoiceToCustomerSynthesisLatencies = [];

        this.vadRmsMinThreshold = VAD_RMS_MIN_THRESHOLD // Voice Activity Detection minimum rms threshold

        // --- Async work queue via MessageChannel ---
        this._queue = [];
        const { port1, port2 } = new MessageChannel();
        this._port = port1;
        port2.onmessage = () => this._drain();
    }

    enqueueAudio(type, buffer, timestamp) {
        this._queue.push({ kind: 'audio', type, buffer, timestamp });
        this._port.postMessage(null);
    }

    enqueueTranscription(type, receivedAt, audioEndTime) {
        this._queue.push({ kind: 'transcript', type, receivedAt, audioEndTime });
        this._port.postMessage(null);
    }

    enqueueTranslation(type, receivedAt, audioEndTime) {
        this._queue.push({ kind: 'translation', type, receivedAt, audioEndTime });
        this._port.postMessage(null);
    }

    enqueueSynthesis(type, timestamp) {
        this._queue.push({ kind: 'synthesis', type, timestamp });
        this._port.postMessage(null);
    }

    _drain() {
        while (this._queue.length > 0) {
            const item = this._queue.shift();
            switch (item.kind) {
                case 'audio':
                    this._handleAudio(item.type, item.buffer, item.timestamp);
                    break;
                case 'transcript':
                    this._handleTranscript(item.type, item.receivedAt, item.audioEndTime);
                    break;
                case 'translation':
                    this._handleTranslation(item.type, item.receivedAt, item.audioEndTime);
                    break;
                case 'synthesis':
                    this._handleSynthesis(item.type, item.timestamp);
                    break;
                default:
                    console.warn(`${LOGGER_PREFIX} - Unknown item kind in queue: ${item.kind}`);
            }
        }
    }

    _handleAudio(type, buffer, now) {
        const config = {
            customer: {
                updateAudioChunks:          (chunk) => this.customerAudioChunks.push(chunk),
                trimAudioChunks:            () => this.customerAudioChunks = this.customerAudioChunks.slice(-100),
                getCumulativeAudioTime:     () => this.customerCumulativeAudioTime,
                setCumulativeAudioTime:     (time) => this.customerCumulativeAudioTime = time,
                firstVoiceDetected:         () => this.firstCustomerVoiceDetected,
                setFirstVoiceDetected:      () => this.firstCustomerVoiceDetected = now,
                setLastVoiceDetected:       () => this.lastCustomerVoiceDetected = now,
                otherLastSynthesizedAudio:  () => this.lastAgentSynthesizedAudio,
                latencies:                  this.agentSynthesisToCustomerVoiceLatencies,
                displayKey:                 "customer-latency-agentSynthesisToCustomerVoice",
                vadIndicatorId:             "customerVadIndicator",
            },
            agent: {
                updateAudioChunks:          (chunk) => this.agentAudioChunks.push(chunk),
                trimAudioChunks:            () => this.agentAudioChunks = this.agentAudioChunks.slice(-100),
                getCumulativeAudioTime:     () => this.agentCumulativeAudioTime,
                setCumulativeAudioTime:     (time) => this.agentCumulativeAudioTime = time,
                firstVoiceDetected:         () => this.firstAgentVoiceDetected,
                setFirstVoiceDetected:      () => this.firstAgentVoiceDetected = now,
                setLastVoiceDetected:       () => this.lastAgentVoiceDetected = now,
                otherLastSynthesizedAudio:  () => this.lastCustomerSynthesizedAudio,
                latencies:                  this.customerSynthesisToAgentVoiceLatencies,
                displayKey:                 "agent-latency-customerSynthesisToAgentVoice",
                vadIndicatorId:             "agentVadIndicator",
            },
        };

        const c = config[type];
        if (!c) {
            console.warn(`${LOGGER_PREFIX} - Unknown audio type: ${type}`);
            return;
        }

        // Update VAD indicator even if latency tracking is disabled, since it's a useful UI feature on its own
        const voiceDetected = this.detectVoice(buffer);
        document.getElementById(c.vadIndicatorId)?.classList.toggle("speaking", voiceDetected);
        if (!LATENCY_TRACKING_ENABLED) return;

        // Calculate actual audio duration of this chunk
        const numSamples = buffer.length / this.bytesPerSample;
        const durationMs = (numSamples / this.audioIngestSampleRate) * 1000;
        
        // Track this chunk with precise audio timing
        const chunk = {
            sentAt: now,
            audioStartMs: c.getCumulativeAudioTime(),
            audioEndMs: c.getCumulativeAudioTime() + durationMs
        };
        
        c.updateAudioChunks(chunk);
        c.trimAudioChunks();
        c.setCumulativeAudioTime(c.getCumulativeAudioTime() + durationMs);

        if (voiceDetected) {
            c.setLastVoiceDetected();
            const otherLastSynth = c.otherLastSynthesizedAudio();
            if (otherLastSynth && otherLastSynth > c.firstVoiceDetected()) {
                c.setFirstVoiceDetected();
                this._pushLatency(c.latencies, now - otherLastSynth, c.displayKey);
            }
        }
    }

    _handleTranscript(type, receivedAt, audioEndTime) {
        if (!LATENCY_TRACKING_ENABLED) return;

        const config = {
            customer: {
                pipelineLatencies:  this.customerPipelineLatencies.transcription,
                audioChunks:        this.customerAudioChunks,
                displayKey:         "customer-latency-transcription",
            },
            agent: {
                pipelineLatencies:  this.agentPipelineLatencies.transcription,
                audioChunks:        this.agentAudioChunks,
                displayKey:         "agent-latency-transcription",
            },
        };

        const c = config[type];
        if (!c) {
            console.warn(`${LOGGER_PREFIX} - Unknown transcript type: ${type}`);
            return;
        }

        const chunk = this.findChunkByAudioTime(c.audioChunks, audioEndTime);
        if (chunk) {
            const pipelineLatency = receivedAt - chunk.sentAt;
            console.log(`📊 ${type} transcription latency: ${Math.round(pipelineLatency)}ms`);
            this._pushLatency(c.pipelineLatencies, pipelineLatency, c.displayKey);
        } else {
            console.warn(`${LOGGER_PREFIX} - Could not find matching audio chunk for transcript with audio end time ${audioEndTime} ms`);
        }
    }

    _handleTranslation(type, receivedAt, audioEndTime) {
        if (!LATENCY_TRACKING_ENABLED) return;

        const config = {
            customer: {
                updateConcludedTargetTranscriptTimes: (receivedAt, audioEndTime) => this.customerConcludedTargetTranscriptTimes.push({ receivedAt, audioEndTime }),
                trimConcludedTargetTranscriptTimes:   () => this.customerConcludedTargetTranscriptTimes = this.customerConcludedTargetTranscriptTimes.slice(-100),    
                pipelineLatencies:                    this.customerPipelineLatencies.translation,
                audioChunks:                          this.customerAudioChunks,
                displayKey:                           "customer-latency-translation",
            },
            agent: {
                updateConcludedTargetTranscriptTimes: (receivedAt, audioEndTime) => this.agentConcludedTargetTranscriptTimes.push({ receivedAt, audioEndTime }),
                trimConcludedTargetTranscriptTimes:   () => this.agentConcludedTargetTranscriptTimes = this.agentConcludedTargetTranscriptTimes.slice(-100),    
                pipelineLatencies:                    this.agentPipelineLatencies.translation,
                audioChunks:                          this.agentAudioChunks,
                displayKey:                           "agent-latency-translation",
            },
        };

        const c = config[type];
        if (!c) {
            console.warn(`${LOGGER_PREFIX} - Unknown translation type: ${type}`);
            return;
        }

        c.updateConcludedTargetTranscriptTimes(receivedAt, audioEndTime);
        c.trimConcludedTargetTranscriptTimes();

        const chunk = this.findChunkByAudioTime(c.audioChunks, audioEndTime);
        if (chunk) {
            const pipelineLatency = receivedAt - chunk.sentAt;
            console.log(`📊 ${type} translation latency: ${Math.round(pipelineLatency)}ms`);
            this._pushLatency(c.pipelineLatencies, pipelineLatency, c.displayKey);
        } else {
            console.warn(`${LOGGER_PREFIX} - Could not find matching audio chunk for translation with audio end time ${audioEndTime} ms`);
        }
    }

    _handleSynthesis(type, now) {
        if (!LATENCY_TRACKING_ENABLED) return;

        const config = {
            customer: {
                concludedTargetTranscriptTimes: () => this.customerConcludedTargetTranscriptTimes,
                pipelineLatencies:              this.customerPipelineLatencies,
                lastSynthesizedAudio:           () => this.lastCustomerSynthesizedAudio,
                setLastSynthesizedAudio:        () => this.lastCustomerSynthesizedAudio = now,
                otherLastSynthesizedAudio:      () => this.lastAgentSynthesizedAudio,
                otherLastVoiceDetected:         () => this.lastAgentVoiceDetected,
                synthToSynthLatencies:          this.agentSynthesisToCustomerSynthesisLatencies,
                audioToSynthLatencies:          this.agentVoiceToCustomerSynthesisLatencies,
                ttsDisplayKey:                  "customer-latency-tts",
                synthToSynthDisplayKey:         "customer-latency-agentSynthesisToCustomerSynthesis",
                audioToSynthDisplayKey:         "customer-latency-agentVoiceToCustomerSynthesis",
            },
            agent: {
                concludedTargetTranscriptTimes: () => this.agentConcludedTargetTranscriptTimes,
                pipelineLatencies:              this.agentPipelineLatencies, 
                lastSynthesizedAudio:           () => this.lastAgentSynthesizedAudio,
                setLastSynthesizedAudio:        () => this.lastAgentSynthesizedAudio = now,
                otherLastSynthesizedAudio:      () => this.lastCustomerSynthesizedAudio,
                otherLastVoiceDetected:         () => this.lastCustomerVoiceDetected,
                synthToSynthLatencies:          this.customerSynthesisToAgentSynthesisLatencies,
                audioToSynthLatencies:          this.customerVoiceToAgentSynthesisLatencies,
                ttsDisplayKey:                  "agent-latency-tts",
                synthToSynthDisplayKey:         "agent-latency-customerSynthesisToAgentSynthesis",
                audioToSynthDisplayKey:         "agent-latency-customerVoiceToAgentSynthesis",
            },
        };

        const c = config[type];
        if (!c) {
            console.warn(`${LOGGER_PREFIX} - Unknown synthesis type: ${type}`);
            return;
        }

        const concludedTargetTranscriptTimes = c.concludedTargetTranscriptTimes();
        if (concludedTargetTranscriptTimes.length > 0) {
            const lastTranscript = concludedTargetTranscriptTimes[concludedTargetTranscriptTimes.length - 1];
            const pipelineLatency = now - lastTranscript.receivedAt;
            this._pushLatency(c.pipelineLatencies.ttsDelta, pipelineLatency, c.ttsDisplayKey);
        }

        const otherLastSynth = c.otherLastSynthesizedAudio();
        if (otherLastSynth && otherLastSynth > c.lastSynthesizedAudio()) {
            this._pushLatency(c.synthToSynthLatencies, now - otherLastSynth, c.synthToSynthDisplayKey);
        }

        const otherLastVoice = c.otherLastVoiceDetected();
        if (otherLastVoice && otherLastVoice > c.lastSynthesizedAudio()) {
            this._pushLatency(c.audioToSynthLatencies, now - otherLastVoice, c.audioToSynthDisplayKey);
        }

        c.setLastSynthesizedAudio();
    }

    _pushLatency(arr, latency, displayKey) {
        arr.push(latency);
        if (arr.length > 100) arr.shift();
        this.updateLatencyDisplay({ latency, ...this.getLatencyStats(arr) }, displayKey);
    }

    detectVoice(buffer) {
        const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);

        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            const normalized = samples[i] / 32768; // Normalize to [-1, 1]
            sum += normalized * normalized; // Power of the signal
        }
        const rms = Math.sqrt(sum / samples.length); // Root mean square
        const minimumRmsThresholdExceeded = rms > this.vadRmsMinThreshold;

        return minimumRmsThresholdExceeded
    }

    updateLatencyDisplay(latencyData, elementId) {
        const { latency, average, min, max, p95 } = latencyData;
        const element = document.getElementById(elementId);
        const valueSpan = element.querySelector(".latency-value");
        const statsDiv = element.querySelector(".latency-stats");

        valueSpan.textContent = `${Math.round(latency)} ms`;

        // Color code based on latency
        valueSpan.className = 'latency-value';
        if (latency < TURN_LATENCY_MAX_MS_GOOD) {
            valueSpan.classList.add('latency-good');
        } else if (latency < TURN_LATENCY_MAX_MS_OK) {
            valueSpan.classList.add('latency-ok');
        } else {
            valueSpan.classList.add('latency-bad');
        }

        statsDiv.innerHTML = `Avg: ${Math.round(average)} | Min: ${Math.round(min)} | Max: ${Math.round(max)} | P95: ${Math.round(p95)}`;
    }

    getLatencyStats(latencies) {
        if (latencies.length === 0) return { average: 0, min: 0, max: 0, p95: 0 };
        const sorted = latencies.sort((a, b) => a - b);
        const sum = sorted.reduce((acc, val) => acc + val, 0);
        const average = sum / sorted.length;
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        return { average, min, max, p95 };
    }


  findChunkByAudioTime(audioChunks, audioTimeMs) {
    // Find the chunk that contains this audio timestamp
    for (let i = 0; i < audioChunks.length; i++) {
      const chunk = audioChunks[i];
      if (audioTimeMs >= chunk.audioStartMs && audioTimeMs <= chunk.audioEndMs) {
        return chunk;
      }
    }
    
    // If exact match not found, find closest chunk before this time
    for (let i = audioChunks.length - 1; i >= 0; i--) {
      if (audioChunks[i].audioEndMs <= audioTimeMs) {
        return audioChunks[i];
      }
    }
    
    return null;
  }

  resetLatencyTracking(type) {
    if (type === 'customer') {
      this.customerAudioChunks = [];
      this.customerCumulativeAudioTime = 0;
      this.customerConcludedTargetTranscriptTimes = [];
      this.customerPipelineLatencies = {
        transcription: [],
        translation: [],
        ttsDelta: [],
      };
      this.firstCustomerVoiceDetected = null;
      this.lastCustomerVoiceDetected = null;
      this.lastCustomerSynthesizedAudio = null;
    } else if (type === 'agent') {
      this.agentAudioChunks = [];
      this.agentCumulativeAudioTime = 0;
      this.agentConcludedTargetTranscriptTimes = [];
      this.agentPipelineLatencies = {
        transcription: [],
        translation: [],
        ttsDelta: [],
      };
      this.firstAgentVoiceDetected = null;
      this.lastAgentVoiceDetected = null;
      this.lastAgentSynthesizedAudio = null;
    }
    this.customerSynthesisToAgentSynthesisLatencies = [];
    this.agentSynthesisToCustomerSynthesisLatencies = [];
    this.customerSynthesisToAgentVoiceLatencies = [];
    this.agentSynthesisToCustomerVoiceLatencies = [];
    this.customerVoiceToAgentSynthesisLatencies = [];
    this.agentVoiceToCustomerSynthesisLatencies = [];
  }
}
