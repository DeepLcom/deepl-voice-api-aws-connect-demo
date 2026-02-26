// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "./style.css";
import "amazon-connect-streams";

import MicrophoneStream from "microphone-stream";

import { getConnectURLS, addUpdateLocalStorageKey, getLocalStorageValueByKey, base64ToArrayBuffer, isStringUndefinedNullEmpty, isDebugMode } from "./utils/commonUtility";
import {
  AGENT_TRANSLATION_TO_AGENT_VOLUME,
  AUDIO_FEEDBACK_FILE_PATH,
  CUSTOMER_TRANSLATION_TO_CUSTOMER_VOLUME,
  LOGGER_PREFIX,
  LATENCY_TRACKING_ENABLED,
} from "./constants";
import { getLoginUrl, getValidTokens, handleRedirect, isAuthenticated, logout, setRedirectURI, startTokenRefreshTimer } from "./utils/authUtility";
import { AudioStreamManager } from "./managers/AudioStreamManager";
import { SessionTrackManager, TrackType } from "./managers/SessionTrackManager";
import { createMicrophoneStream } from "./utils/transcribeUtils";
import { listStreamingLanguages } from "./adapters/transcribeAdapter";
import { CONNECT_CONFIG } from "./config";
import { AudioContextManager } from "./managers/AudioContextManager";
import { AudioInputTestManager } from "./managers/InputTestManager";
import { DeepLVoiceClient } from "./adapters/voiceToVoiceAdapter";
import { AudioLatencyTrackManager } from "./managers/AudioLatencyTrackManager";
import { SearchableSelect } from "./components/SearchableSelect.js";

let connect = {};
let CurrentUser = {};
let CCP_V2V = {};

let CurrentAgentConnectionId;
let ConnectSoftPhoneManager;
let IsAgentTranscriptionMuted = false;

// AudioContextManager to manage the AudioContext
let AudioContextMgr = new AudioContextManager();

// AgentMicTestManager to test agent's mic
let AgentMicTestManager;

//Agent Mic Stream used as input for Amazon Transcribe when transcribing agent's voice
let AmazonTranscribeToCustomerAudioStream;
//Customer Speaker Stream used as input for Amazon Transcribe when transcribing customer's voice
let AmazonTranscribeFromCustomerAudioStream;

// SessionTrackManager to manage the current track streaming to the customer
let RTCSessionTrackManager;

// AudioStreamManager to manage the stream that goes to Customer
let ToCustomerAudioStreamManager;

// AudioStreamManager to manage the stream that goes to Agent
let ToAgentAudioStreamManager;

// DeepLVoiceClient to manage the connection and audio streaming with DeepL Voice for Agent
let DeepLVoiceClientAgent;

// DeepLVoiceClient to manage the connection and audio streaming with DeepL Voice for Customer
let DeepLVoiceClientCustomer;

// AudioLatencyTrackManager to manage audio latency tracking and VAD state
let audioLatencyTrackManager;

// SearchableSelect instances for language selection
let customerLanguageSearchable;
let agentLanguageSearchable;
let customerTranslateFromLanguageSearchable;
let customerTranslateToLanguageSearchable;
let agentTranslateFromLanguageSearchable;
let agentTranslateToLanguageSearchable;

/**
 * Display error message to user
 * @param {string} message - Error message to display
 */
function raiseError(message) {
  console.error(`${LOGGER_PREFIX} - raiseError:`, message);
  alert(message);
}

async function getAudioContext() {
  if (AudioContextMgr == null) {
    AudioContextMgr = new AudioContextManager();
  }
  const audioContext = await AudioContextMgr.getAudioContext();
  return audioContext;
}

async function getAgentMicTestManager() {
  if (AgentMicTestManager == null) {
    AgentMicTestManager = new AudioInputTestManager(await getAudioContext());
  }
  return AgentMicTestManager;
}

async function replaceRTCSessionTrackManager(peerConnection) {
  if (RTCSessionTrackManager != null) {
    await RTCSessionTrackManager.dispose();
  }
  RTCSessionTrackManager = new SessionTrackManager(peerConnection, await getAudioContext());
}

async function replaceToCustomerAudioStreamManager() {
  if (ToCustomerAudioStreamManager != null) {
    await ToCustomerAudioStreamManager.dispose();
  }
  ToCustomerAudioStreamManager = new AudioStreamManager(CCP_V2V.UI.toCustomerAudioElement, await getAudioContext());
}

async function replaceToAgentAudioStreamManager() {
  if (ToAgentAudioStreamManager != null) {
    await ToAgentAudioStreamManager.dispose();
  }
  ToAgentAudioStreamManager = new AudioStreamManager(CCP_V2V.UI.toAgentAudioElement, await getAudioContext());
}

window.addEventListener("load", () => {
  initializeApp();
});

async function initializeApp() {
  try {
    console.info(`${LOGGER_PREFIX} - initializeApp - Initializing app`);
    setRedirectURI();
    // Check if we're returning from Cognito login
    const isRedirect = await handleRedirect();
    if (isRedirect) {
      console.info(`${LOGGER_PREFIX} - initializeApp - Redirected from Cognito login`);
      startTokenRefreshTimer();
      showApp();
      return;
    }

    // Check authentication and token expiration
    if (!isAuthenticated()) {
      const tokens = await getValidTokens();
      if (tokens?.accessToken == null || tokens?.idToken == null || tokens?.refreshToken == null) {
        // No valid token available, redirect to login
        console.info(`${LOGGER_PREFIX} - initializeApp - No valid token available, redirecting to login`);
        window.location.href = getLoginUrl();
        return;
      }
    }

    // Show app with valid token
    console.info(`${LOGGER_PREFIX} - initializeApp - Valid token available, showing app`);
    startTokenRefreshTimer();
    showApp();
  } catch (error) {
    console.error(`${LOGGER_PREFIX} - initializeApp - Error initializing app:`, error);
    window.location.href = getLoginUrl();
  }
}

function showApp() {
  onLoad();
}

const onLoad = async () => {
  console.info(`${LOGGER_PREFIX} - index loaded`);
  bindUIElements();
  initEventListeners();
  CCP_V2V.UI.logoutButton.style.display = "block";
  getDevices();
  setAudioElementsSinkIds();
  loadTranslateLanguageCodes();
  loadTranslationFormalities();
  loadVoiceIds();
  setLatencyTrackingUIVisibility();
  initCCP(onConnectInitialized);
};

