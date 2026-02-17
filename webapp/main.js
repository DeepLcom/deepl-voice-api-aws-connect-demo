// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "./style.css";
import "amazon-connect-streams";

import MicrophoneStream from "microphone-stream";

import { getConnectURLS, addUpdateLocalStorageKey, getLocalStorageValueByKey, base64ToArrayBuffer, isStringUndefinedNullEmpty } from "./utils/commonUtility";
import {
  AGENT_TRANSLATION_TO_AGENT_VOLUME,
  AUDIO_FEEDBACK_FILE_PATH,
  CUSTOMER_TRANSLATION_TO_CUSTOMER_VOLUME,
  LOGGER_PREFIX,
  TRANSCRIBE_PARTIAL_RESULTS_STABILITY,
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
  // loadTranscribeLanguageCodes();
  // loadTranscribePartialResultsStability();
  loadTranslateLanguageCodes();
  loadVoiceIds();
  // loadPollyEngines();
  // loadPollyLanguageCodes();
  // loadCustomerPollyVoiceIds().then(loadAgentPollyVoiceIds);
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
    customerStreamTranslationCheckbox: document.getElementById("customerStreamTranslationCheckbox"),
    customerAudioFeedbackEnabledCheckbox: document.getElementById("customerAudioFeedbackEnabledCheckbox"),
    //Translate Customer UI Elements
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
    //Translate Agent UI Elements
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
    } else {
      CCP_V2V.UI.fromCustomerAudioElement.muted = true;
    }
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
  //Synthesis Customer UI buttons
  CCP_V2V.UI.customerVoiceIdSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("customerVoiceIdSaveButton", CCP_V2V.UI.customerVoiceIdSelect.value);
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
    if (event.target.checked) {
      if (ToCustomerAudioStreamManager != null) ToCustomerAudioStreamManager.startMicrophone(micConstraints);
    } else {
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
  CCP_V2V.UI.agentTranslateToLanguageSaveButton.addEventListener("click", () => {
    addUpdateLocalStorageKey("agentTranslateToLanguage", CCP_V2V.UI.agentTranslateToLanguageSelect.value);
  });
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

function onContactConnecting(contact) {
  console.info(`${LOGGER_PREFIX} - contact is connecting`, contact);
}

async function onContactConnected(contact) {
  console.info(`${LOGGER_PREFIX} - contact connected`, contact);

  await agentStartStreaming();
  await customerStartStreaming();
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
  
  await agentStopStreaming();
  await customerStopStreaming();
  clearTranscriptCards();
}

function onAgentLocalMediaStreamCreated(data) {
  //console.info(`${LOGGER_PREFIX} - onAgentLocalMediaStreamCreated`, data);
  CurrentAgentConnectionId = data.connectionId;
  const session = ConnectSoftPhoneManager?.getSession(CurrentAgentConnectionId);
  const peerConnection = session?._pc;
  replaceToCustomerAudioStreamManager();
  replaceToAgentAudioStreamManager();
  replaceRTCSessionTrackManager(peerConnection);
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

async function loadTranscribeLanguageCodes() {
  const transcribeStreamingLanguages = listStreamingLanguages();
  transcribeStreamingLanguages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    CCP_V2V.UI.customerTranscribeLanguageSelect.appendChild(option);
    CCP_V2V.UI.agentTranscribeLanguageSelect.appendChild(option.cloneNode(true));
  });
  //set en-US as default
  CCP_V2V.UI.customerTranscribeLanguageSelect.value = "en-US";
  CCP_V2V.UI.agentTranscribeLanguageSelect.value = "en-US";

  //pre-select saved transcribeLanguage
  const savedCustomerTranscribeLanguage = getLocalStorageValueByKey("customerTranscribeLanguage");
  if (savedCustomerTranscribeLanguage) {
    CCP_V2V.UI.customerTranscribeLanguageSelect.value = savedCustomerTranscribeLanguage;
  }

  const savedAgentTranscribeLanguage = getLocalStorageValueByKey("agentTranscribeLanguage");
  if (savedAgentTranscribeLanguage) {
    CCP_V2V.UI.agentTranscribeLanguageSelect.value = savedAgentTranscribeLanguage;
  }
}

