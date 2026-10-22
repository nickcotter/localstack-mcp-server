/**
 * Centralized license checker for LocalStack licensed features.
 *
 * Primary source: `GET /_localstack/licenseinfo` (`available_plugins`), which lists the
 * platform plugins the active license enables. Releases that do not serve that endpoint
 * (it answers 404 on LocalStack 3.8.1, for example) fall back to `/_localstack/info`
 * (and `/_localstack/health`): the edition and the license-activation flag decide
 * whether the runtime is a licensed Pro instance at all. On that path a licensed
 * runtime is treated as carrying the feature — the feature's own API call reports when
 * the release does not ship it.
 */
import { LOCALSTACK_BASE_URL } from "../../core/config";
import { httpClient, HttpError } from "../../core/http-client";

export enum ProFeature {
  APP_INSPECTOR = "localstack.platform.plugin/appinspector",
  IAM_ENFORCEMENT = "localstack.platform.plugin/iam-enforcement",
  CLOUD_PODS = "localstack.platform.plugin/pods",
  CHAOS_ENGINEERING = "localstack.platform.plugin/chaos",
  EXTENSIONS = "localstack.platform.plugin/extensions",
  REPLICATOR = "localstack.platform.plugin/replicator",
  SNOWFLAKE = "localstack.aws.provider/snowflake:pro",
  STATE_MANAGEMENT = "localstack.platform.plugin/snapshot",
}

export interface LicenseCheckResult {
  isSupported: boolean;
  errorMessage?: string;
}

interface LicenseInfoResponse {
  available_plugins?: string[];
  [key: string]: any;
}

interface RuntimeInfoResponse {
  edition?: string;
  is_license_activated?: boolean;
  [key: string]: any;
}

const NO_LICENSE_ADVICE =
  "Set LOCALSTACK_AUTH_TOKEN in the MCP server's environment and restart LocalStack " +
  "(localstack-management, action: restart) so the Pro image starts with an activated license.";

function unexpectedError(error: any): LicenseCheckResult {
  return {
    isSupported: false,
    errorMessage: `Unable to verify feature availability due to an unexpected error: ${error?.message || "Unknown error"}`,
  };
}

/**
 * Check if a specific licensed feature is supported by the connected LocalStack instance
 * @param feature The licensed feature to check for
 * @returns Promise<LicenseCheckResult> indicating if the feature is supported
 */
export async function checkProFeature(feature: ProFeature): Promise<LicenseCheckResult> {
  try {
    const licenseInfo: LicenseInfoResponse = await httpClient.request("/_localstack/licenseinfo", {
      method: "GET",
    });

    if (!licenseInfo.available_plugins || !Array.isArray(licenseInfo.available_plugins)) {
      return {
        isSupported: false,
        errorMessage: `Unable to parse license information from LocalStack. The license response format was unexpected.`,
      };
    }

    const isFeatureAvailable = licenseInfo.available_plugins.includes(feature);
    return isFeatureAvailable
      ? { isSupported: true }
      : {
          isSupported: false,
          errorMessage: `Your LocalStack license does not seem to include the '${feature}' feature. Please check your license details.`,
        };
  } catch (error: any) {
    if (error instanceof HttpError && error.status === 404) {
      return await checkProFeatureViaRuntimeInfo(feature);
    }
    if (error.code === "ECONNREFUSED" || error.message?.includes("ECONNREFUSED")) {
      return {
        isSupported: false,
        errorMessage: `Cannot connect to LocalStack. Please ensure LocalStack is running and accessible at ${LOCALSTACK_BASE_URL}.`,
      };
    }
    return unexpectedError(error);
  }
}

/**
 * Fallback for releases without `/_localstack/licenseinfo`: decide from the edition and
 * the license-activation flag of the running instance.
 */
async function checkProFeatureViaRuntimeInfo(feature: ProFeature): Promise<LicenseCheckResult> {
  let info: RuntimeInfoResponse | undefined;
  try {
    info = await httpClient.request<RuntimeInfoResponse>("/_localstack/info", { method: "GET" });
  } catch (error: any) {
    if (!(error instanceof HttpError && error.status === 404)) return unexpectedError(error);
  }
  if (!info || typeof info !== "object") {
    // Very old releases have no /_localstack/info; the health endpoint still names the edition.
    try {
      info = await httpClient.request<RuntimeInfoResponse>("/_localstack/health", {
        method: "GET",
      });
    } catch (error: any) {
      return unexpectedError(error);
    }
  }

  const edition = typeof info?.edition === "string" ? info.edition.toLowerCase() : undefined;
  const activated = info?.is_license_activated;

  if (edition === "community" || activated === false) {
    const detail = [
      edition ? `the ${edition} edition` : "an unlicensed runtime",
      activated === false ? "no activated license" : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      isSupported: false,
      errorMessage: `The '${feature}' feature needs a licensed LocalStack Pro runtime, but the running LocalStack is ${detail}. ${NO_LICENSE_ADVICE}`,
    };
  }
  if (activated === true || edition !== undefined) {
    // No plugin list on this release: a licensed runtime is assumed to carry the
    // feature; the feature's own API answers when this release does not ship it.
    return { isSupported: true };
  }
  return {
    isSupported: false,
    errorMessage: `The '${feature}' feature requires a LocalStack license, but the running LocalStack reports neither a license endpoint nor its edition. ${NO_LICENSE_ADVICE}`,
  };
}
