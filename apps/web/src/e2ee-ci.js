import { createClient } from "matrix-js-sdk";

const resultNode = document.querySelector("#result");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeError(error) {
  return {
    name: error?.name || "Error",
    message: String(error?.message || error || "Unknown error").slice(0, 1200),
    errcode: error?.errcode || error?.data?.errcode || null,
    httpStatus: error?.httpStatus || error?.data?.statusCode || null,
  };
}

function publish(result) {
  resultNode.textContent = JSON.stringify(result, null, 2);
  resultNode.dataset.status = result.ok ? "pass" : "fail";
  window.__RELAY_E2EE_RESULT__ = result;
}

async function waitFor(label, fn, timeoutMs = 45000, intervalMs = 300) {
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
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function startClient(baseUrl, userId, password, deviceId) {
  const auth = createClient({ baseUrl });
  const login = await auth.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user: userId },
    password,
    device_id: deviceId,
    initial_device_display_name: `Relay CI ${deviceId}`,
  });

  const client = createClient({
    baseUrl,
    userId: login.user_id,
    accessToken: login.access_token,
    deviceId: login.device_id,
  });

  await client.initRustCrypto({ useIndexedDB: false });

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

window.runRelayE2EE = async function runRelayE2EE(config) {
  let stage = "boot";
  let alice;
  let bob;

  try {
    const { baseUrl, password, aliceId, bobId, body } = config;

    stage = "login-alice";
    alice = await startClient(baseUrl, aliceId, password, "RELAY_ALICE_BROWSER_CI");

    stage = "login-bob";
    bob = await startClient(baseUrl, bobId, password, "RELAY_BOB_BROWSER_CI");

    stage = "create-encrypted-room";
    const created = await alice.createRoom({
      is_direct: true,
      invite: [bobId],
      preset: "trusted_private_chat",
      initial_state: [{
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      }],
    });
    const roomId = created.room_id;
    if (!roomId) throw new Error("createRoom returned no room_id");

    stage = "bob-join";
    await bob.joinRoom(roomId);

    stage = "wait-membership";
    await waitFor("Alice observing Bob join", () => {
      return alice.getRoom(roomId)?.getMember(bobId)?.membership === "join";
    });

    stage = "wait-encryption-state";
    await waitFor("Bob observing room encryption", () => {
      const room = bob.getRoom(roomId);
      if (!room || room.getMyMembership() !== "join") return false;
      return Boolean(room.currentState?.getStateEvents("m.room.encryption", ""));
    });

    stage = "settle-device-keys";
    await sleep(1500);

    stage = "send-encrypted-message";
    const sendResult = await alice.sendTextMessage(roomId, body);
    if (!sendResult?.event_id) throw new Error("sendTextMessage returned no event_id");

    stage = "receive-decrypt";
    const received = await waitFor(
      "Bob receiving and decrypting Alice message",
      async () => {
        const event = bob
          .getRoom(roomId)
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
          clear?.body === body
        ) {
          return event;
        }
        return null;
      },
      60000,
      350,
    );

    stage = "complete";
    const result = {
      ok: true,
      stage,
      roomId,
      eventId: received.getId(),
      sender: received.getSender(),
      wireType: received.getWireType(),
      decryptedType: received.getType(),
      encrypted: received.isEncrypted(),
      bodyMatches: received.getClearContent()?.body === body,
    };
    publish(result);
    return result;
  } catch (error) {
    const result = { ok: false, stage, error: safeError(error) };
    publish(result);
    return result;
  } finally {
    alice?.stopClient();
    bob?.stopClient();
  }
};

publish({ ok: false, stage: "ready" });
