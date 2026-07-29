import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, test } from "bun:test";
import { createOIDCCredentialProvider, createOIDCCredentialProviderFromEnv, OIDCCredentialProvider } from "./credentials";

const ENV_KEYS = [
    "ALIBABA_CLOUD_ROLE_ARN",
    "ALIBABA_CLOUD_OIDC_PROVIDER_ARN",
    "ALIBABA_CLOUD_OIDC_TOKEN_FILE",
    "ALIBABA_CLOUD_ROLE_SESSION_NAME",
    "ALIBABA_CLOUD_STS_ENDPOINT",
] as const;

describe("OIDC credential provider", () => {
    test("exchanges an OIDC token for STS credentials", async () => {
        const requests: URLSearchParams[] = [];
        const urls: string[] = [];
        const restoreFetch = mockSTSFetch((params, request) => {
            requests.push(params);
            urls.push(request.url);
            return createSTSResponse({
                accessKeyID: "access-key-id",
                accessKeySecret: "access-key-secret",
                stsToken: "security-token",
            });
        });

        try {
            const credentialProvider = createOIDCCredentialProvider({
                durationSeconds: 900,
                oidcProviderArn: "acs:ram::1234567890123456:oidc-provider/example",
                oidcToken: "oidc-token",
                policy: JSON.stringify({
                    Statement: [],
                    Version: "1",
                }),
                roleArn: "acs:ram::1234567890123456:role/example",
                roleSessionName: "sls-test",
                stsEndpoint: "https://sts.example.com?source=test",
            });

            const credentials = await credentialProvider();

            expect(credentials).toEqual({
                accessKeyID: "access-key-id",
                accessKeySecret: "access-key-secret",
                expiration: expect.any(Date),
                stsToken: "security-token",
            });
            expect(requests).toHaveLength(1);
            expect(urls).toEqual(["https://sts.example.com/?source=test"]);
            expect(requests[0]!.get("Action")).toBe("AssumeRoleWithOIDC");
            expect(requests[0]!.get("Version")).toBe("2015-04-01");
            expect(requests[0]!.get("Format")).toBe("JSON");
            expect(requests[0]!.get("OIDCToken")).toBe("oidc-token");
            expect(requests[0]!.get("RoleArn")).toBe("acs:ram::1234567890123456:role/example");
            expect(requests[0]!.get("OIDCProviderArn")).toBe("acs:ram::1234567890123456:oidc-provider/example");
            expect(requests[0]!.get("RoleSessionName")).toBe("sls-test");
            expect(requests[0]!.get("DurationSeconds")).toBe("900");
            expect(requests[0]!.get("Policy")).toBe(JSON.stringify({ Statement: [], Version: "1" }));
            expect(requests[0]!.get("Timestamp")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
            expect(requests[0]!.get("SignatureNonce")).toMatch(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
        }
        finally {
            restoreFetch();
        }
    });

    test("omits Policy and DurationSeconds when they are not configured", async () => {
        const requests: URLSearchParams[] = [];
        const restoreFetch = mockSTSFetch((params) => {
            requests.push(params);
            return createSTSResponse({
                accessKeyID: "access-key-id",
                accessKeySecret: "access-key-secret",
                stsToken: "security-token",
            });
        });

        try {
            await createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            })();

            expect(requests[0]!.get("Policy")).toBeNull();
            expect(requests[0]!.get("DurationSeconds")).toBeNull();
            expect(requests[0]!.get("RoleSessionName")).toBe("alicloud-sls-log");
        }
        finally {
            restoreFetch();
        }
    });

    test("reads the OIDC token from a file and trims surrounding whitespace", async () => {
        const requests: URLSearchParams[] = [];
        const restoreFetch = mockSTSFetch((params) => {
            requests.push(params);
            return createSTSResponse({
                accessKeyID: "access-key-id",
                accessKeySecret: "access-key-secret",
                stsToken: "security-token",
            });
        });
        const dir = await mkdtemp(join(tmpdir(), "sls-oidc-"));
        const oidcTokenFilePath = join(dir, "token");
        // Projected K8s token files usually end with a newline, which STS rejects unless trimmed
        await writeFile(oidcTokenFilePath, "  token-from-file\n");

        try {
            await createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcTokenFilePath,
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            })();

            expect(requests[0]!.get("OIDCToken")).toBe("token-from-file");
        }
        finally {
            restoreFetch();
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("throws when neither oidcToken nor oidcTokenFilePath is provided", async () => {
        const restoreFetch = mockSTSFetch(() => new Response("should not be called", { status: 500 }));

        try {
            const credentialProvider = createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });

            await expect(credentialProvider()).rejects.toThrow("Either oidcToken or oidcTokenFilePath is required");
        }
        finally {
            restoreFetch();
        }
    });

    test("getCredentials survives being detached from its instance", async () => {
        const restoreFetch = mockSTSFetch(() => createSTSResponse({
            accessKeyID: "access-key-id",
            accessKeySecret: "access-key-secret",
            stsToken: "security-token",
        }));

        try {
            const provider = new OIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });
            const detached = provider.getCredentials;

            await expect(detached()).resolves.toMatchObject({ accessKeyID: "access-key-id" });
        }
        finally {
            restoreFetch();
        }
    });

    test("caches credentials and shares concurrent refreshes", async () => {
        let hits = 0;
        const restoreFetch = mockSTSFetch(async () => {
            hits += 1;
            await sleep(20);
            return createSTSResponse({
                accessKeyID: `access-key-id-${hits}`,
                accessKeySecret: `access-key-secret-${hits}`,
                stsToken: `security-token-${hits}`,
            });
        });

        try {
            const credentialProvider = createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });

            const [first, second, third] = await Promise.all([
                credentialProvider(),
                credentialProvider(),
                credentialProvider(),
            ]);
            const cached = await credentialProvider();

            expect(hits).toBe(1);
            expect(first!.accessKeyID).toBe("access-key-id-1");
            expect(second!.accessKeyID).toBe("access-key-id-1");
            expect(third!.accessKeyID).toBe("access-key-id-1");
            expect(cached.accessKeyID).toBe("access-key-id-1");
        }
        finally {
            restoreFetch();
        }
    });

    test("clears only the refresh it started, never a newer in-flight one", async () => {
        let hits = 0;
        const restoreFetch = mockSTSFetch(async () => {
            hits += 1;
            await sleep(10);
            return createSTSResponse({
                accessKeyID: `access-key-id-${hits}`,
                accessKeySecret: `access-key-secret-${hits}`,
                // Always inside the refresh window, so every later call takes the refresh branch
                expiration: new Date(Date.now() + 60_000),
                stsToken: `security-token-${hits}`,
            });
        });

        try {
            const provider = new OIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });

            const first = provider.getCredentials();
            // Reading internal state on purpose: it places a new refresh exactly between the two waiters' continuations.
            // If finally cleared refreshPromise unconditionally, the second waiter would drop that new refresh,
            // and the next call would start a third concurrent AssumeRoleWithOIDC
            const inFlight = Reflect.get(provider, "refreshPromise") as Promise<unknown>;
            const middle = inFlight.then(() => provider.getCredentials());
            const second = provider.getCredentials();

            await second;
            const afterwards = provider.getCredentials();
            await Promise.all([first, middle, afterwards]);

            expect(hits).toBe(2);
        }
        finally {
            restoreFetch();
        }
    });

    test("refreshes credentials before expiration with a fresh SignatureNonce every time", async () => {
        let hits = 0;
        const requests: URLSearchParams[] = [];
        const restoreFetch = mockSTSFetch((params) => {
            hits += 1;
            requests.push(params);
            // The first credentials land inside the 300s refresh window, the second well outside it
            const expiresIn = hits === 1 ? 60_000 : 3600_000;
            return createSTSResponse({
                accessKeyID: `access-key-id-${hits}`,
                accessKeySecret: `access-key-secret-${hits}`,
                expiration: new Date(Date.now() + expiresIn),
                stsToken: `security-token-${hits}`,
            });
        });

        try {
            const credentialProvider = createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });

            const first = await credentialProvider();
            const second = await credentialProvider();
            const cached = await credentialProvider();

            expect(hits).toBe(2);
            expect(first.accessKeyID).toBe("access-key-id-1");
            expect(second.accessKeyID).toBe("access-key-id-2");
            expect(cached.accessKeyID).toBe("access-key-id-2");
            // SignatureNonce guards against replay, so reusing one value gets rejected by STS
            expect(requests[0]!.get("SignatureNonce")).not.toBe(requests[1]!.get("SignatureNonce"));
        }
        finally {
            restoreFetch();
        }
    });

    test("refreshBeforeExpirationSeconds overrides the default 300s refresh window", async () => {
        let hits = 0;
        const restoreFetch = mockSTSFetch(() => {
            hits += 1;
            return createSTSResponse({
                accessKeyID: `access-key-id-${hits}`,
                accessKeySecret: `access-key-secret-${hits}`,
                // A 400s lifetime: inside the custom 600s window, outside the default 300s one
                expiration: new Date(Date.now() + 400_000),
                stsToken: `security-token-${hits}`,
            });
        });

        try {
            const widened = createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                refreshBeforeExpirationSeconds: 600,
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });
            await widened();
            await widened();
            expect(hits).toBe(2);

            hits = 0;
            const byDefault = createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });
            await byDefault();
            await byDefault();
            expect(hits).toBe(1);
        }
        finally {
            restoreFetch();
        }
    });

    test("keeps using unexpired credentials when a refresh fails and stops calling STS while backing off", async () => {
        let attempts = 0;
        let failing = false;
        const restoreFetch = mockSTSFetch(() => {
            attempts += 1;
            if (failing) {
                return new Response("boom", { status: 503, statusText: "Service Unavailable" });
            }

            return createSTSResponse({
                accessKeyID: "access-key-id",
                accessKeySecret: "access-key-secret",
                // Inside the 300s refresh window but not expired yet, so the next call refreshes and then falls back
                expiration: new Date(Date.now() + 60_000),
                stsToken: "security-token",
            });
        });

        try {
            const credentialProvider = createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });

            const first = await credentialProvider();
            expect(attempts).toBe(1);

            failing = true;
            const fallback = await credentialProvider();
            // 503 is one of ky's retriable status codes, so a single refresh is 1 initial call plus 2 retries
            expect(attempts).toBe(4);

            const backedOff = await credentialProvider();
            expect(attempts).toBe(4);

            expect(first.accessKeyID).toBe("access-key-id");
            expect(fallback.accessKeyID).toBe("access-key-id");
            expect(fallback.stsToken).toBe("security-token");
            expect(backedOff.accessKeyID).toBe("access-key-id");
        }
        finally {
            restoreFetch();
        }
    });

    test("throws when the very first refresh fails and stops calling STS while backing off", async () => {
        let attempts = 0;
        const restoreFetch = mockSTSFetch(() => {
            attempts += 1;
            return Response.json({
                Code: "Throttling.User",
                Message: "Request was denied due to user flow control.",
                RequestId: "req-1",
            }, { status: 429, statusText: "Too Many Requests" });
        });

        try {
            const credentialProvider = createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            });

            await expect(credentialProvider()).rejects.toThrow(/429 Too Many Requests: Throttling\.User: .*: RequestId: req-1/);
            expect(attempts).toBe(3);

            // Backing off matters most without cached credentials, otherwise the caller's QPS lands straight on STS
            await expect(credentialProvider()).rejects.toThrow("backing off");
            expect(attempts).toBe(3);
        }
        finally {
            restoreFetch();
        }
    });

    test("sends a single request when STS returns a non-retriable status code", async () => {
        let attempts = 0;
        const restoreFetch = mockSTSFetch(() => {
            attempts += 1;
            return Response.json({
                Code: "NoPermission",
                Message: "You are not authorized to do this action.",
            }, { status: 403, statusText: "Forbidden" });
        });

        try {
            await expect(createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            })()).rejects.toThrow("Failed to assume role with OIDC: 403 Forbidden: NoPermission: You are not authorized to do this action.");
            expect(attempts).toBe(1);
        }
        finally {
            restoreFetch();
        }
    });

    test("carries the raw body into the error when STS returns a non-JSON error response", async () => {
        const restoreFetch = mockSTSFetch(() => new Response("<html>gateway boom</html>", { status: 502, statusText: "Bad Gateway" }));

        try {
            await expect(createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            })()).rejects.toThrow("gateway boom");
        }
        finally {
            restoreFetch();
        }
    });

    test("throws when STS returns incomplete credentials", async () => {
        const restoreFetch = mockSTSFetch(() => ({
            Credentials: {
                AccessKeyId: "access-key-id",
                Expiration: new Date(Date.now() + 3600_000).toISOString(),
            },
        }));

        try {
            await expect(createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            })()).rejects.toThrow("did not include complete credentials");
        }
        finally {
            restoreFetch();
        }
    });

    test("throws when STS returns an invalid expiration", async () => {
        const restoreFetch = mockSTSFetch(() => ({
            Credentials: {
                AccessKeyId: "access-key-id",
                AccessKeySecret: "access-key-secret",
                Expiration: "not-a-date",
                SecurityToken: "security-token",
            },
        }));

        try {
            await expect(createOIDCCredentialProvider({
                oidcProviderArn: "provider",
                oidcToken: "oidc-token",
                roleArn: "role",
                stsEndpoint: "https://sts.example.com",
            })()).rejects.toThrow("invalid credentials expiration");
        }
        finally {
            restoreFetch();
        }
    });
});

