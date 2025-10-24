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
