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
