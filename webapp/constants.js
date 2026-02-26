export const DEPRECATED_CONNECT_DOMAIN = "awsapps.com";

export const SESSION_STORAGE_KEYS = {};

export const LOGGER_PREFIX = "CCP-V2V";

export const CUSTOMER_TRANSLATION_TO_CUSTOMER_VOLUME = 0.1;
export const AGENT_TRANSLATION_TO_AGENT_VOLUME = 0.1;

export const TRANSCRIBE_PARTIAL_RESULTS_STABILITY = ["low", "medium", "high"];

export const AUDIO_FEEDBACK_FILE_PATH = "./assets/background_noise.wav";

export const PLAYBACK_RATE_TARGET = 0.1; // below this, play at normal speed
export const MAX_PLAYBACK_RATE = 1.06; // hard ceiling
export const PLAYBACK_RATE_FACTOR = 1.008; // rate multiplier per 0.1s ahead
// Latency constants
export const LATENCY_TRACKING_ENABLED = true;
export const VAD_RMS_MIN_THRESHOLD = 0.05;
export const PIPELINE_LATENCY_MAX_MS_GOOD = 2000;
export const PIPELINE_LATENCY_MAX_MS_OK = 3000;
export const TURN_LATENCY_MAX_MS_GOOD = 5000;
export const TURN_LATENCY_MAX_MS_OK = 10000;

// WebSocket Health Monitoring constants
export const HEALTH_CHECK_INTERVAL_MS = 1000; // Check health every 1 second
export const DEGRADED_THRESHOLD_MS = 3000; // Yellow warning after 3s
export const POOR_THRESHOLD_MS = 5000; // Orange warning after 5s

// Zombie connection detection timeouts (configurable via dashboard)
export const ZOMBIE_DETECTION_TIMEOUT_SPEAKING_MS = 10000; // 10s - Timeout when user is actively speaking
export const ZOMBIE_DETECTION_TIMEOUT_SILENT_MS = 60000;   // 60s - Timeout when user is silent
export const SPEECH_GRACE_PERIOD_MS = 5000;                // 5s - Grace period after speech ends for pipeline processing

export const MAX_RECONNECT_ATTEMPTS = 5; // Give up after 5 failed attempts
export const INITIAL_BACKOFF_MS = 1000; // Start with 1s backoff
export const MAX_BACKOFF_MS = 30000; // Cap backoff at 30s
