// Supported languages based on production deployment configuration
// Source: /Users/hmls/deepl/code/fullstack/deployment/voice-processor/values-prod.yaml
// DEEPL_VOICE_PROCESSOR_TRANSLATION_LLM_SOURCELANGUAGES (line 128)
// DEEPL_VOICE_PROCESSOR_TEXT_TO_SPEECH_PROXY_ENABLED_LANGUAGES (line 84)

// Source languages for transcription and translation
export const SUPPORTED_SOURCE_LANGUAGES = [
  { "language": "de", "name": "German" },
  { "language": "en", "name": "English" },
  { "language": "es", "name": "Spanish" },
  { "language": "fr", "name": "French" },
  { "language": "id", "name": "Indonesian" },
  { "language": "it", "name": "Italian" },
  { "language": "ja", "name": "Japanese" },
  { "language": "ko", "name": "Korean" },
  { "language": "nl", "name": "Dutch" },
  { "language": "pl", "name": "Polish" },
  { "language": "pt", "name": "Portuguese" },
  { "language": "ro", "name": "Romanian" },
  { "language": "ru", "name": "Russian" },
  { "language": "sv", "name": "Swedish" },
  { "language": "tr", "name": "Turkish" },
  { "language": "uk", "name": "Ukrainian" },
  { "language": "zh", "name": "Chinese" }
];

// Target languages with speech synthesis enabled (S2S)
export const SUPPORTED_TARGET_LANGUAGES = [
  { "language": "ar", "name": "Arabic" },
  { "language": "bg", "name": "Bulgarian" },
  { "language": "cs", "name": "Czech" },
  { "language": "da", "name": "Danish" },
  { "language": "de", "name": "German" },
  { "language": "el", "name": "Greek" },
  { "language": "en", "name": "English" },
  { "language": "en-GB", "name": "English (British)" },
  { "language": "en-US", "name": "English (American)" },
  { "language": "es", "name": "Spanish" },
  { "language": "fi", "name": "Finnish" },
  { "language": "fr", "name": "French" },
  { "language": "hu", "name": "Hungarian" },
  { "language": "id", "name": "Indonesian" },
  { "language": "it", "name": "Italian" },
  { "language": "ja", "name": "Japanese" },
  { "language": "ko", "name": "Korean" },
  { "language": "nb", "name": "Norwegian (Bokmål)" },
  { "language": "nl", "name": "Dutch" },
  { "language": "pl", "name": "Polish" },
  { "language": "pt", "name": "Portuguese" },
  { "language": "pt-BR", "name": "Portuguese (Brazilian)" },
  { "language": "pt-PT", "name": "Portuguese (European)" },
  { "language": "ro", "name": "Romanian" },
  { "language": "ru", "name": "Russian" },
  { "language": "sk", "name": "Slovak" },
  { "language": "sv", "name": "Swedish" },
  { "language": "tr", "name": "Turkish" },
  { "language": "uk", "name": "Ukrainian" },
  { "language": "vi", "name": "Vietnamese" },
  { "language": "zh", "name": "Chinese" },
  { "language": "zh-Hans", "name": "Chinese (Simplified)" },
  { "language": "zh-Hant", "name": "Chinese (Traditional)" }
];