const bindUIElements = () => {
  window.connect.CCP_V2V = CCP_V2V;

  CCP_V2V.UI = {
    logoutButton: document.getElementById("logoutButton"),
    divInstanceSetup: document.getElementById("divInstanceSetup"),
    divMain: document.getElementById("divMain"),

    ccpContainer: document.querySelector("#ccpContainer"),

    spnCurrentConnectInstanceURL: document.getElementById("spnCurrentConnectInstanceURL"),
    tbConnectInstanceURL: document.getElementById("tbConnectInstanceURL"),
    btnSetConnectInstanceURL: document.getElementById("btnSetConnectInstanceURL"),
    btnStreamFile: document.getElementById("btnStreamFile"),
    btnStreamMic: document.getElementById("btnStreamMic"),
    btnRemoveAudioStream: document.getElementById("btnRemoveAudioStream"),

    //mic & speaker UI elements
    micSelect: document.getElementById("micSelect"),
    speakerSelect: document.getElementById("speakerSelect"),

    fromCustomerAudioElement: document.getElementById("remote-audio"),
    toCustomerAudioElement: document.getElementById("toCustomerAudioElement"),
    toAgentAudioElement: document.getElementById("toAgentAudioElement"),

    testAudioButton: document.getElementById("testAudioButton"),
    testMicButton: document.getElementById("testMicButton"),
    speakerSaveButton: document.getElementById("speakerSaveButton"),
    micSaveButton: document.getElementById("micSaveButton"),

    echoCancellationCheckbox: document.getElementById("echoCancellationCheckbox"),
    noiseSuppressionCheckbox: document.getElementById("noiseSuppressionCheckbox"),
    autoGainControlCheckbox: document.getElementById("autoGainControlCheckbox"),

    //Transcribe Customer UI Elements
    customerTranscribeLanguageSelect: document.getElementById("customerTranscribeLanguageSelect"),
    customerTranscribeLanguageSaveButton: document.getElementById("customerTranscribeLanguageSaveButton"),
    customerTranscribePartialResultsStabilitySelect: document.getElementById("customerTranscribePartialResultsStabilitySelect"),
    customerTranscribePartialResultsStabilitySaveButton: document.getElementById("customerTranscribePartialResultsStabilitySaveButton"),
    customerStartTranscriptionButton: document.getElementById("customerStartTranscriptionButton"),
    customerStopTranscriptionButton: document.getElementById("customerStopTranscriptionButton"),
    customerTranscriptionTextOutputDiv: document.getElementById("customerTranscriptionTextOutputDiv"),
    customerStreamMicCheckbox: document.getElementById("customerStreamMicCheckbox"),
    customerStreamMicVolume: document.getElementById("customerStreamMicVolume"),
    customerStreamTranslationCheckbox: document.getElementById("customerStreamTranslationCheckbox"),
    customerAudioFeedbackEnabledCheckbox: document.getElementById("customerAudioFeedbackEnabledCheckbox"),
    //Translate Customer UI Elements - New simplified
    customerLanguageSelect: document.getElementById("customerLanguageSelect"),
    customerLanguageSaveButton: document.getElementById("customerLanguageSaveButton"),
    customerFormalitySelect: document.getElementById("customerFormalitySelect"),
    //Translate Customer UI Elements - Original (hidden)
    customerTranslateFromLanguageSelect: document.getElementById("customerTranslateFromLanguageSelect"),
    customerTranslateToLanguageSelect: document.getElementById("customerTranslateToLanguageSelect"),
    customerTranslateFromLanguageSaveButton: document.getElementById("customerTranslateFromLanguageSaveButton"),
    customerTranslateToLanguageSaveButton: document.getElementById("customerTranslateToLanguageSaveButton"),
    customerTranslatedTextOutputDiv: document.getElementById("customerTranslatedTextOutputDiv"),
    //Synthesis Customer UI Elements
    customerVoiceIdSelect: document.getElementById("customerVoiceIdSelect"),
    customerVoiceIdSaveButton: document.getElementById("customerVoiceIdSaveButton"),
    customerPollyLanguageCodeSelect: document.getElementById("customerPollyLanguageCodeSelect"),
    customerPollyLanguageCodeSaveButton: document.getElementById("customerPollyLanguageCodeSaveButton"),
    customerPollyEngineSelect: document.getElementById("customerPollyEngineSelect"),
    customerPollyEngineSaveButton: document.getElementById("customerPollyEngineSaveButton"),
    customerPollyVoiceIdSelect: document.getElementById("customerPollyVoiceIdSelect"),
    customerPollyVoiceIdSaveButton: document.getElementById("customerPollyVoiceIdSaveButton"),

    //Transcribe Agent UI Elements
    agentTranscribeLanguageSelect: document.getElementById("agentTranscribeLanguageSelect"),
    agentTranscribeLanguageSaveButton: document.getElementById("agentTranscribeLanguageSaveButton"),
    agentTranscribePartialResultsStabilitySelect: document.getElementById("agentTranscribePartialResultsStabilitySelect"),
    agentTranscribePartialResultsStabilitySaveButton: document.getElementById("agentTranscribePartialResultsStabilitySaveButton"),
    agentStartTranscriptionButton: document.getElementById("agentStartTranscriptionButton"),
    agentStopTranscriptionButton: document.getElementById("agentStopTranscriptionButton"),
    agentMuteTranscriptionButton: document.getElementById("agentMuteTranscriptionButton"),
    agentTranscriptionTextOutputDiv: document.getElementById("agentTranscriptionTextOutputDiv"),
    agentAudioFeedbackEnabledCheckbox: document.getElementById("agentAudioFeedbackEnabledCheckbox"),
    agentStreamMicCheckbox: document.getElementById("agentStreamMicCheckbox"),
    agentStreamMicVolume: document.getElementById("agentStreamMicVolume"),
    agentStreamTranslationCheckbox: document.getElementById("agentStreamTranslationCheckbox"),
    //Translate Agent UI Elements - New simplified
    agentLanguageSelect: document.getElementById("agentLanguageSelect"),
    agentLanguageSaveButton: document.getElementById("agentLanguageSaveButton"),
    agentFormalitySelect: document.getElementById("agentFormalitySelect"),
    //Translate Agent UI Elements - Original (hidden)
    agentTranslateFromLanguageSelect: document.getElementById("agentTranslateFromLanguageSelect"),
    agentTranslateToLanguageSelect: document.getElementById("agentTranslateToLanguageSelect"),
    agentTranslateFromLanguageSaveButton: document.getElementById("agentTranslateFromLanguageSaveButton"),
    agentTranslateToLanguageSaveButton: document.getElementById("agentTranslateToLanguageSaveButton"),
    agentTranslateTextInput: document.getElementById("agentTranslateTextInput"),
    agentTranslateTextButton: document.getElementById("agentTranslateTextButton"),
    agentTranslatedTextOutputDiv: document.getElementById("agentTranslatedTextOutputDiv"),
    //Synthesis Agent UI Elements
    agentVoiceIdSelect: document.getElementById("agentVoiceIdSelect"),
    agentVoiceIdSaveButton: document.getElementById("agentVoiceIdSaveButton"),
    agentPollyLanguageCodeSelect: document.getElementById("agentPollyLanguageCodeSelect"),
    agentPollyLanguageCodeSaveButton: document.getElementById("agentPollyLanguageCodeSaveButton"),
    agentPollyEngineSelect: document.getElementById("agentPollyEngineSelect"),
    agentPollyEngineSaveButton: document.getElementById("agentPollyEngineSaveButton"),
    agentPollyVoiceIdSelect: document.getElementById("agentPollyVoiceIdSelect"),
    agentPollyVoiceIdSaveButton: document.getElementById("agentPollyVoiceIdSaveButton"),
    agentPollyTextInput: document.getElementById("agentPollyTextInput"),
    agentSynthesizeSpeechButton: document.getElementById("agentSynthesizeSpeechButton"),

    //Transcript UI Elements
    divTranscriptContainer: document.getElementById("divTranscriptContainer"),

    //Latency Customer UI Elements
    latencyTrackingPanels: document.querySelectorAll(".control-group-latency"),
  };
};

