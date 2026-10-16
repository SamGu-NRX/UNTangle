import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { createAuth, type Auth, type AuthState } from "./auth-core";
import { randomBytes, sha256Base64Url } from "./native-crypto";
import { createSecureTokenStore } from "./secure-token-store";

/**
 * The React face of the auth module: one Auth instance for the app, its state
 * through useSyncExternalStore, and restore() at startup. The app shell wraps
 * everything here; screens read the state and call the methods.
 */

type AuthContextValue = {
  auth: Auth;
  state: AuthState;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // One instance per app lifetime. The module-level bindings keep the native
  // imports in exactly two files (native-crypto.ts, secure-token-store.ts).
  const auth = useMemo(
    () =>
      createAuth({
        tokenStore: createSecureTokenStore(),
        randomBytes,
        sha256Base64Url,
      }),
    [],
  );

  const state = useSyncExternalStore(
    listener => auth.subscribe(listener),
    () => auth.getState(),
  );

  useEffect(() => {
    void auth.restore();
  }, [auth]);

  const value = useMemo<AuthContextValue>(() => ({ auth, state }), [auth, state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth needs an AuthProvider above it (app/_layout.tsx).");
  return value;
}