describe("createOIDCCredentialProviderFromEnv", () => {
    test("reads its configuration from environment variables", async () => {
        const requests: URLSearchParams[] = [];
        const urls: string[] = [];
        const restoreFetch = mockSTSFetch((params, request) => {
            requests.push(params);
            urls.push(request.url);
            return createSTSResponse({
                accessKeyID: "access-key-id",
                accessKeySecret: "access-key-secret",
                stsToken: "security-token",
            });
        });
        const restoreEnv = snapshotEnv();
        const dir = await mkdtemp(join(tmpdir(), "sls-oidc-env-"));
        const oidcTokenFilePath = join(dir, "token");
        await writeFile(oidcTokenFilePath, "token-from-env-file\n");

        try {
            process.env.ALIBABA_CLOUD_ROLE_ARN = "acs:ram::1234567890123456:role/from-env";
            process.env.ALIBABA_CLOUD_OIDC_PROVIDER_ARN = "acs:ram::1234567890123456:oidc-provider/from-env";
            process.env.ALIBABA_CLOUD_OIDC_TOKEN_FILE = oidcTokenFilePath;
            process.env.ALIBABA_CLOUD_ROLE_SESSION_NAME = "session-from-env";
            process.env.ALIBABA_CLOUD_STS_ENDPOINT = "https://sts-from-env.example.com";

            await createOIDCCredentialProviderFromEnv()();

            expect(urls).toEqual(["https://sts-from-env.example.com/"]);
            expect(requests[0]!.get("RoleArn")).toBe("acs:ram::1234567890123456:role/from-env");
            expect(requests[0]!.get("OIDCProviderArn")).toBe("acs:ram::1234567890123456:oidc-provider/from-env");
            expect(requests[0]!.get("RoleSessionName")).toBe("session-from-env");
            expect(requests[0]!.get("OIDCToken")).toBe("token-from-env-file");
        }
        finally {
            restoreFetch();
            restoreEnv();
            await rm(dir, { force: true, recursive: true });
        }
    });

    test("explicit configuration takes precedence over environment variables", async () => {
        const requests: URLSearchParams[] = [];
        const restoreFetch = mockSTSFetch((params) => {
            requests.push(params);
            return createSTSResponse({
                accessKeyID: "access-key-id",
                accessKeySecret: "access-key-secret",
                stsToken: "security-token",
            });
        });
        const restoreEnv = snapshotEnv();

        try {
            process.env.ALIBABA_CLOUD_ROLE_ARN = "role-from-env";
            process.env.ALIBABA_CLOUD_OIDC_PROVIDER_ARN = "provider-from-env";
            process.env.ALIBABA_CLOUD_ROLE_SESSION_NAME = "session-from-env";

            await createOIDCCredentialProviderFromEnv({
                oidcToken: "oidc-token",
                roleArn: "role-from-config",
                roleSessionName: "session-from-config",
                stsEndpoint: "https://sts.example.com",
            })();

            expect(requests[0]!.get("RoleArn")).toBe("role-from-config");
            expect(requests[0]!.get("OIDCProviderArn")).toBe("provider-from-env");
            expect(requests[0]!.get("RoleSessionName")).toBe("session-from-config");
        }
        finally {
            restoreFetch();
            restoreEnv();
        }
    });

    test("throws an error naming the missing required option", () => {
        const restoreEnv = snapshotEnv();

        try {
            for (const key of ENV_KEYS) {
                delete process.env[key];
            }

            expect(() => createOIDCCredentialProviderFromEnv()).toThrow("roleArn or ALIBABA_CLOUD_ROLE_ARN is required");

            process.env.ALIBABA_CLOUD_ROLE_ARN = "role";
            expect(() => createOIDCCredentialProviderFromEnv()).toThrow("oidcProviderArn or ALIBABA_CLOUD_OIDC_PROVIDER_ARN is required");

            process.env.ALIBABA_CLOUD_OIDC_PROVIDER_ARN = "provider";
            expect(() => createOIDCCredentialProviderFromEnv()).toThrow("oidcToken, oidcTokenFilePath, or ALIBABA_CLOUD_OIDC_TOKEN_FILE is required");

            process.env.ALIBABA_CLOUD_OIDC_TOKEN_FILE = "/var/run/secrets/token";
            expect(() => createOIDCCredentialProviderFromEnv()).not.toThrow();
        }
        finally {
            restoreEnv();
        }
    });
});

interface STSResponseOptions {
    accessKeyID: string;
    accessKeySecret: string;
    expiration?: Date;
    stsToken: string;
}

function mockSTSFetch(handler: (params: URLSearchParams, request: Request) => unknown | Promise<unknown>): () => void {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const params = new URLSearchParams(await request.text());
        const result = await handler(params, request);
        return result instanceof Response ? result : Response.json(result);
    }) as typeof fetch;

    return () => {
        globalThis.fetch = originalFetch;
    };
}

function snapshotEnv(): () => void {
    const snapshot = ENV_KEYS.map(key => [key, process.env[key]] as const);

    return () => {
        for (const [key, value] of snapshot) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    };
}

function createSTSResponse(options: STSResponseOptions) {
    return {
        Credentials: {
            AccessKeyId: options.accessKeyID,
            AccessKeySecret: options.accessKeySecret,
            Expiration: (options.expiration ?? new Date(Date.now() + 3600_000)).toISOString(),
            SecurityToken: options.stsToken,
        },
    };
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