const initEventListeners = () => {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    console.info(`${LOGGER_PREFIX} - devicechange event fired`);
    getDevices();
  });

  CCP_V2V.UI.logoutButton.addEventListener("click", logout);

  //mic & speaker ui buttons
  CCP_V2V.UI.testAudioButton.addEventListener("click", testAudioOutput);
  CCP_V2V.UI.testMicButton.addEventListener("click", () => {
    if (CCP_V2V.UI.testMicButton.innerText === "Test") {
      testMicrophone();
      CCP_V2V.UI.testMicButton.innerText = "Stop";
    } else if (CCP_V2V.UI.testMicButton.innerText === "Stop") {
      stopTestMicrophone();
      CCP_V2V.UI.testMicButton.innerText = "Test";
    }
  });

  CCP_V2V.UI.speakerSaveButton.addEventListener("click", () => addUpdateLocalStorageKey("selectedSpeakerId", CCP_V2V.UI.speakerSelect.value));
  CCP_V2V.UI.micSaveButton.addEventListener("click", () => addUpdateLocalStorageKey("selectedMicId", CCP_V2V.UI.micSelect.value));

  CCP_V2V.UI.customerStreamMicCheckbox.addEventListener("change", (event) => {
    if (event.target.checked) {
      CCP_V2V.UI.fromCustomerAudioElement.muted = false;
      CCP_V2V.UI.fromCustomerAudioElement.volume = parseFloat(CCP_V2V.UI.customerStreamMicVolume.value);
    } else {
      CCP_V2V.UI.fromCustomerAudioElement.muted = true;
    }
  });

  CCP_V2V.UI.customerStreamMicVolume.addEventListener("input", (event) => {
    const micVolume = parseFloat(event.target.value);
    console.log(`${LOGGER_PREFIX} - customerStreamMicVolume input - Setting microphone volume to: ${micVolume}`);
    CCP_V2V.UI.fromCustomerAudioElement.volume = micVolume;
  });

  CCP_V2V.UI.customerAudioFeedbackEnabledCheckbox.addEventListener("change", (event) => {
    if (event.target.checked) {
      if (ToCustomerAudioStreamManager != null) ToCustomerAudioStreamManager.enableAudioFeedback(AUDIO_FEEDBACK_FILE_PATH);
    } else {
      if (ToCustomerAudioStreamManager != null) ToCustomerAudioStreamManager.disableAudioFeedback();
    }
  });

  //Translate Customer UI buttons
  CCP_V2V.UI.customerTranslateFromLanguageSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("customerTranslateFromLanguage", CCP_V2V.UI.customerTranslateFromLanguageSelect.value);
  });
  CCP_V2V.UI.customerTranslateToLanguageSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("customerTranslateToLanguage", CCP_V2V.UI.customerTranslateToLanguageSelect.value);
  });
  CCP_V2V.UI.customerFormalitySelect.addEventListener("change", async () => {
    addUpdateLocalStorageKey("customerFormality", CCP_V2V.UI.customerFormalitySelect.value)
    await reloadConfigs();
  })
  //Synthesis Customer UI buttons
  CCP_V2V.UI.customerVoiceIdSelect.addEventListener("change", async (e) => {
    addUpdateLocalStorageKey("customerVoiceId", CCP_V2V.UI.customerVoiceIdSelect.value);
    if (e.target.value !== "disabled") await reloadConfigs();
  })
  CCP_V2V.UI.customerVoiceIdSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("customerVoiceId", CCP_V2V.UI.customerVoiceIdSelect.value);
  });

  CCP_V2V.UI.agentMuteTranscriptionButton.addEventListener("click", () => {
    CCP_V2V.UI.agentMuteTranscriptionButton.textContent = IsAgentTranscriptionMuted ? "Unmute" : "Mute";
    toggleAgentTranscriptionMute();
  });

  CCP_V2V.UI.agentAudioFeedbackEnabledCheckbox.addEventListener("change", (event) => {
    if (event.target.checked) {
      if (ToAgentAudioStreamManager != null) ToAgentAudioStreamManager.enableAudioFeedback(AUDIO_FEEDBACK_FILE_PATH);
    } else {
      if (ToAgentAudioStreamManager != null) ToAgentAudioStreamManager.disableAudioFeedback();
    }
  });

  CCP_V2V.UI.agentStreamMicCheckbox.addEventListener("change", (event) => {
    const selectedMic = CCP_V2V.UI.micSelect.value;
    const micConstraints = getMicrophoneConstraints(selectedMic);
    const micVolume = parseFloat(CCP_V2V.UI.agentStreamMicVolume.value);
    if (event.target.checked) {
      if (ToCustomerAudioStreamManager != null) {
        console.log(`${LOGGER_PREFIX} - agentStreamMicCheckbox change - Starting microphone with volume: ${micVolume}`);
        ToCustomerAudioStreamManager.startMicrophone(micConstraints).then(() => {
          ToCustomerAudioStreamManager.setMicrophoneVolume(micVolume);
        })
      }    } else {
      if (ToCustomerAudioStreamManager != null) ToCustomerAudioStreamManager.stopMicrophone();
    }
  });

  CCP_V2V.UI.agentStreamMicVolume.addEventListener("input", (event) => {
    const micVolume = parseFloat(event.target.value);
    if (ToCustomerAudioStreamManager != null) ToCustomerAudioStreamManager.setMicrophoneVolume(micVolume);
  });

  //Translate Agent UI buttons
  CCP_V2V.UI.agentTranslateFromLanguageSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("agentTranslateFromLanguage", CCP_V2V.UI.agentTranslateFromLanguageSelect.value);
  });
  CCP_V2V.UI.agentTranslateToLanguageSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("agentTranslateToLanguage", CCP_V2V.UI.agentTranslateToLanguageSelect.value);
  });
  CCP_V2V.UI.agentFormalitySelect.addEventListener("change", async () => {
    addUpdateLocalStorageKey("agentFormality", CCP_V2V.UI.agentFormalitySelect.value)
    await reloadConfigs();
  })
  CCP_V2V.UI.agentVoiceIdSelect.addEventListener("change", async (e) => {
    addUpdateLocalStorageKey("agentVoiceId", CCP_V2V.UI.agentVoiceIdSelect.value);
    if (e.target.value !== "disabled") await reloadConfigs();
  })
  CCP_V2V.UI.agentVoiceIdSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("agentVoiceId", CCP_V2V.UI.agentVoiceIdSelect.value);
  });
};

const initCCP = async (onConnectInitialized) => {
  const { connectCCPURL } = getConnectURLS();
  if (!window.connect.core.initialized) {
    console.info(`${LOGGER_PREFIX} -  Amazon Connect CCP initialization started`);
    window.connect.core.initCCP(CCP_V2V.UI.ccpContainer, {
      ccpUrl: connectCCPURL,
      loginPopup: true,
      loginPopupAutoClose: true,
      loginOptions: {
        // optional, if provided opens login in new window
        autoClose: true, // optional, defaults to `false`
        height: 600, // optional, defaults to 578
        width: 400, // optional, defaults to 433
        top: 0, // optional, defaults to 0
        left: 0, // optional, defaults to 0
      },
      region: CONNECT_CONFIG.connectInstanceRegion,
      softphone: {
        allowFramedSoftphone: false, //we don't want the default softphone
        allowFramedVideoCall: true, //allow the agent to add video to the call
        disableRingtone: false,
      },
      pageOptions: {
        enableAudioDeviceSettings: true,
        enableVideoDeviceSettings: true,
        enablePhoneTypeSettings: true,
      },
      shouldAddNamespaceToLogs: true,
    });

    window.connect.agent((agent) => {
      console.info(`${LOGGER_PREFIX} -  Amazon Connect CCP initialization completed`);
      if (onConnectInitialized) onConnectInitialized(agent);
    });
  } else {
    console.info(`${LOGGER_PREFIX} - Amazon Connect CCP Already Initialized`);
  }
};

const setLatencyTrackingUIVisibility = () => {
  console.log(`${LOGGER_PREFIX} - Latency tracking enabled: ${LATENCY_TRACKING_ENABLED}`);
  if (!LATENCY_TRACKING_ENABLED) {
    console.log(`${LOGGER_PREFIX} - Latency tracking is disabled, hiding latency tracking UI panels`);
    CCP_V2V.UI.latencyTrackingPanels.forEach((panel) => {
      panel.style.display = "none";
    });
  }
};

const onConnectInitialized = (connectAgent) => {
  connect = window.connect;
  connect.core.initSoftphoneManager({ allowFramedSoftphone: true });

  const connectAgentConfiguration = connectAgent.getConfiguration();
  CurrentUser["currentUser_ConnectUsername"] = connectAgentConfiguration.username;

  subscribeToAgentEvents();
  subscribeToContactEvents();

  connect.core.onSoftphoneSessionInit(function ({ connectionId }) {
    ConnectSoftPhoneManager = connect.core.getSoftphoneManager();
    //console.info(`${LOGGER_PREFIX} - softphoneManager`, softphoneManager);
  });
};

function subscribeToAgentEvents() {
  // Subscribe to Agent Events from Streams API, and handle Agent events with functions defined above
  console.info(`${LOGGER_PREFIX} - subscribing to events for agent`);

  connect.agent((agent) => {
    agent.onLocalMediaStreamCreated(onAgentLocalMediaStreamCreated);
    // agent.onStateChange(agentStateChange);
    // agent.onRefresh(agentRefresh);
    // agent.onOffline(agentOffline);
  });
}

function subscribeToContactEvents() {
  // Subscribe to Contact Events from Streams API, and handle Contact events
  console.info(`${LOGGER_PREFIX} - subscribing to events for contact`);
  connect.contact((contact) => {
    console.info(`${LOGGER_PREFIX} - new contact`, contact);
    if (contact.getActiveInitialConnection() && contact.getActiveInitialConnection().getEndpoint()) {
      console.info(`${LOGGER_PREFIX} - new contact is from ${contact.getActiveInitialConnection().getEndpoint().phoneNumber}`);
    } else {
      console.info(`${LOGGER_PREFIX} - this is an existing contact for this agent`);
    }

    contact.onConnecting(onContactConnecting);
    contact.onConnected(onContactConnected);
    contact.onEnded(onContactEnded);
    contact.onDestroy(onContactDestroyed);
    // contact.onRefresh(contactRefreshed);
  });
}

