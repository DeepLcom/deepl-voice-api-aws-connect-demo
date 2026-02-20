import { LOGGER_PREFIX } from "../constants";

export class AudioLatencyTrackManager {
    constructor() {
        this.lastCustomerVoiceDetected = null;
        this.lastCustomerSynthesizedAudio = null;
        this.customerSpeaking = false;
        this.lastAgentVoiceDetected = null;
        this.lastAgentSynthesizedAudio = null;
        this.agentSpeaking = false;

        this.customerSynthesisToAgentSynthesisLatencies = [];
        this.agentSynthesisToCustomerSynthesisLatencies = [];
        this.customerSynthesisToAgentVoiceLatencies = [];
        this.agentSynthesisToCustomerVoiceLatencies = [];

        this.vadThreshold = 0.05; // Voice Activity Detection threshold (adjust as needed)
    }

    handleSynthesis(type) {
        const now = performance.now();

        const config = {
            customer: {
                last:       () => this.lastCustomerSynthesizedAudio,
                setLast:    () => this.lastCustomerSynthesizedAudio = now,
                otherLast:  () => this.lastAgentSynthesizedAudio,
                latencies:  this.agentSynthesisToCustomerSynthesisLatencies,
                displayKey: "customer-latency-agentSynthesisToCustomerSynthesis",
            },
            agent: {
                last:       () => this.lastAgentSynthesizedAudio,
                setLast:    () => this.lastAgentSynthesizedAudio = now,
                otherLast:  () => this.lastCustomerSynthesizedAudio,
                latencies:  this.customerSynthesisToAgentSynthesisLatencies,
                displayKey: "agent-latency-customerSynthesisToAgentSynthesis",
            },
        };

        const c = config[type];
        if (!c) {
            console.warn(`${LOGGER_PREFIX} - Unknown synthesis type: ${type}`);
            return;
        }

        const otherLast = c.otherLast();
        if (otherLast && otherLast > c.last()) {
            const latency = now - otherLast;
            c.latencies.push(latency);
            if (c.latencies.length > 100) c.latencies.shift();
            this.updateLatencyDisplay({ latency, ...this.getLatencyStats(c.latencies) }, c.displayKey);
        }

        c.setLast();
    }

    handleAudio(type, buffer) {
        const now = performance.now();

        const config = {
            customer: {
                lastVoiceDetected:  () => this.lastCustomerVoiceDetected,
                setVoiceDetected:   () => this.lastCustomerVoiceDetected = now,
                otherLast:          () => this.lastAgentSynthesizedAudio,
                latencies:          this.agentSynthesisToCustomerVoiceLatencies,
                displayKey:         "customer-latency-agentSynthesisToCustomerVoice",
            },
            agent: {
                lastVoiceDetected:  () => this.lastAgentVoiceDetected,
                setVoiceDetected:   () => this.lastAgentVoiceDetected = now,
                otherLast:          () => this.lastCustomerSynthesizedAudio,
                latencies:          this.customerSynthesisToAgentVoiceLatencies,
                displayKey:         "agent-latency-customerSynthesisToAgentVoice",
            },
        };

        const c = config[type];
        if (!c) {
            console.warn(`${LOGGER_PREFIX} - Unknown audio type: ${type}`);
            return;
        }

        const otherLast = c.otherLast();
        if (otherLast && otherLast > c.lastVoiceDetected() && this.detectVoice(buffer)) {
            c.setVoiceDetected();
            const latency = now - otherLast;
            c.latencies.push(latency);
            if (c.latencies.length > 100) c.latencies.shift();
            this.updateLatencyDisplay({ latency, ...this.getLatencyStats(c.latencies) }, c.displayKey);
        }
    }
    
    detectVoice(buffer) {
        const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);

        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            const normalized = samples[i] / 32768; // Normalize to [-1, 1]
            sum += normalized * normalized; // Power of the signal
        }
        const rms = Math.sqrt(sum / samples.length); // Root mean square
        if (rms > this.vadThreshold) {
            console.log(`${LOGGER_PREFIX} - Voice activity detected - RMS: ${rms.toFixed(4)}`);
        }
        return rms > this.vadThreshold;
    }

    updateLatencyDisplay(latencyData, elementId) {
        const { latency, average, min, max, p95 } = latencyData;
        const element = document.getElementById(elementId);
        const valueSpan = element.querySelector(".latency-value");
        const statsDiv = element.querySelector(".latency-stats");

        valueSpan.textContent = `${Math.round(latency)} ms`;

        // Color code based on latency
        valueSpan.className = 'latency-value';
        if (latency < 2000) {
            valueSpan.classList.add('latency-good');
        } else if (latency < 3000) {
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
}