function loadTranscribePartialResultsStability() {
  TRANSCRIBE_PARTIAL_RESULTS_STABILITY.forEach((stability) => {
    const option = document.createElement("option");
    option.value = stability;
    option.textContent = stability;
    CCP_V2V.UI.customerTranscribePartialResultsStabilitySelect.appendChild(option);
    CCP_V2V.UI.agentTranscribePartialResultsStabilitySelect.appendChild(option.cloneNode(true));
  });
  //set none as default
  CCP_V2V.UI.customerTranscribePartialResultsStabilitySelect.value = "none";
  CCP_V2V.UI.agentTranscribePartialResultsStabilitySelect.value = "none";

  //pre-select saved transcribePartialResultStability
  const savedCustomerTranscribePartialResultsStability = getLocalStorageValueByKey("customerTranscribePartialResultsStability");
  if (savedCustomerTranscribePartialResultsStability) {
    CCP_V2V.UI.customerTranscribePartialResultsStabilitySelect.value = savedCustomerTranscribePartialResultsStability;
  }

  const savedAgentTranscribePartialResultsStability = getLocalStorageValueByKey("agentTranscribePartialResultsStability");
  if (savedAgentTranscribePartialResultsStability) {
    CCP_V2V.UI.agentTranscribePartialResultsStabilitySelect.value = savedAgentTranscribePartialResultsStability;
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

async function customerStartStreaming() {
  try {
    if (CCP_V2V.UI.customerStreamMicCheckbox.checked === true) {
      //we want agent to hear the customer's original voice, so we reduce the fromCustomerAudioElement volume
      CCP_V2V.UI.fromCustomerAudioElement.volume = 0.3;
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

    DeepLVoiceClientCustomer = new DeepLVoiceClient({
      onTranscription: handleCustomerTranscript,
      onTranslation: handleCustomerTranslateText,
      onAudio: handleCustomerSynthesis
    });

    await DeepLVoiceClientCustomer.startSession({
      sourceLanguage: CCP_V2V.UI.customerTranslateFromLanguageSelect.value,
      targetLanguages: [CCP_V2V.UI.customerTranslateToLanguageSelect.value],
      targetMediaLanguages: [CCP_V2V.UI.customerTranslateToLanguageSelect.value],
      sourceMediaContentType: "audio/pcm;encoding=s16le;rate=48000",
      targetMediaContentType: "audio/pcm;encoding=s16le;rate=16000",
      targetMediaVoice: CCP_V2V.UI.customerVoiceIdSelect.value,
    });

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
    DeepLVoiceClientCustomer.diconnect();
    DeepLVoiceClientCustomer = null;
  }

  //un-mute the audio element
  CCP_V2V.UI.fromCustomerAudioElement.muted = false;
}

async function agentStartStreaming() {
  try {
    const selectedMic = CCP_V2V.UI.micSelect.value;
    const micConstraints = getMicrophoneConstraints(selectedMic);

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

    DeepLVoiceClientAgent = new DeepLVoiceClient({
      onTranscription: handleAgentTranscript,
      onTranslation: handleAgentTranslateText,
      onAudio: handleAgentSynthesis
    });
  
    await DeepLVoiceClientAgent.startSession({
      sourceLanguage: CCP_V2V.UI.agentTranslateFromLanguageSelect.value,
      targetLanguages: [CCP_V2V.UI.agentTranslateToLanguageSelect.value],
      targetMediaLanguages: [CCP_V2V.UI.agentTranslateToLanguageSelect.value],
      sourceMediaContentType: "audio/pcm;encoding=s16le;rate=48000",
      targetMediaContentType: "audio/pcm;encoding=s16le;rate=16000",
    });

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
    DeepLVoiceClientAgent.diconnect();
    DeepLVoiceClientAgent = null;
  }

  enableMicrophoneAndSpeakerSelection();
}

function toggleAgentTranscriptionMute() {
  if (AmazonTranscribeToCustomerAudioStream) {
    const audioTrack = AmazonTranscribeToCustomerAudioStream.stream.getAudioTracks()[0];
    if (audioTrack) {
      //Disable the track in AmazonTranscribeToCustomerAudioStream
      audioTrack.enabled = !audioTrack.enabled;
      IsAgentTranscriptionMuted = !audioTrack.enabled;
      //Mute the Mic so it is not streamed to Customer
      const selectedMic = CCP_V2V.UI.micSelect.value;
      const micConstraints = getMicrophoneConstraints(selectedMic);
      IsAgentTranscriptionMuted ? ToCustomerAudioStreamManager.stopMicrophone() : ToCustomerAudioStreamManager.startMicrophone(micConstraints);
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
  //set en as default
  CCP_V2V.UI.customerTranslateFromLanguageSelect.value = "EN";
  CCP_V2V.UI.customerTranslateToLanguageSelect.value = "ES";

  CCP_V2V.UI.agentTranslateFromLanguageSelect.value = "EN";
  CCP_V2V.UI.agentTranslateToLanguageSelect.value = "ES";

  //pre-select saved translateFromLanguage
  const savedCustomerTranslateFromLanguage = getLocalStorageValueByKey("customerTranslateFromLanguage");
  if (savedCustomerTranslateFromLanguage) {
    CCP_V2V.UI.customerTranslateFromLanguageSelect.value = savedCustomerTranslateFromLanguage;
  }

  const savedAgentTranslateFromLanguage = getLocalStorageValueByKey("agentTranslateFromLanguage");
  if (savedAgentTranslateFromLanguage) {
    CCP_V2V.UI.agentTranslateFromLanguageSelect.value = savedAgentTranslateFromLanguage;
  }

  //pre-select saved translateToLanguage
  const savedCustomerTranslateToLanguage = getLocalStorageValueByKey("customerTranslateToLanguage");
  if (savedCustomerTranslateToLanguage) {
    CCP_V2V.UI.customerTranslateToLanguageSelect.value = savedCustomerTranslateToLanguage;
  }

  const savedAgentTranslateToLanguage = getLocalStorageValueByKey("agentTranslateToLanguage");
  if (savedAgentTranslateToLanguage) {
    CCP_V2V.UI.agentTranslateToLanguageSelect.value = savedAgentTranslateToLanguage;
  }
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
  if (!data) return;
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
  if (!data) return;
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
  let lastTextElement = null;

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