async function onContactConnecting(contact) {
  console.info(`${LOGGER_PREFIX} - contact is connecting`, contact);

  if (customerLanguageSearchable) customerLanguageSearchable.disable();
  if (agentLanguageSearchable) agentLanguageSearchable.disable();
  CCP_V2V.UI.customerFormalitySelect.disabled = true;
  CCP_V2V.UI.agentFormalitySelect.disabled = true;
  CCP_V2V.UI.agentVoiceIdSelect.disabled = true;
  CCP_V2V.UI.customerVoiceIdSelect.disabled = true;

  audioLatencyTrackManager = new AudioLatencyTrackManager();
  await agentStartSession(audioLatencyTrackManager);
  await customerStartSession(audioLatencyTrackManager);
}

async function onContactConnected(contact) {
  console.info(`${LOGGER_PREFIX} - contact connected`, contact);

  await agentStartStreaming();
  await customerStartStreaming();

  if (customerLanguageSearchable) customerLanguageSearchable.enable();
  if (agentLanguageSearchable) agentLanguageSearchable.enable();
  CCP_V2V.UI.customerFormalitySelect.disabled = false;
  CCP_V2V.UI.agentFormalitySelect.disabled = false;
  CCP_V2V.UI.agentVoiceIdSelect.disabled = false;
  CCP_V2V.UI.customerVoiceIdSelect.disabled = false;
}

function onContactEnded(contact) {
  console.info(`${LOGGER_PREFIX} - contact has ended`, contact);
  CurrentAgentConnectionId = null;
  if (ToCustomerAudioStreamManager != null) {
    ToCustomerAudioStreamManager.dispose();
    ToCustomerAudioStreamManager = null;
  }
  if (ToAgentAudioStreamManager != null) {
    ToAgentAudioStreamManager.dispose();
    ToAgentAudioStreamManager = null;
  }
  if (RTCSessionTrackManager != null) {
    RTCSessionTrackManager.dispose();
    RTCSessionTrackManager = null;
  }
  customerStopStreaming();
  agentStopStreaming();
  cleanUpUI();
}

async function onContactDestroyed(contact) {
  console.info(`${LOGGER_PREFIX} - contact has been destroyed`, contact);
  clearTranscriptCards();
}

async function onAgentLocalMediaStreamCreated(data) {
  //console.info(`${LOGGER_PREFIX} - onAgentLocalMediaStreamCreated`, data);
  CurrentAgentConnectionId = data.connectionId;
  const session = ConnectSoftPhoneManager?.getSession(CurrentAgentConnectionId);
  const peerConnection = session?._pc;
  await replaceToCustomerAudioStreamManager();
  await replaceToAgentAudioStreamManager();
  await replaceRTCSessionTrackManager(peerConnection);
}

function setAudioElementsSinkIds() {
  CCP_V2V.UI.fromCustomerAudioElement.setSinkId(CCP_V2V.UI.speakerSelect.value);
  CCP_V2V.UI.toCustomerAudioElement.setSinkId(CCP_V2V.UI.speakerSelect.value);
  CCP_V2V.UI.toAgentAudioElement.setSinkId(CCP_V2V.UI.speakerSelect.value);
}

//Instead of streaming Microphone, stream an Audio File
function streamFile() {
  try {
    const fileStreamAudioTrack = RTCSessionTrackManager.createFileTrack("./assets/speech_20241113001759828.mp3");
    //console.info(`${LOGGER_PREFIX} - streamFile`, fileStreamAudioTrack);
    RTCSessionTrackManager.replaceTrack(fileStreamAudioTrack, TrackType.FILE);
  } catch (error) {
    console.error(`${LOGGER_PREFIX} - streamFile`, error);
    raiseError(`Error steaming file: ${error}`);
  }
}

//Instead of streaming File, stream Mic
async function streamMic() {
  const selectedMic = CCP_V2V.UI.micSelect.value;
  if (!selectedMic) {
    raiseError("Please select a microphone!");
    return;
  }

  const micConstraints = getMicrophoneConstraints(selectedMic);
  const micStreamAudioTrack = await RTCSessionTrackManager.createMicTrack(micConstraints);
  //console.info(`${LOGGER_PREFIX} - streamMic`, micStreamAudioTrack);
  RTCSessionTrackManager.replaceTrack(micStreamAudioTrack, TrackType.MIC);
}

//Instead of removing AudioTrack, stream a silent AudioTrack
async function removeAudioTrack() {
  const silentTrack = RTCSessionTrackManager.createSilentTrack();
  // console.info(
  //   `${LOGGER_PREFIX} - removeAudioTrack - replacing with a silent track`
  // );
  RTCSessionTrackManager.replaceTrack(silentTrack, TrackType.SILENT);
}

async function testMicrophone() {
  const selectedMic = CCP_V2V.UI.micSelect.value;

  if (!selectedMic) {
    raiseError("Please select a microphone!");
    return;
  }

  try {
    // Request access to the selected microphone
    const micConstraints = getMicrophoneConstraints(selectedMic);
    const micStream = await navigator.mediaDevices.getUserMedia(micConstraints);

    const volumeBar = document.getElementById("volumeBar");
    const agentMicTestManager = await getAgentMicTestManager();
    agentMicTestManager.startAudioTest(micStream, volumeBar);
  } catch (err) {
    console.error(`${LOGGER_PREFIX} - testMicrophone - Error accessing microphone`, err);
    raiseError("Failed to access microphone.");
  }
}

async function stopTestMicrophone() {
  const agentMicTestManager = await getAgentMicTestManager();
  agentMicTestManager.stopAudioTest();
}

// Function to test the selected audio output device
function testAudioOutput() {
  const selectedSpeaker = CCP_V2V.UI.speakerSelect.value;
  if (!selectedSpeaker) {
    raiseError("Please select a speaker!");
    return;
  }

  // Create an audio context and set the output device using setSinkId()
  const audio = new Audio("/assets/chime-sound-7143.mp3");
  audio
    .setSinkId(selectedSpeaker)
    .then(() => {
      console.info(`${LOGGER_PREFIX} - testAudioOutput - Audio output device set successfully`);
      audio
        .play()
        .then(() => {
          console.info(`${LOGGER_PREFIX} - testAudioOutput - Audio played successfully`);
        })
        .catch((err) => {
          console.error(`${LOGGER_PREFIX} - testAudioOutput - Error playing audio:`, err);
          raiseError("Failed to play audio.");
        });
    })
    .catch((err) => {
      console.error(`${LOGGER_PREFIX} - testAudioOutput - Error setting output device:`, err);
      raiseError("Failed to set audio output device.");
    });
}

