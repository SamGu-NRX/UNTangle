/**
 * The two values that tie this app to an EAS Update project: the project id
 * and the updates URL. Both come from the environment so no EAS account or
 * project ever lands in the repository (docs/mobile/ota.md). `eas init`
 * prints the project id; the URL is `https://u.expo.dev/<project id>`.
 */

export const EAS_PROJECT_ID_ENV = "EXPO_PUBLIC_EAS_PROJECT_ID";
export const EAS_UPDATE_URL_ENV = "EXPO_PUBLIC_EAS_UPDATE_URL";

/**
 * Syntactically valid stand-in used when no environment is set. It keeps
 * `expo config` and every build green (CI exports the app for web with no
 * environment at all) and is rejected loudly wherever a wrong id would do
 * damage: the publish script refuses it, and the runtime update controller
 * disables checks on it.
 */
export const PLACEHOLDER_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPDATE_URL_PREFIX = "https://u.expo.dev/";

export type Env = Readonly<Record<string, string | undefined>>;

export interface EasProject {
  readonly projectId: string;
  readonly updateUrl: string;
  /** True when the values above are the placeholder, not a real project. */
  readonly isPlaceholder: boolean;
}

/** Thrown when the environment cannot name a real EAS project. */
export class EasProjectConfigError extends Error {}

export interface ResolveEasProjectOptions {
  /**
   * App config evaluation runs for every Expo command, including CI's
   * env-less web export, so app.config passes true and receives the
   * placeholder when the environment is empty. Strict callers (the publish
   * script, the first real build) pass false and get the error instead.
   */
  readonly allowPlaceholder: boolean;
}

export function resolveEasProject(env: Env, options: ResolveEasProjectOptions): EasProject {
  const projectId = env[EAS_PROJECT_ID_ENV]?.trim() ?? "";
  const updateUrl = env[EAS_UPDATE_URL_ENV]?.trim() ?? "";

  if (projectId === "" && updateUrl === "") {
    if (options.allowPlaceholder) {
      return {
        projectId: PLACEHOLDER_PROJECT_ID,
        updateUrl: `${UPDATE_URL_PREFIX}${PLACEHOLDER_PROJECT_ID}`,
        isPlaceholder: true,
      };
    }
    throw new EasProjectConfigError(
      `Missing ${EAS_PROJECT_ID_ENV} and ${EAS_UPDATE_URL_ENV}. Run \`eas init\` in mobile/ to get the ` +
        `project id, then set ${EAS_PROJECT_ID_ENV}=<id> and ` +
        `${EAS_UPDATE_URL_ENV}=https://u.expo.dev/<id> before publishing. See docs/mobile/ota.md.`,
    );
  }

  // One set without the other is always an error, placeholder mode included:
  // half a project id is never something to fall back from.
  if (projectId === "") {
    throw new EasProjectConfigError(
      `${EAS_UPDATE_URL_ENV} is set but ${EAS_PROJECT_ID_ENV} is not. Set both.`,
    );
  }
  if (updateUrl === "") {
    throw new EasProjectConfigError(
      `${EAS_PROJECT_ID_ENV} is set but ${EAS_UPDATE_URL_ENV} is not. ` +
        `Set it to https://u.expo.dev/${projectId}.`,
    );
  }
  if (!UUID.test(projectId)) {
    throw new EasProjectConfigError(
      `${EAS_PROJECT_ID_ENV} must be the project id UUID that \`eas init\` prints, got "${projectId}".`,
    );
  }
  if (!updateUrl.startsWith(UPDATE_URL_PREFIX)) {
    throw new EasProjectConfigError(
      `${EAS_UPDATE_URL_ENV} must start with ${UPDATE_URL_PREFIX}, got "${updateUrl}".`,
    );
  }
  return { projectId, updateUrl, isPlaceholder: false };
}
