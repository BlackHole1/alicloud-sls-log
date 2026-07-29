# alicloud-sls-log

A lightweight TypeScript client for Alibaba Cloud SLS.

## Installation

```bash
npm install alicloud-sls-log
```

Or with bun:

```bash
bun add alicloud-sls-log
```

## Quick Start

```ts
import { AliCloudSLSLog, createLog } from "alicloud-sls-log";

// Initialize client
const log = new AliCloudSLSLog({
    accessKeyID: "Your Access Key ID",
    accessKeySecret: "Your Access Key Secret",
    endpoint: "Your Endpoint", // e.g. cn-hangzhou.log.aliyuncs.com
});

// Send logs
await log.putLogs("Your Project Name", "Your Logstore Name", {
    logs: [
        createLog(
            { message: "Your Log Message" },
            Math.floor(Date.now() / 1000), // optional: timestamp in seconds
            Math.floor(Date.now() * 1000 * 1000) % 1000000000 // optional: timestamp nanoseconds part
        ),
    ],
});
```

## API

### AliCloudSLSLog

```ts
const sls = new AliCloudSLSLog({
    accessKeyID: "Your Access Key ID",
    accessKeySecret: "Your Access Key Secret",
    endpoint: "Your Endpoint", // e.g. cn-hangzhou.log.aliyuncs.com
});
```

#### STS Credentials

Pass an `stsToken` alongside the temporary AccessKey pair to authenticate with STS credentials:

```ts
const sls = new AliCloudSLSLog({
    accessKeyID: "Your STS Access Key ID",
    accessKeySecret: "Your STS Access Key Secret",
    stsToken: "Your STS Security Token",
    endpoint: "Your Endpoint",
});
```

Rotate the credentials before they expire with `updateCredential()`:

```ts
sls.updateCredential("New Access Key ID", "New Access Key Secret", "New STS Security Token");
```

#### OIDC Credentials

For long-running workloads, use an OIDC credential provider instead of passing one STS token at startup. The provider calls `AssumeRoleWithOIDC`, caches the returned STS credentials, and refreshes them before expiration. Concurrent refreshes are merged into a single STS request; if a refresh fails, the provider keeps serving the cached credentials while they are still valid and backs off for `refreshFailureBackoffSeconds` (default 60) before calling STS again.

```ts
import { AliCloudSLSLog, createOIDCCredentialProviderFromEnv } from "alicloud-sls-log";

const sls = new AliCloudSLSLog({
    endpoint: "Your Endpoint",
    credentialProvider: createOIDCCredentialProviderFromEnv(),
});
```

`createOIDCCredentialProviderFromEnv()` reads `ALIBABA_CLOUD_ROLE_ARN`, `ALIBABA_CLOUD_OIDC_PROVIDER_ARN`, and `ALIBABA_CLOUD_OIDC_TOKEN_FILE`. You can also pass explicit values:

```ts
import { AliCloudSLSLog, createOIDCCredentialProvider } from "alicloud-sls-log";

const sls = new AliCloudSLSLog({
    endpoint: "Your Endpoint",
    credentialProvider: createOIDCCredentialProvider({
        roleArn: "acs:ram::1234567890123456:role/example",
        oidcProviderArn: "acs:ram::1234567890123456:oidc-provider/example",
        oidcTokenFilePath: "/var/run/secrets/ack.alibabacloud.com/rrsa-tokens/token",
        roleSessionName: "sls-worker",
        refreshBeforeExpirationSeconds: 300,
    }),
});
```

An existing client can switch to a provider at any time with `updateCredentialProvider()`:

```ts
sls.updateCredentialProvider(createOIDCCredentialProviderFromEnv());
```

#### Custom Credential Providers

`credentialProvider` accepts any `() => Credentials | Promise<Credentials>`. **It is called once per request**, so a custom provider must cache the credentials itself — otherwise every log write triggers a fresh round trip to your credential source. The `expiration` field on `Credentials` is informational only; the client never reads it to decide whether to reuse credentials.

```ts
import { AliCloudSLSLog, type Credentials } from "alicloud-sls-log";

let cached: Credentials | undefined;

const sls = new AliCloudSLSLog({
    endpoint: "Your Endpoint",
    credentialProvider: async () => {
        if (!cached || isAboutToExpire(cached)) {
            cached = await fetchCredentialsFromSomewhere();
        }
        return cached;
    },
});
```

#### `putLogs()`

Put logs to a specific logstore.

```ts
putLogs(projectName: string, logstoreName: string, data: LogData): Promise<void>
```

**Parameters:**

- `projectName` - Name of your SLS project
- `logstoreName` - Name of your logstore
- `data.logs` - Array of log entities (required)
- `data.tags` - Array of tag objects (optional)
- `data.topic` - Log topic (optional)
- `data.source` - Log source (optional)

**Example with tags and topic:**

```ts
await log.putLogs("my-project", "my-logstore", {
    logs: [
        createLog({ message: "User login", userId: "12345" }),
    ],
    tags: [{ environment: "production", version: "1.0.0" }],
    topic: "user-events",
    source: "web-server-01",
});
```

### `getLogs()`

Get logs from a specific logstore.

```ts
getLogs(projectName: string, logstoreName: string, query: GetLogsQuery): Promise<GetLogsResponse>
```

**Parameters:**

- `projectName` - Name of your SLS project
- `logstoreName` - Name of your logstore
- `query.from` - Start time in unix timestamp(milliseconds or seconds)
- `query.to` - End time in unix timestamp(milliseconds or seconds)
- `query?.query` - Query string
- `query?.topic` - Log topic
- `query?.line` - Line number
- `query?.offset` - Offset
- `query?.reverse` - Reverse order
- `query?.powerSql` - PowerSQL mode

**Example:**

```ts
const logs = await log.getLogs("my-project", "my-logstore", {
    from: Date.now() - 1000,
    to: Date.now() + 1000,
    topic: "user-events",
});
```

## Utils

### `createLog()`

Helper function to create log entities.

```ts
createLog(content: Record<string, any>, timestamp?: number, timestampNsPart?: number): LogEntity
```

**Parameters:**

- `content` - Log content as key-value pairs (required)
- `timestamp` - Unix timestamp in seconds or milliseconds (optional, defaults to `Date.now()`)
  - If < 10^12, treated as seconds
  - If >= 10^12, treated as milliseconds
- `timestampNsPart` - Nanoseconds part of timestamp (optional, 0-999999999)

## License

MIT © [Kevin Cui](https://github.com/BlackHole1)