async function getDevices() {
  try {
    //check Microphone permission
    const micPermission = await navigator.permissions.query({ name: "microphone" });
    if (micPermission.state === "prompt") {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (micPermission.state === "denied") {
      raiseError("Microphone permission is denied. Please allow microphone access in your browser settings.");
      return;
    }

    // Get all media devices (input and output)
    const devices = await navigator.mediaDevices.enumerateDevices();

    // Arrays to store cam, mic and speaker devices
    const micDevices = [];
    const speakerDevices = [];

    // Loop through devices and filter by kind
    devices.forEach((device) => {
      if (device.kind === "audioinput") {
        micDevices.push(device);
      } else if (device.kind === "audiooutput") {
        speakerDevices.push(device);
      }
    });

    //raise an error if we only found devices without deviceId
    if (micDevices.every((device) => !device.deviceId)) {
      raiseError("No Microphone found. Please check your microphone and reload the page.");
      return;
    }

    if (speakerDevices.every((device) => !device.deviceId)) {
      raiseError("No Speaker found. Please check your speaker and reload the page.");
      return;
    }

    // Populate the microphone dropdown
    CCP_V2V.UI.micSelect.innerHTML = "";
    micDevices.forEach((mic) => {
      const option = document.createElement("option");
      option.value = mic.deviceId;
      option.textContent = mic.label || `Microphone ${mic.deviceId}`;
      CCP_V2V.UI.micSelect.appendChild(option);
    });

    //pre-select the Default mic
    const defaultMic = micDevices.find((mic) => mic.deviceId.startsWith("default"));
    if (defaultMic) {
      CCP_V2V.UI.micSelect.value = defaultMic.deviceId;
    }
    //pre-select the saved mic
    const savedMicId = getLocalStorageValueByKey("selectedMicId");
    if (savedMicId) {
      CCP_V2V.UI.micSelect.value = savedMicId;
    }

    // Populate the speaker dropdown
    CCP_V2V.UI.speakerSelect.innerHTML = "";
    speakerDevices.forEach((speaker) => {
      const option = document.createElement("option");
      option.value = speaker.deviceId;
      option.textContent = speaker.label || `Speaker ${speaker.deviceId}`;
      CCP_V2V.UI.speakerSelect.appendChild(option);
    });

    //pre-select the Default speaker
    const defaultSpeaker = speakerDevices.find((speaker) => speaker.deviceId.startsWith("default"));
    if (defaultSpeaker) {
      CCP_V2V.UI.speakerSelect.value = defaultSpeaker.deviceId;
    }
    //pre-select the saved speaker
    const savedSpeakerId = getLocalStorageValueByKey("selectedSpeakerId");
    if (savedSpeakerId) {
      CCP_V2V.UI.speakerSelect.value = savedSpeakerId;
    }
  } catch (err) {
    console.error(`${LOGGER_PREFIX} - getDevices - Error accessing devices:`, err);
  }
}

//Creates Customer Speaker Stream used as input for Amazon Transcribe when transcribing customer's voice
async function captureFromCustomerAudioStream() {
  const session = ConnectSoftPhoneManager?.getSession(CurrentAgentConnectionId);
  const audioStream = session?._remoteAudioStream;
  if (audioStream == null) {
    console.error(`${LOGGER_PREFIX} - captureFromCustomerAudioStream - No audio stream found from customer`);
    throw new Error("No audio stream found from customer, please check you browser sound settings");
  }
  const tracks = audioStream.getAudioTracks();

  if (tracks.length === 0 || tracks[0].readyState !== 'live') {
    throw new Error("Audio track is not live! ReadyState: " + tracks[0]?.readyState);
  }
  console.log('✅ Audio track is LIVE');

  const amazonTranscribeFromCustomerAudioStream = new MicrophoneStream();
  amazonTranscribeFromCustomerAudioStream.setStream(audioStream);
  return amazonTranscribeFromCustomerAudioStream;
}

async function customerStartSession(audioLatencyTrackManager) {
  DeepLVoiceClientCustomer = new DeepLVoiceClient({
    type: "customer",
    audioLatencyTrackManager: audioLatencyTrackManager,
    onTranscription: handleCustomerTranscript,
    onTranslation: handleCustomerTranslateText,
    onAudio: handleCustomerSynthesis,
  });
  // Expose to window for debugging (can call window.DeepLVoiceClientCustomer.getConnectionHealth() in console)
  window.DeepLVoiceClientCustomer = DeepLVoiceClientCustomer;
  try {
    await DeepLVoiceClientCustomer.startSession({
      sourceLanguage: CCP_V2V.UI.customerTranslateFromLanguageSelect.value,
      targetLanguages: [CCP_V2V.UI.customerTranslateToLanguageSelect.value],
      targetMediaLanguages: [CCP_V2V.UI.customerTranslateToLanguageSelect.value],
      formality: CCP_V2V.UI.customerFormalitySelect.value,
      targetMediaVoice: CCP_V2V.UI.customerVoiceIdSelect.value !== "disabled" ? CCP_V2V.UI.customerVoiceIdSelect.value : "female",
      sourceMediaContentType: "audio/pcm;encoding=s16le;rate=48000",
      targetMediaContentType: "audio/pcm;encoding=s16le;rate=16000",
    });
  } catch (error) {
    console.error(`${LOGGER_PREFIX} - customerStartSession - Error starting customer session:`, error);
    raiseError(`Error starting customer session: ${error}`);
  }
}

async function agentStartSession(audioLatencyTrackManager) {
  DeepLVoiceClientAgent = new DeepLVoiceClient({
    type: "agent",
    audioLatencyTrackManager: audioLatencyTrackManager,
    onTranscription: handleAgentTranscript,
    onTranslation: handleAgentTranslateText,
    onAudio: handleAgentSynthesis,
  });
  // Expose to window for debugging (can call window.DeepLVoiceClientAgent.getConnectionHealth() in console)
  window.DeepLVoiceClientAgent = DeepLVoiceClientAgent;
  try {
    await DeepLVoiceClientAgent.startSession({
      sourceLanguage: CCP_V2V.UI.agentTranslateFromLanguageSelect.value,
      targetLanguages: [CCP_V2V.UI.agentTranslateToLanguageSelect.value],
      targetMediaLanguages: [CCP_V2V.UI.agentTranslateToLanguageSelect.value],
      targetMediaVoice: CCP_V2V.UI.agentVoiceIdSelect.value !== "disabled" ? CCP_V2V.UI.agentVoiceIdSelect.value : "female",
      formality: CCP_V2V.UI.agentFormalitySelect.value,
      sourceMediaContentType: "audio/pcm;encoding=s16le;rate=48000",
      targetMediaContentType: "audio/pcm;encoding=s16le;rate=16000",
    });
  } catch (error) {
    console.error(`${LOGGER_PREFIX} - agentStartSession - Error starting agent session:`, error);
    raiseError(`Error starting agent session: ${error}`);
  }
}

async function customerStartStreaming() {
  try {
    // Ensure audio stream managers are initialized
    if (!ToCustomerAudioStreamManager) {
      throw new Error('ToCustomerAudioStreamManager is not initialized');
    }
    if (!RTCSessionTrackManager) {
      throw new Error('RTCSessionTrackManager is not initialized');
    }

    if (CCP_V2V.UI.customerStreamMicCheckbox.checked === true) {
      //we want agent to hear the customer's original voice, so we reduce the fromCustomerAudioElement volume
      CCP_V2V.UI.fromCustomerAudioElement.volume = parseFloat(CCP_V2V.UI.customerStreamMicVolume.value);
    } else {
      //we don't want agent to hear the customer's original voice, so we mute the fromCustomerAudioElement
      CCP_V2V.UI.fromCustomerAudioElement.muted = true;
    }

    //Play the audio feedback to customer
    if (CCP_V2V.UI.customerAudioFeedbackEnabledCheckbox.checked === true) {
      ToCustomerAudioStreamManager.enableAudioFeedback(AUDIO_FEEDBACK_FILE_PATH);
    }

    //Get ready to stream To Customer
    const toCustomerAudioTrack = ToCustomerAudioStreamManager.getAudioTrack();
    RTCSessionTrackManager.replaceTrack(toCustomerAudioTrack, TrackType.POLLY);

    const AmazonTranscribeFromCustomerAudioStream = await captureFromCustomerAudioStream();
    const sampleRate = AudioContextMgr.getActualSampleRate();
    console.info(`${LOGGER_PREFIX} - customerStartStreaming - AmazonTranscribeFromCustomerAudioStream Sample Rate: ${sampleRate}`);
  
    DeepLVoiceClientCustomer.streamAudio(AmazonTranscribeFromCustomerAudioStream, sampleRate);

  } catch (error) {
    console.error(`${LOGGER_PREFIX} - customerStartStreaming - Error starting customer streaming:`, error);
    raiseError(`Error starting customer streaming: ${error}`);
  }
}

async function customerStopStreaming() {
  if (AmazonTranscribeFromCustomerAudioStream) {
    //replace the stream with a silent stream
    const audioContext = await getAudioContext();
    const silentStream = audioContext.createMediaStreamDestination().stream;
    AmazonTranscribeFromCustomerAudioStream.setStream(silentStream);
    AmazonTranscribeFromCustomerAudioStream.stop();
    AmazonTranscribeFromCustomerAudioStream.destroy();
    AmazonTranscribeFromCustomerAudioStream = undefined;
  }

  if (DeepLVoiceClientCustomer) {
    DeepLVoiceClientCustomer.endAudio();
    DeepLVoiceClientCustomer.disconnect();
    DeepLVoiceClientCustomer = null;
  }
}

async function agentStartStreaming() {
  try {
    const selectedMic = CCP_V2V.UI.micSelect.value;
    const micConstraints = getMicrophoneConstraints(selectedMic);

    // Ensure audio stream managers are initialized
    if (!ToCustomerAudioStreamManager) {
      throw new Error('ToCustomerAudioStreamManager is not initialized');
    }
    if (!ToAgentAudioStreamManager) {
      throw new Error('ToAgentAudioStreamManager is not initialized');
    }

    if (CCP_V2V.UI.agentAudioFeedbackEnabledCheckbox.checked === true) {
      ToAgentAudioStreamManager.enableAudioFeedback(AUDIO_FEEDBACK_FILE_PATH);
    }

    //Get ready to stream To Customer
    const toCustomerAudioTrack = ToCustomerAudioStreamManager.getAudioTrack();
    RTCSessionTrackManager.replaceTrack(toCustomerAudioTrack, TrackType.POLLY);

    if (CCP_V2V.UI.agentStreamMicCheckbox.checked === true) {
      await ToCustomerAudioStreamManager.startMicrophone(micConstraints);
      const micVolume = parseFloat(CCP_V2V.UI.agentStreamMicVolume.value);
      ToCustomerAudioStreamManager.setMicrophoneVolume(micVolume);
    }

    AmazonTranscribeToCustomerAudioStream = await createMicrophoneStream(micConstraints);
    const agentStreamSampleRate = AudioContextMgr.getActualSampleRate();
    console.info(`${LOGGER_PREFIX} - agentStartStreaming - AmazonTranscribeToCustomerAudioStream Sample Rate: ${agentStreamSampleRate}`);

    DeepLVoiceClientAgent.streamAudio(AmazonTranscribeToCustomerAudioStream, agentStreamSampleRate);

    disableMicrophoneAndSpeakerSelection();
  } catch (error) {
    console.error(`${LOGGER_PREFIX} - agentStartStreaming - Error starting agent streaming:`, error);
    raiseError(`Error starting agent streaming: ${error}`);
  }
}

async function agentStopStreaming() {
  if (AmazonTranscribeToCustomerAudioStream) {
    //replace the stream with a silent stream
    const audioContext = await getAudioContext();
    const silentStream = audioContext.createMediaStreamDestination().stream;
    AmazonTranscribeToCustomerAudioStream.setStream(silentStream);
    AmazonTranscribeToCustomerAudioStream.stop();
    AmazonTranscribeToCustomerAudioStream.destroy();
    AmazonTranscribeToCustomerAudioStream = undefined;
  }
  if (ToCustomerAudioStreamManager != null) {
    await ToCustomerAudioStreamManager.stopMicrophone();
  }

  if (DeepLVoiceClientAgent) {
    DeepLVoiceClientAgent.endAudio();
    DeepLVoiceClientAgent.disconnect();
    DeepLVoiceClientAgent = null;
  }

  enableMicrophoneAndSpeakerSelection();
}

async function toggleAgentTranscriptionMute() {
  if (AmazonTranscribeToCustomerAudioStream) {
    const audioTrack = AmazonTranscribeToCustomerAudioStream.stream.getAudioTracks()[0];
    if (audioTrack) {
      //Disable the track in AmazonTranscribeToCustomerAudioStream
      audioTrack.enabled = !audioTrack.enabled;
      IsAgentTranscriptionMuted = !audioTrack.enabled;
      //Mute the Mic so it is not streamed to Customer
      const selectedMic = CCP_V2V.UI.micSelect.value;
      const micConstraints = getMicrophoneConstraints(selectedMic);
      if (IsAgentTranscriptionMuted || !CCP_V2V.UI.agentStreamMicCheckbox.checked) {
        ToCustomerAudioStreamManager.stopMicrophone();
      } else {
        await ToCustomerAudioStreamManager.startMicrophone(micConstraints, parseFloat(CCP_V2V.UI.agentStreamMicVolume.value));
        ToCustomerAudioStreamManager.setMicrophoneVolume(parseFloat(CCP_V2V.UI.agentStreamMicVolume.value));
      }
      CCP_V2V.UI.agentMuteTranscriptionButton.textContent = IsAgentTranscriptionMuted ? "Unmute" : "Mute";
    }
  }
}

async function loadTranslateLanguageCodes() {
  const deepLVoiceClient = new DeepLVoiceClient();
  const deepLTranslateFromLanguages = await deepLVoiceClient.getLanguages("source").catch((error) => {
    console.error(`${LOGGER_PREFIX} - loadTranslateLanguageCodes - Error listing DeepL languages:`, error);
    raiseError(`Error listing DeepL languages: ${error}`);
    return [];
  });

  const deepLTranslateToLanguages = await deepLVoiceClient.getLanguages("target").catch((error) => {
    console.error(`${LOGGER_PREFIX} - loadTranslateLanguageCodes - Error listing DeepL languages:`, error);
    raiseError(`Error listing DeepL languages: ${error}`);
    return [];
  });
  console.log(`${LOGGER_PREFIX} - loadTranslateLanguageCodes - DeepL Translate From Languages:`, deepLTranslateFromLanguages);

  // Populate new simplified language selects
  deepLTranslateFromLanguages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language.language;
    option.textContent = language.name;
    CCP_V2V.UI.customerLanguageSelect.appendChild(option.cloneNode(true));
    CCP_V2V.UI.agentLanguageSelect.appendChild(option.cloneNode(true));
  });

  // Populate hidden legacy selects (for backward compatibility)
  deepLTranslateFromLanguages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language.language;
    option.textContent = language.name;
    CCP_V2V.UI.customerTranslateFromLanguageSelect.appendChild(option);
    CCP_V2V.UI.agentTranslateFromLanguageSelect.appendChild(option.cloneNode(true));
  });

  deepLTranslateToLanguages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language.language;
    option.textContent = language.name;
    CCP_V2V.UI.customerTranslateToLanguageSelect.appendChild(option.cloneNode(true));
    CCP_V2V.UI.agentTranslateToLanguageSelect.appendChild(option.cloneNode(true));
  });
  //set en as default for customer, es for agent
  const defaultCustomerLang = "en";
  const defaultAgentLang = "es";

  CCP_V2V.UI.customerLanguageSelect.value = defaultCustomerLang;
  CCP_V2V.UI.agentLanguageSelect.value = defaultAgentLang;

  //pre-select saved languages (for new simplified selects)
  const savedCustomerLanguage = getLocalStorageValueByKey("customerLanguage");
  const savedAgentLanguage = getLocalStorageValueByKey("agentLanguage");

  if (savedCustomerLanguage) {
    CCP_V2V.UI.customerLanguageSelect.value = savedCustomerLanguage;
  }
  if (savedAgentLanguage) {
    CCP_V2V.UI.agentLanguageSelect.value = savedAgentLanguage;
  }

  // Sync simplified selects to hidden legacy selects
  const syncLanguages = () => {
    const customerLang = CCP_V2V.UI.customerLanguageSelect.value;
    const agentLang = CCP_V2V.UI.agentLanguageSelect.value;

    // Customer speaks customerLang, wants to hear agentLang
    CCP_V2V.UI.customerTranslateFromLanguageSelect.value = customerLang;
    CCP_V2V.UI.customerTranslateToLanguageSelect.value = agentLang;

    // Agent speaks agentLang, wants to hear customerLang
    CCP_V2V.UI.agentTranslateFromLanguageSelect.value = agentLang;
    CCP_V2V.UI.agentTranslateToLanguageSelect.value = customerLang;
  };

  // Initial sync
  syncLanguages();

  // Initialize SearchableSelect for new simplified language dropdowns
  customerLanguageSearchable = new SearchableSelect(CCP_V2V.UI.customerLanguageSelect);
  agentLanguageSearchable = new SearchableSelect(CCP_V2V.UI.agentLanguageSelect);

  // Initialize SearchableSelect for hidden legacy dropdowns (still needed for the backend)
  customerTranslateFromLanguageSearchable = new SearchableSelect(CCP_V2V.UI.customerTranslateFromLanguageSelect);
  customerTranslateToLanguageSearchable = new SearchableSelect(CCP_V2V.UI.customerTranslateToLanguageSelect);
  agentTranslateFromLanguageSearchable = new SearchableSelect(CCP_V2V.UI.agentTranslateFromLanguageSelect);
  agentTranslateToLanguageSearchable = new SearchableSelect(CCP_V2V.UI.agentTranslateToLanguageSelect);

  // Explicitly set the saved values to ensure they display correctly
  if (savedCustomerLanguage) {
    customerLanguageSearchable.setValue(savedCustomerLanguage);
  }
  if (savedAgentLanguage) {
    agentLanguageSearchable.setValue(savedAgentLanguage);
  }

  // Add change listeners to sync languages when user changes selection
  CCP_V2V.UI.customerLanguageSelect.addEventListener('change', async () => {
    syncLanguages();
    window.localStorage.setItem('customerLanguage', CCP_V2V.UI.customerLanguageSelect.value);
    await reloadConfigs();
  });

  CCP_V2V.UI.agentLanguageSelect.addEventListener('change', async () => {
    syncLanguages();
    window.localStorage.setItem('agentLanguage', CCP_V2V.UI.agentLanguageSelect.value);
    await reloadConfigs();
  });
}

