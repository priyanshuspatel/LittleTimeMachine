const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const uploadDir = path.join(os.tmpdir(), `memoryquest-audit-${process.pid}`);
fs.mkdirSync(uploadDir, { recursive: true });

process.env.UPLOAD_DIR = uploadDir;
process.env.ELEVENLABS_API_KEY = "test-key";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/memoryquest_test";
process.env.SENTRY_DSN = "";
process.env.HOST = "127.0.0.1";
process.env.PUBLIC_BASE_URL = "http://127.0.0.1:3000";
process.env.RATE_LIMIT_PER_MINUTE = "1000";
