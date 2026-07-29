import { afterEach, describe, expect, test } from "bun:test";
import { Request as SLSRequest } from "./request";

class TestRequest extends SLSRequest {
    public send(options: {
        method: "POST" | "GET" | "PUT" | "DELETE";
        path: string;
        projectName?: string;
        queries?: Record<string, any>;
        headers?: Record<string, string>;
        body?: Uint8Array | string;
    }): Promise<any> {
        return this.do(options);
    }
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("Request", () => {
    test("generates content-length and content-md5 even for an empty string body", async () => {
        let requestHeaders: Headers | undefined;

        globalThis.fetch = (async (input, init) => {
            requestHeaders = input instanceof Request
                ? new Headers(input.headers)
                : new Headers(init?.headers);

            return new Response("{}", {
                headers: {
                    "content-type": "application/json",
                },
            });
        }) as typeof fetch;

        const request = new TestRequest({
            accessKeyID: "test-ak",
            accessKeySecret: "test-sk",
            endpoint: "cn-hangzhou.log.aliyuncs.com",
        });

        await request.send({
            method: "POST",
            path: "/logstores/test/logs",
            projectName: "project-a",
            body: "",
        });

        expect(requestHeaders?.get("content-length")).toBe("0");
        expect(requestHeaders?.get("content-md5")).toBe("D41D8CD98F00B204E9800998ECF8427E");
    });

    test("a static stsToken is sent as x-acs-security-token and joins the signature", async () => {
        const captured = captureHeaders();

        const withToken = new TestRequest({
            accessKeyID: "test-ak",
            accessKeySecret: "test-sk",
            endpoint: "cn-hangzhou.log.aliyuncs.com",
            stsToken: "test-sts-token",
        });
        const withoutToken = new TestRequest({
            accessKeyID: "test-ak",
            accessKeySecret: "test-sk",
            endpoint: "cn-hangzhou.log.aliyuncs.com",
        });

        const date = new Date().toUTCString();
        await withToken.send({ method: "GET", path: "/logstores/test", headers: { date } });
        await withoutToken.send({ method: "GET", path: "/logstores/test", headers: { date } });

        expect(captured[0]!.get("x-acs-security-token")).toBe("test-sts-token");
        expect(captured[1]!.get("x-acs-security-token")).toBeNull();
        expect(captured[0]!.get("authorization")).not.toBe(captured[1]!.get("authorization"));
    });

    test("credentialProvider is consulted on every request", async () => {
        const captured = captureHeaders();

        let hits = 0;
        const request = new TestRequest({
            endpoint: "cn-hangzhou.log.aliyuncs.com",
            credentialProvider: () => {
                hits += 1;
                return {
                    accessKeyID: `ak-${hits}`,
                    accessKeySecret: `sk-${hits}`,
                    stsToken: `token-${hits}`,
                };
            },
        });

        await request.send({ method: "GET", path: "/logstores/test" });
        await request.send({ method: "GET", path: "/logstores/test" });

        expect(hits).toBe(2);
        expect(captured[0]!.get("x-acs-security-token")).toBe("token-1");
        expect(captured[0]!.get("authorization")).toMatch(/^LOG ak-1:/);
        expect(captured[1]!.get("x-acs-security-token")).toBe("token-2");
        expect(captured[1]!.get("authorization")).toMatch(/^LOG ak-2:/);
    });

    test("updateCredentialProvider and updateCredential can switch back and forth", async () => {
        const captured = captureHeaders();

        const request = new TestRequest({
            accessKeyID: "static-ak",
            accessKeySecret: "static-sk",
            endpoint: "cn-hangzhou.log.aliyuncs.com",
            stsToken: "static-token",
        });

        await request.send({ method: "GET", path: "/logstores/test" });

        request.updateCredentialProvider(() => ({
            accessKeyID: "provider-ak",
            accessKeySecret: "provider-sk",
            stsToken: "provider-token",
        }));
        await request.send({ method: "GET", path: "/logstores/test" });

        request.updateCredential("rotated-ak", "rotated-sk", "rotated-token");
        await request.send({ method: "GET", path: "/logstores/test" });

        request.updateCredential("plain-ak", "plain-sk");
        await request.send({ method: "GET", path: "/logstores/test" });

        expect(captured[0]!.get("x-acs-security-token")).toBe("static-token");
        expect(captured[1]!.get("x-acs-security-token")).toBe("provider-token");
        expect(captured[1]!.get("authorization")).toMatch(/^LOG provider-ak:/);
        // Rotating temporary credentials: the third argument has to reach the request, otherwise SLS answers Unauthorized
        expect(captured[2]!.get("x-acs-security-token")).toBe("rotated-token");
        expect(captured[2]!.get("authorization")).toMatch(/^LOG rotated-ak:/);
        expect(captured[3]!.get("x-acs-security-token")).toBeNull();
        expect(captured[3]!.get("authorization")).toMatch(/^LOG plain-ak:/);
    });

    test("updating credentials keeps endpoint and globalSafeKyOptions", async () => {
        // The config is rebuilt from scratch on every credential change; a missed field silently alters request behaviour
        const urls: string[] = [];
        globalThis.fetch = (async (input): Promise<Response> => {
            urls.push(input instanceof Request ? input.url : String(input));
            throw new TypeError("network down");
        }) as typeof fetch;

        const request = new TestRequest({
            accessKeyID: "static-ak",
            accessKeySecret: "static-sk",
            endpoint: "cn-hangzhou.log.aliyuncs.com",
            // The default is retry: 2, disabled here; if updateCredential dropped it, the request would fall back to 3 attempts
            globalSafeKyOptions: { retry: 0 },
        });

        request.updateCredential("new-ak", "new-sk");
        await expect(request.send({ method: "GET", path: "/logstores/test", projectName: "project-a" })).rejects.toThrow();

        expect(urls).toEqual(["http://project-a.cn-hangzhou.log.aliyuncs.com/logstores/test"]);

        request.updateCredentialProvider(() => ({ accessKeyID: "p-ak", accessKeySecret: "p-sk" }));
        await expect(request.send({ method: "GET", path: "/logstores/test", projectName: "project-a" })).rejects.toThrow();

        expect(urls).toHaveLength(2);
    });
});

function captureHeaders(): Headers[] {
    const captured: Headers[] = [];

    globalThis.fetch = (async (input, init) => {
        captured.push(input instanceof Request
            ? new Headers(input.headers)
            : new Headers(init?.headers));

        return new Response("{}", {
            headers: {
                "content-type": "application/json",
            },
        });
    }) as typeof fetch;

    return captured;
}