async function reloadConfigs() {
  if (!RTCSessionTrackManager) return;

  if (agentLanguageSearchable) agentLanguageSearchable.disable();
  if (customerLanguageSearchable) customerLanguageSearchable.disable();
  CCP_V2V.UI.agentFormalitySelect.disabled = true;
  CCP_V2V.UI.customerFormalitySelect.disabled = true;
  CCP_V2V.UI.agentVoiceIdSelect.disabled = true;
  CCP_V2V.UI.customerVoiceIdSelect.disabled = true;

  await agentStopStreaming();
  await customerStopStreaming();

  audioLatencyTrackManager = new AudioLatencyTrackManager();
  await agentStartSession(audioLatencyTrackManager);
  await agentStartStreaming();
  await customerStartSession(audioLatencyTrackManager);
  await customerStartStreaming();

  if (agentLanguageSearchable) agentLanguageSearchable.enable();
  if (customerLanguageSearchable) customerLanguageSearchable.enable();
  CCP_V2V.UI.agentFormalitySelect.disabled = false;
  CCP_V2V.UI.customerFormalitySelect.disabled = false;
  CCP_V2V.UI.agentVoiceIdSelect.disabled = false;
  CCP_V2V.UI.customerVoiceIdSelect.disabled = false;
}

async function handleCustomerTranscript(text) {
  if (isStringUndefinedNullEmpty(text)) return;

  setTimeout(() => {
    setBackgroundColour(CCP_V2V.UI.customerTranscriptionTextOutputDiv, "bg-pale-green");
    // If the text content ends in end of sentence punctuation, replace it
    const lastText = CCP_V2V.UI.customerTranscriptionTextOutputDiv.textContent
    addTranscriptCard(text, null, "toAgent");
    if (/[.!?]$/.test(lastText)) {
      CCP_V2V.UI.customerTranscriptionTextOutputDiv.textContent = text;
    } else {
      CCP_V2V.UI.customerTranscriptionTextOutputDiv.textContent += text;
    }
  }, 100);
}

