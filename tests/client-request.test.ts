import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// The app is bundled by Next, so its internal imports intentionally omit .ts.
// Teach the native Node test runner that one repo-local resolution rule without
// changing production imports or installing a test transpiler.
const libRoot = new URL("../lib/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(libRoot) &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  ApiError,
  apiErrorFromResponse,
  clearPendingMutation,
  loadPendingMutation,
  mutationMayHaveCommitted,
  newRequestId,
  runRpcRequest,
  savePendingMutation,
} = await import("../lib/client.ts");

test("mutation request IDs are unique UUIDs", () => {
  const first = newRequestId();
  const second = newRequestId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first, second);
});

test("runRpcRequest returns successful RPC data", async () => {
  const result = await runRpcRequest(async () => ({
    data: { ok: true, value: 42 },
    error: null,
  }));

  assert.deepEqual(result, { ok: true, value: 42 });
});

test("only ambiguous transport failures lock a mutation payload for retry", () => {
  assert.equal(
    mutationMayHaveCommitted(new ApiError(408, "late", "timeout")),
    true,
  );
  assert.equal(
    mutationMayHaveCommitted(new ApiError(503, "unavailable", "unavailable")),
    true,
  );
  assert.equal(
    mutationMayHaveCommitted(new ApiError(0, "offline", "offline")),
    false,
  );
  assert.equal(
    mutationMayHaveCommitted(new ApiError(400, "invalid", "request")),
    false,
  );
});

test("an uncertain mutation survives component loss with the same request UUID", () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  try {
    const requestId = newRequestId();
    const payload = { label: "Pizza", amountCents: 2_500 };
    savePendingMutation("expense:event-1", { requestId, payload });

    // A new component has no refs; it reconstructs the exact durable request.
    const restored = loadPendingMutation(
      "expense:event-1",
      (value): value is typeof payload => {
        if (!value || typeof value !== "object") return false;
        const candidate = value as Record<string, unknown>;
        return (
          typeof candidate.label === "string" &&
          typeof candidate.amountCents === "number"
        );
      },
    );
    assert.deepEqual(restored, { requestId, payload });

    clearPendingMutation("expense:event-1");
    assert.equal(
      loadPendingMutation("expense:event-1", (value): value is unknown => value !== undefined),
      null,
    );
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    if (storageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});

test("a slow response that beats the deadline still succeeds", async () => {
  const result = await runRpcRequest<{ ok: true }>(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ data: { ok: true }, error: null }), 5);
      }),
    100,
  );

  assert.deepEqual(result, { ok: true });
});

test("deliberate P0001 messages remain user-facing", () => {
  const error = apiErrorFromResponse({
    code: "P0001",
    message: "That payer isn't active in this event.",
  });

  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 400);
  assert.equal(error.kind, "request");
  assert.equal(error.message, "That payer isn't active in this event.");
});

test("database and raw backend errors are sanitized", async () => {
  await assert.rejects(
    runRpcRequest(async () => ({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key violates unique constraint settlements_internal_idx",
      },
    })),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.kind, "unavailable");
      assert.match(error.message, /party service/i);
      assert.doesNotMatch(error.message, /23505|constraint|settlements_internal_idx/i);
      return true;
    },
  );
});

test("rejected network requests become safe connection errors", async () => {
  await assert.rejects(
    runRpcRequest(async () => {
      throw new Error("socket stack trace with internal hostname");
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.equal(error.kind, "unavailable");
      assert.match(error.message, /check your connection/i);
      assert.doesNotMatch(error.message, /socket|internal hostname|stack/i);
      return true;
    },
  );
});

test("timeout aborts the in-flight signal and returns a timeout error", async () => {
  let signalWasAborted = false;

  await assert.rejects(
    runRpcRequest(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              signalWasAborted = signal.aborted;
              // Resolution after abort must not replace the timeout result.
              resolve({ data: { tooLate: true }, error: null });
            },
            { once: true },
          );
        }),
      5,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 408);
      assert.equal(error.kind, "timeout");
      assert.match(error.message, /longer than expected/i);
      return true;
    },
  );

  assert.equal(signalWasAborted, true);
});
