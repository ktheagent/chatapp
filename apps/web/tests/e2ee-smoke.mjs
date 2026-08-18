import { createClient } from "matrix-js-sdk";

const BASE_URL = process.env.MATRIX_BASE_URL || "http://127.0.0.1:8008";
const PASSWORD = process.env.MATRIX_TEST_PASSWORD || "RelayCi-Only-Password-42!";
const ALICE = "@alice:localhost";
const BOB = "@bob:localhost";
const BODY = `relay-e2ee-ci-${Date.now()}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function authenticatedClient(userId, password, deviceId) {
  const unauthenticated = createClient({ baseUrl: BASE_URL });
  const login = await unauthenticated.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user: userId },
    password,
    device_id: deviceId,
    initial_device_display_name: `Relay CI ${deviceId}`,
  });

  const client = createClient({
    baseUrl: BASE_URL,
    userId: login.user_id,
    accessToken: login.access_token,
    deviceId: login.device_id,
  });

  await client.initRustCrypto({ useIndexedDB: false });

  const prepared = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${userId} initial sync timed out`)), 30000);
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

let alice;
let bob;

try {
  alice = await authenticatedClient(ALICE, PASSWORD, "RELAY_ALICE_CI");
  bob = await authenticatedClient(BOB, PASSWORD, "RELAY_BOB_CI");

  const created = await alice.createRoom({
    is_direct: true,
    invite: [BOB],
    preset: "trusted_private_chat",
    initial_state: [{
      type: "m.room.encryption",
      state_key: "",
      content: { algorithm: "m.megolm.v1.aes-sha2" },
    }],
  });

  const roomId = created.room_id;
  if (!roomId) throw new Error("createRoom returned no room_id");

  await bob.joinRoom(roomId);

  await waitFor("Alice to observe Bob joined", () => {
    const room = alice.getRoom(roomId);
    return room?.getMember(BOB)?.membership === "join";
  });

  await waitFor("Bob to observe encrypted room", () => {
    const room = bob.getRoom(roomId);
    const encryption = room?.currentState?.getStateEvents("m.room.encryption", "");
    return encryption && room.getMyMembership() === "join";
  });

  const sendResult = await alice.sendTextMessage(roomId, BODY);
  if (!sendResult?.event_id) throw new Error("sendTextMessage returned no event_id");

  const received = await waitFor("Bob to receive and decrypt Alice message", async () => {
    const room = bob.getRoom(roomId);
    const event = room?.getLiveTimeline().getEvents().find((candidate) => candidate.getId() === sendResult.event_id);
    if (!event) return null;

    if (event.isEncrypted() && !event.getClearContent()) {
      await bob.decryptEventIfNeeded(event);
    }

    const clear = event.getClearContent();
    if (
      event.isEncrypted() &&
      event.getWireType() === "m.room.encrypted" &&
      event.getType() === "m.room.message" &&
      clear?.body === BODY &&
      event.getContent()?.body === BODY
    ) {
      return event;
    }
    return null;
  }, 45000, 300);

  console.log(JSON.stringify({
    ok: true,
    roomId,
    eventId: received.getId(),
    sender: received.getSender(),
    wireType: received.getWireType(),
    decryptedType: received.getType(),
    encrypted: received.isEncrypted(),
    bodyMatches: received.getClearContent()?.body === BODY,
  }, null, 2));
} finally {
  alice?.stopClient();
  bob?.stopClient();
}
