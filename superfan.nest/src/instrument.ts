// Import with `const Sentry = require("@sentry/nestjs");` if you are using CJS
import * as Sentry from "@sentry/nestjs";

Sentry.init({
  dsn: "https://7d24bdc3e76ac3940c75c33a96c77360@o4511109559877632.ingest.us.sentry.io/4511109561581568",
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});