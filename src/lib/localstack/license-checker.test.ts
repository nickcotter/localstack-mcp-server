import { checkProFeature, ProFeature } from "./license-checker";
import { httpClient, HttpError } from "../../core/http-client";

jest.mock("../../core/http-client", () => {
  const actual = jest.requireActual("../../core/http-client");
  return { ...actual, httpClient: { request: jest.fn() } };
});

const mockedRequest = httpClient.request as jest.MockedFunction<typeof httpClient.request>;
const notFound = (path: string) =>
  new HttpError(404, "Not Found", "", `HTTP Error: 404 Not Found for URL: ${path}`);

/** Route the mocked requests by endpoint; a missing entry answers 404. */
function serve(routes: Record<string, unknown>) {
  mockedRequest.mockImplementation(async (endpoint: string) => {
    if (endpoint in routes) {
      const value = routes[endpoint];
      if (value instanceof Error) throw value;
      return value;
    }
    throw notFound(endpoint);
  });
}

describe("checkProFeature", () => {
  beforeEach(() => mockedRequest.mockReset());

  test("uses the plugin list from /_localstack/licenseinfo when the endpoint exists", async () => {
    serve({ "/_localstack/licenseinfo": { available_plugins: [ProFeature.CHAOS_ENGINEERING] } });
    expect(await checkProFeature(ProFeature.CHAOS_ENGINEERING)).toEqual({ isSupported: true });
    const missing = await checkProFeature(ProFeature.CLOUD_PODS);
    expect(missing.isSupported).toBe(false);
    expect(missing.errorMessage).toMatch(/does not seem to include/);
    // The fallback is not consulted when the license endpoint answers.
    expect(mockedRequest).not.toHaveBeenCalledWith("/_localstack/info", expect.anything());
  });

  test("3.8.1 Community: no licenseinfo endpoint, /_localstack/info names the community edition", async () => {
    serve({
      "/_localstack/info": { version: "3.8.1", edition: "community", is_license_activated: false },
    });
    const result = await checkProFeature(ProFeature.IAM_ENFORCEMENT);
    expect(result.isSupported).toBe(false);
    expect(result.errorMessage).toMatch(/community edition/);
    expect(result.errorMessage).toMatch(/LOCALSTACK_AUTH_TOKEN/);
    expect(result.errorMessage).toMatch(/restart/);
  });

  test("3.8.1 Pro: no licenseinfo endpoint, an activated license counts as support", async () => {
    serve({
      "/_localstack/info": { version: "3.8.1", edition: "pro", is_license_activated: true },
    });
    expect(await checkProFeature(ProFeature.IAM_ENFORCEMENT)).toEqual({ isSupported: true });
  });

  test("Pro image without an activated license is reported, not assumed", async () => {
    serve({
      "/_localstack/info": { version: "3.8.1", edition: "pro", is_license_activated: false },
    });
    const result = await checkProFeature(ProFeature.EXTENSIONS);
    expect(result.isSupported).toBe(false);
    expect(result.errorMessage).toMatch(/no activated license/);
  });

  test("falls back to the health edition when /_localstack/info is missing too", async () => {
    serve({ "/_localstack/health": { services: {}, edition: "pro", version: "3.0.0" } });
    expect(await checkProFeature(ProFeature.CHAOS_ENGINEERING)).toEqual({ isSupported: true });

    serve({ "/_localstack/health": { services: {}, edition: "community", version: "3.0.0" } });
    const result = await checkProFeature(ProFeature.CHAOS_ENGINEERING);
    expect(result.isSupported).toBe(false);
    expect(result.errorMessage).toMatch(/community edition/);
  });

  test("an unreachable runtime is reported as a connection problem", async () => {
    mockedRequest.mockRejectedValue(
      new Error("Connection refused at http://localhost:4566 (ECONNREFUSED)")
    );
    const result = await checkProFeature(ProFeature.CHAOS_ENGINEERING);
    expect(result.isSupported).toBe(false);
    expect(result.errorMessage).toMatch(/Cannot connect to LocalStack/);
  });

  test("a malformed license response is not treated as support", async () => {
    serve({ "/_localstack/licenseinfo": { license: "ok" } });
    const result = await checkProFeature(ProFeature.CHAOS_ENGINEERING);
    expect(result.isSupported).toBe(false);
    expect(result.errorMessage).toMatch(/unexpected/);
  });
});