async function handleCustomerTranslateText(text) {
  if (isStringUndefinedNullEmpty(text)) return;

  setTimeout(() => {
    if (/[.!?]$/.test(CCP_V2V.UI.customerTranslatedTextOutputDiv.textContent)) {
      CCP_V2V.UI.customerTranslatedTextOutputDiv.textContent = text;
    } else {
      CCP_V2V.UI.customerTranslatedTextOutputDiv.textContent += text;
    }
    addTranscriptCard(null, text, "toAgent");
  }, 100);
}

async function handleAgentTranslateText(text) {
  if (isStringUndefinedNullEmpty(text)) return;
  setTimeout(() => {
    const lastText = CCP_V2V.UI.agentTranslatedTextOutputDiv.textContent
    if (/[.!?]$/.test(lastText)) {
      CCP_V2V.UI.agentTranslatedTextOutputDiv.textContent = text;
    } else {
      CCP_V2V.UI.agentTranslatedTextOutputDiv.textContent += text;
    }
    addTranscriptCard(null, text, "fromAgent");
  }, 100);
}

async function handleAgentTranscript(text) {
  if (isStringUndefinedNullEmpty(text)) return;

  setTimeout(() => {
    setBackgroundColour(CCP_V2V.UI.agentTranscriptionTextOutputDiv, "bg-pale-green");
    const lastText = CCP_V2V.UI.agentTranscriptionTextOutputDiv.textContent
    if (/[.!?]$/.test(lastText)) {
      CCP_V2V.UI.agentTranscriptionTextOutputDiv.textContent = text;
    } else {
      CCP_V2V.UI.agentTranscriptionTextOutputDiv.textContent += text;
    }
    addTranscriptCard(text, null, "fromAgent");
  }, 100);
}

async function handleCustomerSynthesis(data) {
  if (!data || !CCP_V2V.UI.customerVoiceIdSelect.value) return;
  for (let i = 0; i < data.length; i++) {
    //Play Customer Speech to Agent
    let audioContentArrayBufferPrimary = base64ToArrayBuffer(data[i]);
    if (ToAgentAudioStreamManager != null) {
      ToAgentAudioStreamManager.playAudioBuffer(audioContentArrayBufferPrimary);
    }

    //Play Customer Speech to Customer
    if (CCP_V2V.UI.customerStreamTranslationCheckbox.checked === true) {
      const audioContentArrayBufferSecondary = base64ToArrayBuffer(data[i]);
      if (ToCustomerAudioStreamManager != null) {
        ToCustomerAudioStreamManager.playAudioBuffer(audioContentArrayBufferSecondary, CUSTOMER_TRANSLATION_TO_CUSTOMER_VOLUME);
      }
    }
  }
}

function handleAgentSynthesis(data) {
  if (!data || !CCP_V2V.UI.agentVoiceIdSelect.value) return;
  for (let i = 0; i < data.length; i++) {
    //Play Agent Speech to Customer
    const audioContentArrayBufferPrimary = base64ToArrayBuffer(data[i]);
    if (ToCustomerAudioStreamManager != null) {
      ToCustomerAudioStreamManager.playAudioBuffer(audioContentArrayBufferPrimary);
    }

    //Play Agent Speech to Agent
    if (CCP_V2V.UI.agentStreamTranslationCheckbox.checked === true) {
      const audioContentArrayBufferSecondary = base64ToArrayBuffer(data[i]);
      if (ToAgentAudioStreamManager != null) {
        ToAgentAudioStreamManager.playAudioBuffer(audioContentArrayBufferSecondary, AGENT_TRANSLATION_TO_AGENT_VOLUME);
      }
    }
  }
}

function loadTranslationFormalities() {
  CCP_V2V.UI.customerFormalitySelect.innerHTML = "";
  CCP_V2V.UI.agentFormalitySelect.innerHTML = "";

  let option = document.createElement("option");
  option.value = "default";
  option.textContent = "Language Default";
  CCP_V2V.UI.customerFormalitySelect.appendChild(option);
  CCP_V2V.UI.agentFormalitySelect.appendChild(option.cloneNode(true)); 

  option = document.createElement("option");
  option.value = "formal";
  option.textContent = "More Formal";
  CCP_V2V.UI.customerFormalitySelect.appendChild(option);
  CCP_V2V.UI.agentFormalitySelect.appendChild(option.cloneNode(true));

  option = document.createElement("option");
  option.value = "informal";
  option.textContent = "Less Formal";
  CCP_V2V.UI.customerFormalitySelect.appendChild(option);
  CCP_V2V.UI.agentFormalitySelect.appendChild(option.cloneNode(true));
 
  const savedCustomerFormality = getLocalStorageValueByKey("customerFormality");
  if (savedCustomerFormality) {
    CCP_V2V.UI.customerFormalitySelect.value = savedCustomerFormality;
  }

  const savedAgentFormality = getLocalStorageValueByKey("agentFormality");
  if (savedAgentFormality) {
    CCP_V2V.UI.agentFormalitySelect.value = savedAgentFormality;
  }
}

