import fs from "node:fs";
import { Builder, By } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const url = process.env.RELAY_E2EE_PAGE_URL || "http://127.0.0.1:5173/e2ee-ci.html";
const baseUrl = process.env.MATRIX_BASE_URL || "http://127.0.0.1:8008";
const password = process.env.MATRIX_TEST_PASSWORD || "RelayCi-Only-Password-42!";
const output = process.env.E2EE_RESULT_FILE || "e2ee-result.json";
const body = `relay-e2ee-browser-ci-${Date.now()}`;

const options = new chrome.Options();
options.addArguments(
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1280,900",
);

let driver;
try {
  driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  await driver.get(url);

  await driver.wait(
    async () => {
      const status = await driver.findElement(By.id("result")).getAttribute("data-status");
      return status === "fail" || status === "pass";
    },
    30000,
    "E2EE page failed to initialize",
  );

  await driver.executeScript(
    "document.querySelector('#result').dataset.status = 'running';",
  );

  await driver.executeAsyncScript(
    `
      const done = arguments[arguments.length - 1];
      const config = arguments[0];
      Promise.resolve(window.runRelayE2EE(config))
        .then((result) => done({ result }))
        .catch((error) => done({ error: String(error?.message || error) }));
    `,
    {
      baseUrl,
      password,
      aliceId: "@alice:localhost",
      bobId: "@bob:localhost",
      body,
    },
  );

  const finalStatus = await driver.wait(
    async () => {
      const status = await driver.findElement(By.id("result")).getAttribute("data-status");
      return status === "pass" || status === "fail" ? status : false;
    },
    120000,
    "E2EE browser acceptance timed out",
  );

  const text = await driver.findElement(By.id("result")).getText();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { ok: false, stage: "driver-parse-result", raw: text.slice(0, 2000) };
  }

  result.browserStatus = finalStatus;
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));

  if (
    finalStatus !== "pass" ||
    result.ok !== true ||
    result.encrypted !== true ||
    result.wireType !== "m.room.encrypted" ||
    result.decryptedType !== "m.room.message" ||
    result.bodyMatches !== true
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  const result = {
    ok: false,
    stage: "selenium-driver",
    error: {
      name: error?.name || "Error",
      message: String(error?.message || error).slice(0, 1800),
    },
  };
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  if (driver) await driver.quit();
}
