import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomValues } from "expo-crypto";

import { base64ToBase64Url, type RandomBytes, type Sha256Base64Url } from "./pkce";

/**
 * The app's one import of expo-crypto: the entropy and SHA-256 the device
 * flow needs. Everything else takes these as injected values, so tests never
 * touch a native module and the rest of the auth code stays framework-free.
 */

export const randomBytes: RandomBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  getRandomValues(bytes);
  return bytes;
};

export const sha256Base64Url: Sha256Base64Url = async (value: string) => {
  const base64 = await digestStringAsync(CryptoDigestAlgorithm.SHA256, value, { encoding: CryptoEncoding.BASE64 });
  return base64ToBase64Url(base64);
};
