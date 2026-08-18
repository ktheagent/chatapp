import fs from "node:fs";
import { createClient } from "matrix-js-sdk";

const BASE_URL = process.env.MATRIX_BASE_URL || "http://127.0.0.1:8008";
const PASSWORD = process.env.MATRIX_TEST_PASSWORD || "RelayCi-Only-Password-42!";
const RESULT_FILE = process.env.E2EE_RESULT_FILE || "e2ee-result.json";
const ALICE = "@alice:localhost";
const BOB = "@bob:localhost";
const BODY = `relay-e2ee-ci-${Date.now()}`;

let stage = "boot";
let alice;
let bob;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeResult(result) {
  fs.writeFileSync(
    RESULT_FILE,
    `${JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        ...result,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function safeError(error) {
  return {
    name: error?.name || "Error",
    message: String(error?.message || error || "Unknown error").slice(0, 1200),
    errcode: error?.errcode || error?.data?.errcode || null,
    httpStatus: error?.httpStatus || error?.data?.statusCode || null,
  };
}

function mark(nextStage) {
  stage = nextStage;
  console.log(`[stage] ${nextStage}`);
}

async function waitFor(label, fn, timeoutMs = 30000, intervalMs = 250) {
  const end = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const suffix = lastError ? `: ${lastError.message}` : "";
  throw new Error(`${label} timed out${suffix}`);
}

async function authenticatedClient(userId, password, deviceId) {
  mark(`login:${userId}`);
  const unauthenticated = createClient({ baseUrl: BASE_URL });
  const login = await unauthenticated.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user: userId },
    password,
    device_id: deviceId,
    initial_device_display_name: `Relay CI ${deviceId}`,
  });

  mark(`crypto:${userId}`);
  const client = createClient({
    baseUrl: BASE_URL,
    userId: login.user_id,
    accessToken: login.access_token,
    deviceId: login.device_id,
  });

  await client.initRustCrypto({ useIndexedDB: false });

  mark(`sync:${userId}`);
  const prepared = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${userId} initial sync timed out`)),
      30000,
    );

    client.on("sync", (state) => {
      if (state === "PREPARED") {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  client.startClient({ initialSyncLimit: 20 });
  await prepared;
  return client;
}

async function run() {
  alice = await authenticatedClient(ALICE, PASSWORD, "RELAY_ALICE_CI");
  bob = await authenticatedClient(BOB, PASSWORD, "RELAY_BOB_CI");

  mark("create-encrypted-room");
  const created = await alice.createRoom({
    is_direct: true,
    invite: [BOB],
    preset: "trusted_private_chat",
    initial_state: [
      {
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      },
    ],
  });

  const roomId = created.room_id;
  if (!roomId) throw new Error("createRoom returned no room_id");

  mark("bob-join-room");
  await bob.joinRoom(roomId);

  mark("alice-observe-bob-join");
  await waitFor("Alice to observe Bob joined", () => {
    const room = alice.getRoom(roomId);
    return room?.getMember(BOB)?.membership === "join";
  });

  mark("bob-observe-encryption-state");
  await waitFor("Bob to observe encrypted room", () => {
    const room = bob.getRoom(roomId);
    if (!room || room.getMyMembership() !== "join") return false;
    return Boolean(
      room.currentState?.getStateEvents("m.room.encryption", ""),
    );
  });

  mark("alice-send-encrypted-message");
  const sendResult = await alice.sendTextMessage(roomId, BODY);
  if (!sendResult?.event_id) {
    throw new Error("sendTextMessage returned no event_id");
  }

  mark("bob-receive-and-decrypt");
  const received = await waitFor(
    "Bob to receive and decrypt Alice message",
    async () => {
      const room = bob.getRoom(roomId);
      const event = room
        ?.getLiveTimeline()
        .getEvents()
        .find((candidate) => candidate.getId() === sendResult.event_id);

      if (!event) return null;

      if (event.isEncrypted() && !event.getClearContent()) {
        await bob.decryptEventIfNeeded(event);
      }

      const clear = event.getClearContent();
      if (
        event.isEncrypted() &&
        event.getWireType() === "m.room.encrypted" &&
        event.getType() === "m.room.message" &&
        clear?.body === BODY
      ) {
        return event;
      }

      return null;
    },
    45000,
    300,
  );

  const evidence = {
    ok: true,
    stage: "complete",
    roomId,
    eventId: received.getId(),
    sender: received.getSender(),
    wireType: received.getWireType(),
    decryptedType: received.getType(),
    encrypted: received.isEncrypted(),
    bodyMatches: received.getClearContent()?.body === BODY,
  };

  writeResult(evidence);
  console.log(JSON.stringify(evidence, null, 2));
}

try {
  await run();
} catch (error) {
  const failure = {
    ok: false,
    stage,
    error: safeError(error),
  };
  writeResult(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  alice?.stopClient();
  bob?.stopClient();
}