function loadVoiceIds() {
  CCP_V2V.UI.customerVoiceIdSelect.innerHTML = "";
  CCP_V2V.UI.agentVoiceIdSelect.innerHTML = "";

  let option = document.createElement("option");
  option.value = "female";
  option.textContent = "Female";
  CCP_V2V.UI.customerVoiceIdSelect.appendChild(option);
  CCP_V2V.UI.agentVoiceIdSelect.appendChild(option.cloneNode(true));

  option = document.createElement("option");
  option.value = "male";
  option.textContent = "Male";
  CCP_V2V.UI.customerVoiceIdSelect.appendChild(option);
  CCP_V2V.UI.agentVoiceIdSelect.appendChild(option.cloneNode(true));

  option = document.createElement("option");
  option.value = "disabled";
  option.textContent = "Speech Off";
  CCP_V2V.UI.customerVoiceIdSelect.appendChild(option);
  CCP_V2V.UI.agentVoiceIdSelect.appendChild(option.cloneNode(true));  

  const savedCustomerVoiceId = getLocalStorageValueByKey("customerVoiceId");
  if (savedCustomerVoiceId) {
    CCP_V2V.UI.customerVoiceIdSelect.value = savedCustomerVoiceId;
  }

  const savedAgentVoiceId = getLocalStorageValueByKey("agentVoiceId");
  if (savedAgentVoiceId) {
    CCP_V2V.UI.agentVoiceIdSelect.value = savedAgentVoiceId;
  }
}

function setBackgroundColour(element, cssClass) {
  // Remove all background classes first
  element.classList.remove("bg-pale-green", "bg-pale-yellow", "bg-none");

  // Add the requested background if specified
  if (cssClass) {
    element.classList.add(cssClass);
  }
}

function addTranscriptCard(sourceText, translatedText, type) {
  let text = "";
  if (type == "fromAgent") {
    if (isStringUndefinedNullEmpty(sourceText)) return;
    text = sourceText;
  }
  if (type == "toAgent") {
    if (isStringUndefinedNullEmpty(translatedText)) return;
    text = translatedText;
  }
  const existingCards = CCP_V2V.UI.divTranscriptContainer.querySelectorAll('.transcript-card');
  let lastCard = null;

  if (existingCards.length > 0) {
      lastCard = existingCards[existingCards.length - 1];
  }

  if (lastCard && lastCard.className.includes(type)) {
    // Get all text divs in this card
    const textDivs = type === "fromAgent" 
      ? lastCard.querySelectorAll(".transcript-original")
      : lastCard.querySelectorAll(".transcript-translated");
    
    const lastTextElement = textDivs[textDivs.length - 1];
    const lastText = lastTextElement.textContent;

    // If the last text does not end with end of sentence punctuation, append the new text to it
    if (lastText && !/[.!?]$/.test(lastText.trim())) {
      lastTextElement.textContent += text;
    } else {
      // Create original text element
      const textDiv = document.createElement("div");
      textDiv.className = type === "fromAgent" ? "transcript-original" : "transcript-translated";
      textDiv.textContent = text;
      lastCard.appendChild(textDiv);
    }
    CCP_V2V.UI.divTranscriptContainer.scrollTop = CCP_V2V.UI.divTranscriptContainer.scrollHeight;
    return;
  }

  const card = document.createElement("div");
  if (type === "toAgent") {
    setBackgroundColour(card, "bg-pale-green");
  }
  card.className = `transcript-card ${type}`; // type is either 'fromAgent' or 'toAgent'
  const textDiv = document.createElement("div");
  textDiv.className = type === "fromAgent" ? "transcript-original" : "transcript-translated";
  textDiv.textContent = text;
  card.appendChild(textDiv);

  CCP_V2V.UI.divTranscriptContainer.insertBefore(card, CCP_V2V.UI.divTranscriptContainer.lastChild);

  CCP_V2V.UI.divTranscriptContainer.scrollTop = CCP_V2V.UI.divTranscriptContainer.scrollHeight;
}

function clearTranscriptCards() {
  const container = CCP_V2V.UI.divTranscriptContainer;

  // Remove all children except the last one (spacer)
  document.querySelectorAll(".transcript-container .transcript-card").forEach((card) => card.remove());
}

function getMicrophoneConstraints(deviceId) {
  let microphoneConstraints = {
    audio: {
      deviceId: deviceId,
      echoCancellation: CCP_V2V.UI.echoCancellationCheckbox.checked === true,
      noiseSuppression: CCP_V2V.UI.noiseSuppressionCheckbox.checked === true,
      autoGainControl: CCP_V2V.UI.autoGainControlCheckbox.checked === true,
    },
  };

  console.info(`${LOGGER_PREFIX} - getMicrophoneConstraints: ${JSON.stringify(microphoneConstraints)}`);
  return microphoneConstraints;
}

function enableMicrophoneAndSpeakerSelection() {
  CCP_V2V.UI.micSelect.disabled = false;
  CCP_V2V.UI.speakerSelect.disabled = false;

  CCP_V2V.UI.testAudioButton.disabled = false;
  CCP_V2V.UI.speakerSaveButton.disabled = false;

  CCP_V2V.UI.testMicButton.disabled = false;
  CCP_V2V.UI.micSaveButton.disabled = false;

  CCP_V2V.UI.echoCancellationCheckbox.disabled = false;
  CCP_V2V.UI.noiseSuppressionCheckbox.disabled = false;
  CCP_V2V.UI.autoGainControlCheckbox.disabled = false;
}

function disableMicrophoneAndSpeakerSelection() {
  CCP_V2V.UI.micSelect.disabled = true;
  CCP_V2V.UI.speakerSelect.disabled = true;

  CCP_V2V.UI.testAudioButton.disabled = true;
  CCP_V2V.UI.speakerSaveButton.disabled = true;

  CCP_V2V.UI.testMicButton.disabled = true;
  CCP_V2V.UI.micSaveButton.disabled = true;

  CCP_V2V.UI.echoCancellationCheckbox.disabled = true;
  CCP_V2V.UI.noiseSuppressionCheckbox.disabled = true;
  CCP_V2V.UI.autoGainControlCheckbox.disabled = true;
}

// =============================================================================
// DEBUG DASHBOARD INITIALIZATION
// =============================================================================

/**
 * Initialize Debug Dashboard when ?debug=true URL parameter is present.
 * The dashboard dynamically loads only in debug mode to avoid production bundle impact.
 *
 * Features:
 * - Real-time WebSocket health monitoring for Agent and Customer connections
 * - Quality timeline visualization (60 seconds)
 * - VAD-aware indicators
 * - Force reconnect controls
 * - Configuration overrides
 * - Export health data
 * - Reconnection history
 *
 * Usage:
 * 1. Add ?debug=true to URL
 * 2. Dashboard appears at bottom of screen (collapsed by default)
 * 3. Access via console: window.debugDashboard
 */
if (isDebugMode()) {
  console.log('🔧 Debug mode enabled - loading health dashboard...');

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDebugDashboard);
  } else {
    initDebugDashboard();
  }
}

function initDebugDashboard() {
  // Dynamic import to avoid bundling in production
  import('./components/DebugDashboard.js').then(module => {
    const DebugDashboard = module.DebugDashboard;

    // Create dashboard instance with getter functions
    // This allows the dashboard to access clients dynamically as they're created/destroyed
    const dashboard = new DebugDashboard({
      get agentClient() { return window.DeepLVoiceClientAgent; },
      get customerClient() { return window.DeepLVoiceClientCustomer; },
      get audioLatencyTrackManager() { return audioLatencyTrackManager; },
    });

    // Mount to body
    dashboard.mount(document.body);

    // Expose to window for console debugging
    window.debugDashboard = dashboard;

    console.log('✅ Debug dashboard loaded successfully');
    console.log('💡 Access via: window.debugDashboard');
  }).catch(error => {
    console.error('❌ Failed to load debug dashboard:', error);
  });
}
