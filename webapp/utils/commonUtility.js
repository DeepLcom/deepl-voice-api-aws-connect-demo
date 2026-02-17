// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { CONNECT_CONFIG } from "../config";
import { DEPRECATED_CONNECT_DOMAIN } from "../constants";

export const isValidURL = (url) => {
  const regexp =
    /^(?:(?:https?|ftp):\/\/)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/\S*)?$/;
  if (regexp.test(url)) return true;
  return false;
};

export const getConnectInstanceURL = () => {
  let connectInstanceURL = CONNECT_CONFIG.connectInstanceURL?.replace(/\/$/, "");
  if (!connectInstanceURL) {
    console.warn("connectInstanceURL not set!");
    return null;
  }

  if (connectInstanceURL.endsWith(DEPRECATED_CONNECT_DOMAIN)) connectInstanceURL = `${connectInstanceURL}/connect`;
  return connectInstanceURL;
};

const getConnectLoginURL = () => {
  const connectInstanceURL = getConnectInstanceURL();
  if (!connectInstanceURL) return null;
  return `${connectInstanceURL}/login`;
};

const getConnectLogoutURL = () => {
  const connectInstanceURL = getConnectInstanceURL();
  if (!connectInstanceURL) return null;
  return `${connectInstanceURL}/logout`;
};

const getConnectCCPURL = () => {
  const connectInstanceURL = getConnectInstanceURL();
  if (!connectInstanceURL) return null;
  return `${connectInstanceURL}/ccp-v2`;
};

export const getConnectURLS = () => {
  return {
    connectInstanceURL: getConnectInstanceURL(),
    connectLoginURL: getConnectLoginURL(),
    connectLogoutURL: getConnectLogoutURL(),
    connectCCPURL: getConnectCCPURL(),
  };
};

export const goToHome = () => {
  window.location.href = `${window.location.protocol}//${window.location.host}`;
};

export function addUpdateQueryStringKey(key, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.history.pushState({}, "", url.toString());
}

export function getQueryStringValueByKey(key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}

export function addUpdateLocalStorageKey(key, value) {
  window.localStorage.setItem(key, value);
}

export function getLocalStorageValueByKey(key) {
  return window.localStorage.getItem(key);
}

export function base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

/**
 * Check if object is empty.
 * @param {object} inputObject - inputObject.
 * @returns {boolean} - true if object is empty, false otherwise.
 */
export function isObjectEmpty(inputObject) {
  return inputObject != null && Object.keys(inputObject).length === 0 && Object.getPrototypeOf(inputObject) === Object.prototype;
}

/**
 * Check if object is undefined, null, empty.
 * @param {object} inputObject - inputObject.
 * @returns {boolean} - true if object is undefined, null, empty, false otherwise.
 */
export function isObjectUndefinedNullEmpty(inputObject) {
  if (inputObject == null) return true;
  if (typeof inputObject !== "object") return true;
  if (typeof inputObject === "object" && inputObject instanceof Array) return true;
  return isObjectEmpty(inputObject);
}

/**
 * Check if string is undefined, null, empty.
 * @param {string} inputString - inputString.
 * @returns {boolean} - true if string is undefined, null, empty, false otherwise.
 */
export function isStringUndefinedNullEmpty(inputString) {
  if (inputString == null) return true;
  if (typeof inputString !== "string") return true;
  if (inputString.trim().length === 0) return true;
  return false;
}

/**
 * Check if inputFunction is a function.
 * @param {function} inputFunction - inputFunction.
 * @returns {boolean} - true if inputFunction is a function, false otherwise.
 */
export function isFunction(inputFunction) {
  return inputFunction && {}.toString.call(inputFunction) === "[object Function]";
}

export function isDevEnvironment() {
  if (import.meta.env.DEV) {
    console.info("Running in development mode (Vite dev server)");
    return true;
  }
  return false;
}
