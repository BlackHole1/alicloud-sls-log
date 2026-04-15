import { afterEach, describe, expect, test } from "bun:test";
import { Request as SLSRequest } from "./request";

class TestRequest extends SLSRequest {
    public send(options: {
        method: "POST" | "GET" | "PUT" | "DELETE";
        path: string;
        projectName?: string;
        queries?: Record<string, any>;
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
    test("空字符串 body 也会生成 content-length 和 content-md5", async () => {
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
});
